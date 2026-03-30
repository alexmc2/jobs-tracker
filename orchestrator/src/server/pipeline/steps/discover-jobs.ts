import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getExtractorRegistry } from "@server/extractors/registry";
import { getAllJobUrls } from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import { asyncPool } from "@server/utils/async-pool";
import {
  sanitizeDiscoveryLocations,
  sanitizeDiscoverySearchTerms,
} from "@shared/discovery-inputs.js";
import {
  formatCountryLabel,
  isSourceAllowedForCountry,
  normalizeCountryKey,
  SUPPORTED_COUNTRY_INPUTS,
} from "@shared/location-support.js";
import { normalizeStringArray } from "@shared/normalize-string-array.js";
import {
  matchesRequestedCity,
  resolveSearchCities,
  shouldApplyStrictCityFilter,
} from "@shared/search-cities.js";
import type { CreateJobInput, PipelineConfig } from "@shared/types";
import { type CrawlSource, progressHelpers, updateProgress } from "../progress";

const DISCOVERY_CONCURRENCY = 3;

type DiscoveryTaskResult = {
  discoveredJobs: CreateJobInput[];
  sourceErrors: string[];
};

type DiscoverySourceTask = {
  source: CrawlSource;
  termsTotal?: number;
  detail: string;
  run: () => Promise<DiscoveryTaskResult>;
};

const COUNTRY_LOCATION_MATCHERS = Array.from(
  new Map(
    (
      [
        ...SUPPORTED_COUNTRY_INPUTS.map(
          (value) =>
            [
              normalizeLocationMatchText(value),
              normalizeCountryKey(value),
            ] as const,
        ),
        [normalizeLocationMatchText("england"), "united kingdom"] as const,
        [normalizeLocationMatchText("scotland"), "united kingdom"] as const,
        [normalizeLocationMatchText("wales"), "united kingdom"] as const,
        [
          normalizeLocationMatchText("northern ireland"),
          "united kingdom",
        ] as const,
        [normalizeLocationMatchText("uae"), "united arab emirates"] as const,
      ] as ReadonlyArray<readonly [string, string]>
    ).filter(([token]) => token.length > 0),
  ).entries(),
).sort((a, b) => b[0].length - a[0].length);

function parseBlockedCompanyKeywords(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeStringArray(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return [];
  }
}

function isBlockedEmployer(
  employer: string | null | undefined,
  blockedKeywordsLowerCase: string[],
): boolean {
  if (!employer) return false;
  if (blockedKeywordsLowerCase.length === 0) return false;
  const normalizedEmployer = employer.toLowerCase();
  return blockedKeywordsLowerCase.some((keyword) =>
    normalizedEmployer.includes(keyword),
  );
}

function parseBooleanSetting(raw: string | undefined): boolean {
  return raw === "1" || raw === "true";
}

function normalizeLocationMatchText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferCountriesFromLocation(
  location: string | null | undefined,
): string[] {
  const normalizedLocation = normalizeLocationMatchText(location);
  if (!normalizedLocation) return [];

  const haystack = ` ${normalizedLocation} `;
  const matchedCountries = new Set<string>();

  for (const [token, country] of COUNTRY_LOCATION_MATCHERS) {
    if (haystack.includes(` ${token} `)) {
      matchedCountries.add(country);
    }
  }

  return Array.from(matchedCountries);
}

function matchesSelectedCountry(
  location: string | null | undefined,
  selectedCountry: string,
): boolean {
  const matchedCountries = inferCountriesFromLocation(location);
  if (matchedCountries.length === 0) return true;
  return matchedCountries.includes(normalizeCountryKey(selectedCountry));
}

function filterJobsByRequestedCountry(args: {
  jobs: CreateJobInput[];
  selectedCountry: string;
}): CreateJobInput[] {
  const { jobs, selectedCountry } = args;
  return jobs.filter((job) =>
    matchesSelectedCountry(job.location, selectedCountry),
  );
}

function isExplicitlyRemote(job: CreateJobInput): boolean {
  if (job.isRemote === true) return true;

  const remoteFields = [job.location, job.workFromHomeType, job.title];
  return remoteFields.some((value) => /\bremote\b/i.test(value ?? ""));
}

function filterJobsForRemoteOnly(jobs: CreateJobInput[]): CreateJobInput[] {
  return jobs.filter(isExplicitlyRemote);
}

function filterJobsByRequestedCities(args: {
  jobs: CreateJobInput[];
  selectedCountry: string;
  requestedCities: string[];
  includeCountryRemote: boolean;
}): CreateJobInput[] {
  const { jobs, selectedCountry, requestedCities, includeCountryRemote } = args;
  if (requestedCities.length === 0) return jobs;

  return jobs.filter((job) => {
    const matchesCity = requestedCities.some((requestedCity) => {
      const strict = shouldApplyStrictCityFilter(
        requestedCity,
        selectedCountry,
      );
      if (!strict) return true;
      return matchesRequestedCity(job.location, requestedCity);
    });
    if (matchesCity) return true;

    if (includeCountryRemote && isExplicitlyRemote(job)) {
      return matchesSelectedCountry(job.location, selectedCountry);
    }
    return false;
  });
}

export async function discoverJobsStep(args: {
  mergedConfig: PipelineConfig;
  shouldCancel?: () => boolean;
}): Promise<{
  discoveredJobs: CreateJobInput[];
  sourceErrors: string[];
}> {
  logger.info("Running discovery step");

  const discoveredJobs: CreateJobInput[] = [];
  const sourceErrors: string[] = [];

  const settings = await settingsRepo.getAllSettings();
  const registry = await getExtractorRegistry();

  const searchTermsSetting = settings.searchTerms;
  let searchTerms: string[] = [];

  if (searchTermsSetting) {
    searchTerms = JSON.parse(searchTermsSetting) as string[];
  } else {
    const defaultSearchTermsEnv =
      process.env.JOBSPY_SEARCH_TERMS || "web developer";
    searchTerms = defaultSearchTermsEnv
      .split("|")
      .map((term) => term.trim())
      .filter(Boolean);
  }

  const sanitizedSearchTerms = sanitizeDiscoverySearchTerms(searchTerms);
  searchTerms = sanitizedSearchTerms.accepted;

  if (sanitizedSearchTerms.dropped.length > 0) {
    logger.info("Dropped low-signal discovery search terms", {
      step: "discover-jobs",
      droppedSearchTerms: sanitizedSearchTerms.dropped,
    });
  }

  if (searchTerms.length === 0) {
    throw new Error(
      "No valid search queries. Use full role phrases instead of standalone tags.",
    );
  }

  const selectedCountry = normalizeCountryKey(
    settings.jobspyCountryIndeed ??
      settings.searchCities ??
      settings.jobspyLocation ??
      "united kingdom",
  );
  const compatibleSources = args.mergedConfig.sources.filter((source) =>
    isSourceAllowedForCountry(source, selectedCountry),
  );
  let existingJobUrlsPromise: Promise<string[]> | null = null;
  const getExistingJobUrls = (): Promise<string[]> => {
    if (!existingJobUrlsPromise) {
      existingJobUrlsPromise = getAllJobUrls();
    }
    return existingJobUrlsPromise;
  };
  const skippedSources = args.mergedConfig.sources.filter(
    (source) => !compatibleSources.includes(source),
  );

  if (skippedSources.length > 0) {
    logger.info("Skipping incompatible sources for selected country", {
      step: "discover-jobs",
      country: selectedCountry,
      countryLabel: formatCountryLabel(selectedCountry),
      requestedSources: args.mergedConfig.sources,
      skippedSources,
    });
  }

  if (args.mergedConfig.sources.length > 0 && compatibleSources.length === 0) {
    throw new Error(
      `No compatible sources for selected country: ${formatCountryLabel(selectedCountry)}`,
    );
  }

  const groupedByManifest = new Map<
    string,
    { sources: string[]; detail: string; termsTotal?: number }
  >();

  for (const source of compatibleSources) {
    const manifest = registry.manifestBySource.get(source);
    if (!manifest) {
      sourceErrors.push(`${source}: extractor manifest not registered`);
      continue;
    }

    const existing = groupedByManifest.get(manifest.id);
    if (existing) {
      existing.sources.push(source);
      continue;
    }

    groupedByManifest.set(manifest.id, {
      sources: [source],
      termsTotal: searchTerms.length,
      detail: `${manifest.displayName}: fetching jobs...`,
    });
  }

  const sourceTasks: DiscoverySourceTask[] = [];

  for (const [manifestId, grouped] of groupedByManifest) {
    const manifest = registry.manifests.get(manifestId);
    if (!manifest) continue;

    sourceTasks.push({
      source: manifest.id,
      termsTotal: grouped.termsTotal,
      detail:
        grouped.sources.length > 1
          ? `${manifest.displayName}: ${grouped.sources.join(", ")}...`
          : grouped.detail,
      run: async () => {
        const filteredSettings = Object.fromEntries(
          Object.entries(settings).filter(
            ([, value]) =>
              typeof value === "string" || typeof value === "undefined",
          ),
        ) as Record<string, string | undefined>;

        const result = await manifest.run({
          source: grouped.sources[0],
          selectedSources: grouped.sources,
          settings: filteredSettings,
          searchTerms,
          selectedCountry,
          getExistingJobUrls,
          shouldCancel: args.shouldCancel,
          onProgress: (event) => {
            progressHelpers.crawlingUpdate({
              source: manifest.id,
              termsProcessed: event.termsProcessed,
              termsTotal: event.termsTotal,
              listPagesProcessed: event.listPagesProcessed,
              listPagesTotal: event.listPagesTotal,
              jobCardsFound: event.jobCardsFound,
              jobPagesEnqueued: event.jobPagesEnqueued,
              jobPagesSkipped: event.jobPagesSkipped,
              jobPagesProcessed: event.jobPagesProcessed,
              phase: event.phase,
              currentUrl: event.currentUrl,
            });

            if (event.detail) {
              updateProgress({
                step: "crawling",
                detail: event.detail,
              });
            }
          },
        });

        if (!result.success) {
          return {
            discoveredJobs: [],
            sourceErrors: [
              `${manifest.displayName || manifest.id}: ${result.error ?? "unknown error"} (sources: ${grouped.sources.join(",")})`,
            ],
          };
        }

        return {
          discoveredJobs: result.jobs,
          sourceErrors: [],
        };
      },
    });
  }

  const totalSources = sourceTasks.length;
  let completedSources = 0;

  progressHelpers.startCrawling(totalSources);

  if (args.shouldCancel?.()) {
    return { discoveredJobs, sourceErrors };
  }

  const sourceResults = await asyncPool({
    items: sourceTasks,
    concurrency: DISCOVERY_CONCURRENCY,
    shouldStop: args.shouldCancel,
    onTaskStarted: (sourceTask) => {
      progressHelpers.startSource(
        sourceTask.source,
        completedSources,
        totalSources,
        {
          termsTotal: sourceTask.termsTotal,
          detail: sourceTask.detail,
        },
      );
    },
    onTaskSettled: () => {
      completedSources += 1;
      progressHelpers.completeSource(completedSources, totalSources);
    },
    task: async (sourceTask) => {
      try {
        return await sourceTask.run();
      } catch (error) {
        logger.warn("Discovery source task failed", {
          sourceTask: sourceTask.source,
          error: sanitizeUnknown(error),
        });

        return {
          discoveredJobs: [],
          sourceErrors: [
            `${sourceTask.source}: ${error instanceof Error ? error.message : "unknown error"}`,
          ],
        };
      }
    },
  });

  for (const sourceResult of sourceResults) {
    discoveredJobs.push(...sourceResult.discoveredJobs);
    sourceErrors.push(...sourceResult.sourceErrors);
  }

  const requestedCityInputs = resolveSearchCities({
    single: settings.searchCities ?? settings.jobspyLocation,
  });
  const sanitizedRequestedCities =
    sanitizeDiscoveryLocations(requestedCityInputs);
  const requestedCities = sanitizedRequestedCities.accepted;

  if (sanitizedRequestedCities.dropped.length > 0) {
    logger.info("Dropped non-city discovery locations", {
      step: "discover-jobs",
      droppedLocations: sanitizedRequestedCities.dropped,
      selectedCountry,
    });
  }

  const includeCountryRemote =
    settings.includeCountryRemote !== undefined
      ? parseBooleanSetting(settings.includeCountryRemote)
      : true;

  const cityFilteredJobs = filterJobsByRequestedCities({
    jobs: discoveredJobs,
    selectedCountry,
    requestedCities,
    includeCountryRemote,
  });
  const cityFilteredOutCount = discoveredJobs.length - cityFilteredJobs.length;

  if (cityFilteredOutCount > 0) {
    logger.info("Dropped discovered jobs that did not match requested cities", {
      step: "discover-jobs",
      droppedCount: cityFilteredOutCount,
      requestedCities,
      selectedCountry,
    });
  }

  const countryFilteredJobs = filterJobsByRequestedCountry({
    jobs: cityFilteredJobs,
    selectedCountry,
  });
  const countryFilteredOutCount =
    cityFilteredJobs.length - countryFilteredJobs.length;

  if (countryFilteredOutCount > 0) {
    logger.info(
      "Dropped discovered jobs that clearly mismatched the selected country",
      {
        step: "discover-jobs",
        droppedCount: countryFilteredOutCount,
        selectedCountry,
      },
    );
  }

  const remoteFilteredJobs = parseBooleanSetting(settings.jobspyIsRemote)
    ? filterJobsForRemoteOnly(countryFilteredJobs)
    : countryFilteredJobs;
  const remoteFilteredOutCount =
    countryFilteredJobs.length - remoteFilteredJobs.length;

  if (remoteFilteredOutCount > 0) {
    logger.info("Dropped discovered jobs that were not explicitly remote", {
      step: "discover-jobs",
      droppedCount: remoteFilteredOutCount,
    });
  }

  const blockedCompanyKeywords = parseBlockedCompanyKeywords(
    settings.blockedCompanyKeywords,
  );
  const blockedKeywordsLowerCase = blockedCompanyKeywords.map((value) =>
    value.toLowerCase(),
  );
  const filteredDiscoveredJobs = remoteFilteredJobs.filter(
    (job) => !isBlockedEmployer(job.employer, blockedKeywordsLowerCase),
  );
  const droppedCount =
    remoteFilteredJobs.length - filteredDiscoveredJobs.length;

  if (droppedCount > 0) {
    const blockedCompanyKeywordsPreview = blockedCompanyKeywords.slice(0, 10);
    const blockedCompanyKeywordsTruncated =
      blockedCompanyKeywordsPreview.length < blockedCompanyKeywords.length;

    logger.info("Dropped discovered jobs matching blocked company keywords", {
      step: "discover-jobs",
      droppedCount,
      blockedKeywordCount: blockedCompanyKeywords.length,
      blockedCompanyKeywordsPreview,
      blockedCompanyKeywordsTruncated,
    });

    logger.debug("Full blocked company keywords used for filtering", {
      step: "discover-jobs",
      blockedCompanyKeywords,
    });
  }

  if (args.shouldCancel?.()) {
    return { discoveredJobs: filteredDiscoveredJobs, sourceErrors };
  }

  if (filteredDiscoveredJobs.length === 0 && sourceErrors.length > 0) {
    throw new Error(`All sources failed: ${sourceErrors.join("; ")}`);
  }

  if (sourceErrors.length > 0) {
    logger.warn("Some discovery sources failed", { sourceErrors });
  }

  progressHelpers.crawlingComplete(filteredDiscoveredJobs.length);

  return { discoveredJobs: filteredDiscoveredJobs, sourceErrors };
}

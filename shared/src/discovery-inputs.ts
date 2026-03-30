const PSEUDO_LOCATION_PATTERNS = [
  /\bremote\b/,
  /\bremotely\b/,
  /\bwork from home\b/,
  /\bwfh\b/,
  /\bhybrid\b/,
  /\bonsite\b/,
  /\bon site\b/,
  /\bworldwide\b/,
  /\bglobal\b/,
  /\banywhere\b/,
];

const SINGLE_TOKEN_ROLE_QUERY_ALLOWLIST = new Set([
  "admin",
  "administrator",
  "analyst",
  "architect",
  "backend",
  "cloud",
  "consultant",
  "coordinator",
  "data",
  "designer",
  "developer",
  "devops",
  "director",
  "engineer",
  "frontend",
  "full-stack",
  "fullstack",
  "lead",
  "manager",
  "mobile",
  "owner",
  "platform",
  "programmer",
  "qa",
  "recruiter",
  "researcher",
  "security",
  "scientist",
  "software",
  "specialist",
  "sre",
  "support",
  "technician",
  "tester",
  "web",
  "writer",
]);

function normalizeDiscoveryInput(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPseudoLocation(value: string): boolean {
  const normalized = normalizeDiscoveryInput(value);
  if (!normalized) return false;
  return PSEUDO_LOCATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sanitizeRoleQuery(value: string): string {
  const normalized = normalizeDiscoveryInput(value);
  if (!normalized) return "";

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length > 0)
    .filter(
      (token) =>
        !PSEUDO_LOCATION_PATTERNS.some((pattern) => pattern.test(token)),
    );

  return tokens.join(" ").trim();
}

function pushUnique(values: string[], seen: Set<string>, value: string): void {
  const key = normalizeDiscoveryInput(value);
  if (!key || seen.has(key)) return;
  seen.add(key);
  values.push(value);
}

export function sanitizeDiscoverySearchTerms(terms: string[]): {
  accepted: string[];
  dropped: string[];
} {
  const accepted: string[] = [];
  const dropped: string[] = [];
  const acceptedSeen = new Set<string>();
  const droppedSeen = new Set<string>();

  for (const rawTerm of terms) {
    const sanitized = sanitizeRoleQuery(rawTerm);
    if (!sanitized) {
      pushUnique(dropped, droppedSeen, rawTerm);
      continue;
    }

    const tokens = sanitized.split(" ").filter(Boolean);
    if (
      tokens.length === 1 &&
      !SINGLE_TOKEN_ROLE_QUERY_ALLOWLIST.has(tokens[0] ?? "")
    ) {
      pushUnique(dropped, droppedSeen, rawTerm);
      continue;
    }

    pushUnique(accepted, acceptedSeen, sanitized);
  }

  return { accepted, dropped };
}

export function sanitizeDiscoveryLocations(locations: string[]): {
  accepted: string[];
  dropped: string[];
} {
  const accepted: string[] = [];
  const dropped: string[] = [];
  const acceptedSeen = new Set<string>();
  const droppedSeen = new Set<string>();

  for (const rawLocation of locations) {
    const trimmed = rawLocation.trim();
    if (!trimmed) continue;

    if (isPseudoLocation(trimmed)) {
      pushUnique(dropped, droppedSeen, trimmed);
      continue;
    }

    pushUnique(accepted, acceptedSeen, trimmed);
  }

  return { accepted, dropped };
}

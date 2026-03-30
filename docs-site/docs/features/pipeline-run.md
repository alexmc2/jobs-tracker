---
id: pipeline-run
title: Pipeline Run
description: How to use Run Mode (Automatic vs Manual), presets, source controls, and advanced run settings.
sidebar_position: 2
---

## What it is

Pipeline Run is the Jobs-page run modal for starting either:

- an **Automatic** pipeline run
- a **Manual** one-job import

For end-to-end sequence, read [Find Jobs and Apply Workflow](/docs/next/workflows/find-jobs-and-apply-workflow).
For manual import internals, read [Manual Import Extractor](/docs/next/extractors/manual).

## Why it exists

The modal provides one place to control run volume, source compatibility, and processing aggressiveness before consuming compute/time.

It helps you:

- choose speed vs depth with presets
- avoid invalid source/country combinations
- understand estimated run cost before starting

## How to use it

1. Open the Jobs page and use the top-right run control.
2. Choose either **Automatic** or **Manual** tab.
3. Configure required inputs and start run.

### Automatic tab

#### Presets

Three presets set defaults for run aggressiveness:

- **Fast**: lower processing volume, higher score threshold
- **Balanced**: middle-ground defaults
- **Detailed**: higher processing volume, lower score threshold

If values are edited manually, the UI shows **Custom**.

#### Country and source compatibility

- Country selection affects which sources are available.
- UK-only sources are disabled for non-UK countries.
- Adzuna is available only for its supported countries and when App ID/App Key are configured in Settings.
- Glassdoor can be enabled only when:
  - selected country supports Glassdoor
  - at least one **Search city** is set in Advanced settings

Incompatible sources are disabled with explanatory tooltips.

#### Advanced settings

- **Resumes tailored** (`topN`)
- **Min suitability score**
- **Max jobs discovered** (run budget cap)
- **Search cities** (optional multi-city input; required for Glassdoor; city names only)
- **Remote only** (prefers explicitly remote roles and applies an extra remote filter after discovery when reliable source data is available)
- **Include country-wide remote jobs** (when cities are set, also keeps remote roles scoped to the selected country; no effect without cities or when Remote only is on; enabled by default)

#### Role queries

- Add queries with Enter or commas.
- Each entry runs as a separate search query, not a stacked filter.
- Use full role phrases such as `backend developer` or `full-stack engineer`.
- Avoid standalone tags such as `remote`, `API`, `React`, or `SQL`; those broaden results instead of narrowing them.
- Use the suggested role chips for common web and full-stack titles when you want a faster starting point.
- Multiple queries increase discovery breadth and runtime.
- At least one valid role query is required.

#### Estimate and run gating

The footer estimate shows expected discovered jobs and resume-processing range.

`Start run now` is disabled when:

- a run is already in progress
- required save/run work is still in progress
- no compatible sources are selected
- no valid role queries are present

### Manual tab

Manual mode opens direct import flow in the same modal.

Use it when you already have a specific job description or link and do not want full discovery.

For accepted input formats, inference behavior, and limits, see [Manual Import Extractor](/docs/next/extractors/manual).

## Common problems

### Start button stays disabled

- Ensure at least one search term is present.
- Ensure at least one compatible source is selected.
- Wait for active save/run operations to finish.

### Glassdoor cannot be enabled

- Verify selected country supports Glassdoor.
- Set at least one Search city in Advanced settings.

### Adzuna is not selectable

- Set `Adzuna App ID` and `Adzuna App Key` in **Settings > Environment & Accounts**.
- Verify the selected country is one of Adzuna's supported markets.

### Run takes longer than expected

- Reduce term count.
- Use `Fast` preset or lower `Max jobs discovered`.
- Disable high-cost source combinations where acceptable.

### Remote-only returns fewer jobs than expected

- Not every source exposes reliable remote metadata.
- Turn `Remote only` off when you want broader discovery and plan to review location manually.
- Add city filters only when you want a tighter geographic match.

### City search misses country-scoped remote jobs

- Enable **Include country-wide remote jobs** in Advanced settings (on by default).
- This keeps remote roles matching the selected country alongside city-specific results.
- If you only want exact city matches, disable the toggle.

### Search results look too broad or irrelevant

- Remove standalone tech tags such as `API`, `React`, `TypeScript`, or `SQL`.
- Use full role phrases such as `backend developer`, `software engineer`, or `data analyst`.
- Do not add `remote` as a city; use the `Remote only` toggle instead.

## Related pages

- [Find Jobs and Apply Workflow](/docs/next/workflows/find-jobs-and-apply-workflow)
- [Manual Import Extractor](/docs/next/extractors/manual)
- [Orchestrator](/docs/next/features/orchestrator)
- [Overview](/docs/next/features/overview)

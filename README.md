# Universal Filter Engine

A JavaScript-first filter-list aggregation and compilation pipeline for browser content blockers and DNS-level blockers.

It downloads curated public lists, normalizes lines, validates domain records, deduplicates rules while retaining source attribution, and publishes static text/JSON artifacts. GitHub Actions rebuilds the outputs every day.

## Published subscriptions

| Artifact | Format | Intended consumers |
| --- | --- | --- |
| dist/universal.txt | ABP-family filter syntax | uBlock Origin, AdGuard, Adblock Plus and compatible browser blockers |
| dist/dns/domains.txt | One hostname per line | Pi-hole, AdGuard Home, NextDNS custom lists and similar DNS tools |
| dist/dns/hosts.txt | Hosts-file format | Hosts-file based blockers |
| dist/api/v1/manifest.json | JSON metadata | Clients and dashboards |
| dist/api/v1/sources.json | JSON source registry and fetch status | Attribution and diagnostics |
| dist/api/v1/changes.json | JSON change summary | Update dashboards |
| dist/changes/* | Added/removed rules and domains | Review and audit changes |

The DNS outputs are a conservative subset of the browser rules. Cosmetic rules, path-specific rules, script-only rules, wildcard rules, and allowlist exceptions are not converted into whole-domain DNS blocks.

## jsDelivr URLs

The repository is public so jsDelivr can serve the generated files directly.

Browser filter:

~~~text
https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/universal.txt
~~~

DNS domains:

~~~text
https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/dns/domains.txt
~~~

Hosts file:

~~~text
https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/dns/hosts.txt
~~~

Static JSON API:

~~~text
https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/api/v1/manifest.json
https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/api/v1/sources.json
https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/api/v1/changes.json
~~~

The main-branch alias follows the branch and is useful for a rolling subscription. jsDelivr currently caches branch aliases for about 12 hours, so an upstream change may take time to appear at the CDN. For a reproducible deployment, pin a release tag instead, for example @v1.0.0. See https://www.jsdelivr.com/documentation.

## Local development

Requirements: Node.js 20 or newer. There are no runtime dependencies.

~~~bash
git clone https://github.com/playlikeboy/universal-filter-engine-js.git
cd universal-filter-engine-js
npm test
npm run build
~~~

The build fetches enabled sources from config/sources.json and writes generated files to dist/.

## Add or remove a source

Edit config/sources.json. Each source needs a unique id, a human-readable name, an HTTPS URL, a format (abp, hosts, or domains), and a category.

~~~json
{
  "id": "example-list",
  "name": "Example List",
  "url": "https://example.org/filters.txt",
  "format": "abp",
  "category": "ads",
  "enabled": true,
  "required": false,
  "license": "See upstream repository"
}
~~~

Set required: true only for sources whose failure should stop publication. Optional source failures are recorded in the manifest; the build continues if the minimum number of sources succeeds.

## Architecture

1. Fetch — HTTPS only, bounded response size, timeout and retry.
2. Parse — recognize ABP-family rules, hosts-file records and domain-per-line feeds.
3. Normalize — remove BOMs, normalize line endings, trim outer whitespace and reject malformed hostnames.
4. Deduplicate — exact normalized rule identity; record every source that contributed it.
5. Compile — keep browser rules intact; derive DNS domains only from exact domain blocks and explicit host/domain records.
6. Diff — compare with the previous build and publish added/removed rules and domains.
7. Publish — GitHub Actions commits changed artifacts to main; jsDelivr serves them as static files.

## Compatibility and safety

This is an aggregator, not a complete implementation of every browser blocker grammar. It preserves ABP-family source rules instead of silently deleting syntax it does not understand. Some upstream sources use uBlock Origin or AdGuard extensions; those rules may not work in every ABP-compatible client. See docs/FORMAT-SUPPORT.md.

Do not assume the DNS output is equivalent to the browser list. DNS cannot express cosmetic hiding, URL path matching, resource-type conditions, first/third-party conditions, or per-site exceptions. Only safe exact-domain rules are projected into DNS format.

The combined list can be more aggressive than any single source. Test it on your own sites and devices before deploying it network-wide. Keep an allowlist for services that break.

## Automation

- .github/workflows/ci.yml runs tests on pushes and pull requests.
- .github/workflows/update-filters.yml runs every day at 02:30 UTC (08:00 India Standard Time) and can also be started manually.
- The update job commits only when generated files change. Required-source failures stop publication.

## Attribution and data licensing

This project does not own upstream filter rules. The source registry records upstream URLs and license notes. Each upstream list remains subject to its own license, attribution requirements and policies; this repository's code license does not relicense upstream filter data. Review DATA-LICENSES.md before adding sources or redistributing their contents.

## Contributing

Open an issue for a source proposal, parser bug, false positive, or compatibility report. Include the affected URL/domain, target blocker, and the smallest reproducible rule where possible.

## Disclaimer

This project is provided as-is. Blocking lists can contain false positives and can disrupt websites or applications. A DNS blocklist can block access to an entire hostname. Always review changes before production use.

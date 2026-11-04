# Universal Filter Engine

A JavaScript-first filter-list aggregation and compilation pipeline for browser content blockers and DNS-level blockers.

It downloads curated public lists, normalizes lines, validates domain records, deduplicates rules while retaining source attribution, and publishes static text/JSON artifacts. GitHub Actions rebuilds the outputs every day and deploys a dashboard plus generated files to GitHub Pages.

## Live sites and subscriptions

Dashboard: https://playlikeboy.github.io/universal-filter-engine-js/

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

The dashboard is hosted on GitHub Pages. Subscription URLs are also served from jsDelivr. Pages mirrors generated files at /dist/ for integrations that prefer the Pages origin.

## Published artifacts

| Artifact | Format | Intended consumers |
| --- | --- | --- |
| dist/universal.txt | ABP-family filter syntax | uBlock Origin, AdGuard, Adblock Plus and compatible browser blockers |
| dist/dns/domains.txt | One hostname per line | Pi-hole, AdGuard Home and compatible DNS tools |
| dist/dns/hosts.txt | Hosts-file format | Hosts-file based blockers |
| dist/api/v1/manifest.json | JSON metadata | Clients and dashboards |
| dist/api/v1/sources.json | JSON source registry and fetch status | Attribution and diagnostics |
| dist/api/v1/changes.json | JSON change summary | Update dashboards |

The DNS outputs are a conservative subset of browser rules. Cosmetic rules, path-specific rules, script-only rules, wildcard rules and allowlist exceptions are not converted into whole-domain DNS blocks.

## Local development

Requirements: Node.js 20 or newer. There are no runtime dependencies.

~~~bash
git clone https://github.com/playlikeboy/universal-filter-engine-js.git
cd universal-filter-engine-js
npm test
npm run build
npm run build:site
~~~

npm run build fetches enabled sources from config/sources.json and writes generated files to dist/. npm run build:site creates the Pages site in site/ and copies generated outputs to site/dist/.

## Automation and publishing

- .github/workflows/ci.yml runs syntax checks and tests on pushes and pull requests.
- .github/workflows/update-filters.yml runs daily at 02:30 UTC (08:00 India Standard Time), or manually.
- The update workflow fetches sources, deduplicates and compiles lists, commits changed files to main, then uploads and deploys the Pages artifact.
- GitHub Pages is configured to use GitHub Actions as its publishing source.
- A failed build or source-health check stops deployment.

## Compatibility, safety and licensing

This is an aggregator, not a complete implementation of every blocker grammar. Unknown ABP-family rules are preserved rather than silently deleted. Some rules from uBlock Origin or AdGuard may not work in every ABP-compatible client; see docs/FORMAT-SUPPORT.md.

DNS cannot express cosmetic hiding, URL path matching, resource-type conditions or per-site exceptions. The DNS output only includes valid exact host blocks.

This project does not own upstream filter rules. The source registry records upstream URLs and available license notes. Each upstream list remains subject to its own license and redistribution terms; the repository's MIT code license does not relicense upstream filter data. Review DATA-LICENSES.md before adding sources or redistributing list contents.

## Contributing

Open an issue for a source proposal, parser bug, false positive or compatibility report. Include the affected URL/domain, target blocker and the smallest reproducible rule where possible.

## Disclaimer

Blocking lists can contain false positives and can disrupt websites or applications. A DNS blocklist can block access to an entire hostname. Review the list before production use.

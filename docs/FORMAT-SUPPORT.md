# Format support and compatibility

## Inputs

| Input format | Recognition | Output |
| --- | --- | --- |
| ABP-family | One filter rule per line; comments and headers ignored | Browser list; exact domain-only blocks may also enter DNS |
| Hosts | IPv4 loopback/zero-address rows such as 0.0.0.0 ads.example | DNS domains and hosts file |
| Domains | One hostname per line | DNS domains, hosts file and generated browser domain rule |

Only HTTPS sources are fetched. Source response size and fetch time are bounded.

## Browser output

dist/universal.txt is an ABP-family aggregation. Network filters, cosmetic filters, exceptions and unknown source rules are retained after light normalization (BOM, CRLF and surrounding whitespace). The engine deliberately does not rewrite advanced syntax that it does not understand.

That preservation is not a promise that every line works in every blocker. uBlock Origin and AdGuard support extensions that other ABP-family clients may not. A future adapter should parse into a canonical AST and emit a separately validated dialect instead of deleting unfamiliar lines.

## DNS projection

A DNS blocklist can only make hostname-level decisions. The compiler includes:

- Valid domains from hosts-file records mapped to 0.0.0.0 or 127.0.0.1.
- Valid domains from domains-per-line sources.
- Exact ABP rules shaped like ||example.com^ with no modifiers.

The compiler intentionally excludes:

- @@ allowlist/exception rules.
- $script, $image, $third-party, $domain= and other modifiers.
- URL paths, query strings, regular expressions and wildcards.
- Cosmetic rules such as example.com##.ad.

It is unsafe to turn a resource-specific filter into a whole-domain DNS block. The conservative projection may therefore be smaller than the browser list.

## Deduplication

Rule deduplication uses the exact trimmed rule string. This avoids unsafe transformations of regexes, case-sensitive URL patterns or option order. Hostnames are lowercased and canonicalized before deduplication. Source attribution is retained in the JSON source report.

## Validation and false positives

Syntax validation is intentionally conservative in this first version. It validates input structure, domain records, length limits, required-source health and fetch size. It does not attempt to prove that every advanced filter is semantically valid. Run test suites and real-browser/DNS regression checks before making a breaking parser change.

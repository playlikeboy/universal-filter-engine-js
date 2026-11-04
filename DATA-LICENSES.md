# Upstream data and attribution

The repository contains two different kinds of material:

1. The JavaScript compiler and automation code.
2. Generated filter data fetched from third-party projects.

The repository's MIT code license applies to the compiler code only. It does not change the license or terms of upstream filter data.

The registry in config/sources.json records the source URL and available upstream license/policy information. At a minimum:

- EasyList and EasyPrivacy are distributed under upstream terms; uBlock Origin's license overview lists GPL-3.0 and CC BY-SA 3.0 options.
- uBlock Origin's own filter assets are distributed under GPL-3.0.
- AdGuard filter data is published from the AdGuardFilters project, which identifies GPL-3.0 as its repository license.
- 1Hosts and StevenBlack include their own license/source notices; consult the upstream repositories before redistribution.
- IndianList is present as a disabled source until its redistribution terms have been reviewed.

Upstream references:

- https://easylist.to/pages/policy.html
- https://github.com/gorhill/uBlock/wiki/Filter-list-licenses
- https://github.com/uBlockOrigin/uAssets
- https://github.com/AdguardTeam/AdGuardFilters
- https://github.com/badmojr/1Hosts
- https://github.com/StevenBlack/hosts
- https://github.com/mediumkreation/IndianList

This notice is a maintenance checklist, not legal advice or a substitute for reviewing each source's current terms. If a source's terms do not permit mirroring or redistribution, disable it or obtain permission before publishing its contents through this repository or a CDN.

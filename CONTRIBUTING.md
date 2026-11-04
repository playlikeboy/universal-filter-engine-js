# Contributing

Thanks for helping improve Universal Filter Engine.

## Proposing a source

Open an issue or pull request with:

- Canonical upstream project and subscription URL.
- Input format (abp, hosts, or domains).
- Category and update cadence.
- Upstream license/policy link and whether redistribution is permitted.
- Evidence that the list is maintained and has a clear false-positive process.

Do not add a source solely because it is large. Prefer maintained, well-attributed lists with clear ownership and reasonable quality controls.

## Parser changes

- Add a focused test for every new syntax or format.
- Never convert resource-specific browser rules into broad DNS blocks.
- Preserve unknown ABP-family rules unless an explicit adapter can safely translate them.
- Keep outputs deterministic so the daily workflow does not create meaningless commits.

## Reporting false positives

Include the affected domain, exact filter rule, source list, target blocker, and reproduction steps. Do not submit personal data, credentials, or private URLs.

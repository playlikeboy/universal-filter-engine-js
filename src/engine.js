const HOSTS_IPV4 = new Set(["0.0.0.0", "127.0.0.1"]);
const DOMAIN_BLOCK_RE = /^\|\|([a-z0-9.-]+)\^$/i;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeLine(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim();
}

export function isValidDomain(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 253) {
    return false;
  }

  const domain = value.toLowerCase().replace(/\.$/, "");
  if (
    domain.length === 0 ||
    domain.length > 253 ||
    domain.includes("..") ||
    domain.includes("*") ||
    domain.includes("_") ||
    domain.includes("/") ||
    domain.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain)
  ) {
    return false;
  }

  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !LABEL_RE.test(label))) {
    return false;
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/[a-z]/i.test(tld)) {
    return false;
  }

  const localNames = new Set([
    "localhost", "local", "localdomain", "invalid", "test", "example"
  ]);
  if (localNames.has(domain) || localNames.has(tld)) return false;

  return true;
}

function addToMap(map, key, sourceId) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(sourceId);
}

function isCommentOrHeader(line) {
  if (!line) return true;
  if (line.startsWith("!") || line.startsWith("[") || line.startsWith(";")) {
    return true;
  }
  if (
    line.startsWith("#") &&
    !line.startsWith("##") &&
    !line.startsWith("#@#") &&
    !line.startsWith("#?#") &&
    !line.startsWith("#$#")
  ) {
    return true;
  }
  return false;
}

export function parseHostsLine(line) {
  const fields = normalizeLine(line).split(/\s+/);
  if (fields.length < 2 || !HOSTS_IPV4.has(fields[0])) return [];

  return fields
    .slice(1)
    .map((field) => field.toLowerCase().replace(/\.$/, ""))
    .filter(isValidDomain);
}

export function extractExactDomainRule(line) {
  const match = line.match(DOMAIN_BLOCK_RE);
  if (!match) return null;
  const domain = match[1].toLowerCase().replace(/\.$/, "");
  return isValidDomain(domain) ? domain : null;
}

export function parseSourceText(source, text) {
  const format = source.format ?? "abp";
  if (!["abp", "hosts", "domains"].includes(format)) {
    throw new Error("Unsupported source format: " + format);
  }

  const rules = new Map();
  const domains = new Map();
  let linesSeen = 0;
  let rejectedLines = 0;

  for (const rawLine of String(text ?? "").split(/\n/)) {
    linesSeen += 1;
    const line = normalizeLine(rawLine);
    if (isCommentOrHeader(line)) continue;
    if (line.length > 4096) {
      rejectedLines += 1;
      continue;
    }

    if (format === "hosts") {
      const entries = parseHostsLine(line);
      if (entries.length === 0) rejectedLines += 1;
      for (const domain of entries) addToMap(domains, domain, source.id);
      continue;
    }

    if (format === "domains") {
      const candidate = line.split(/\s+/)[0].toLowerCase().replace(/\.$/, "");
      if (!isValidDomain(candidate)) {
        rejectedLines += 1;
        continue;
      }
      addToMap(domains, candidate, source.id);
      continue;
    }

    const exactDomain = extractExactDomainRule(line);
    if (exactDomain) {
      addToMap(rules, line, source.id);
      addToMap(domains, exactDomain, source.id);
      continue;
    }

    // Bare hostnames occasionally appear in otherwise ABP-compatible lists.
    // Convert only a complete, valid hostname; never rewrite a URL or pattern.
    if (isValidDomain(line)) {
      addToMap(domains, line.toLowerCase(), source.id);
      continue;
    }

    // Keep unknown and extended ABP-family rules intact. This avoids silently
    // throwing away uBlock/AdGuard extensions that this compiler cannot parse.
    addToMap(rules, line, source.id);
  }

  return { sourceId: source.id, rules, domains, linesSeen, rejectedLines };
}

export function mergeParsedSources(parsedSources) {
  const rules = new Map();
  const domains = new Map();

  for (const parsed of parsedSources) {
    for (const [rule, sourceIds] of parsed.rules) {
      for (const sourceId of sourceIds) addToMap(rules, rule, sourceId);
    }
    for (const [domain, sourceIds] of parsed.domains) {
      for (const sourceId of sourceIds) addToMap(domains, domain, sourceId);
    }
  }

  return { rules, domains };
}

export function classifyRule(rule) {
  if (rule.startsWith("@@")) return "exception";
  if (/##|#@#|#\?#|#\$#/.test(rule)) return "cosmetic";
  if (
    rule.startsWith("||") ||
    rule.startsWith("|") ||
    rule.startsWith("/") ||
    rule.includes("$") ||
    rule.includes("://")
  ) {
    return "network";
  }
  return "other";
}

export function sortUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

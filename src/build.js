import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSourceText,
  mergeParsedSources,
  classifyRule,
  sortUnique
} from "./engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "config", "sources.json");
const DIST = path.join(ROOT, "dist");
const USER_AGENT = "UniversalFilterEngine/0.1 (+https://github.com/playlikeboy/universal-filter-engine-js)";

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function fetchText(source, config) {
  if (!source.url.startsWith("https://")) {
    throw new Error("Only HTTPS source URLs are allowed");
  }

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(source.url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/plain, */*"
        },
        signal: AbortSignal.timeout(config.timeoutMs ?? 30000),
        redirect: "follow"
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status + " from " + source.url);
      }

      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > config.maxBytesPerSource) {
        throw new Error("Source exceeds configured size limit");
      }

      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > config.maxBytesPerSource) {
        throw new Error("Source exceeds configured size limit after download");
      }
      if (body.trim().length === 0) {
        throw new Error("Source returned an empty response");
      }

      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
      }
    }
  }

  throw lastError ?? new Error("Source fetch failed");
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index]);
      }
    })
  );

  return results;
}

function getRuleLines(text) {
  return String(text ?? "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("!"));
}

function json(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

async function writeOutput(relativePath, content) {
  const filePath = path.join(DIST, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const sources = config.sources.filter((source) => source.enabled !== false);
  if (sources.length === 0) throw new Error("No enabled sources are configured");

  console.log("Fetching " + sources.length + " enabled filter sources...");
  const results = await mapLimit(
    sources,
    config.fetchConcurrency ?? 4,
    async (source) => {
      try {
        const body = await fetchText(source, config);
        const parsed = parseSourceText(source, body);
        console.log(
          "OK " + source.id + ": " + parsed.rules.size + " rules, " +
          parsed.domains.size + " domains"
        );
        return { source, parsed, error: null };
      } catch (error) {
        console.error("WARN " + source.id + ": " + error.message);
        return { source, parsed: null, error: error.message };
      }
    }
  );

  const successful = results.filter((item) => item.parsed);
  const failedRequired = results.filter((item) => item.error && item.source.required);

  if (failedRequired.length > 0) {
    throw new Error(
      "Required sources failed: " +
      failedRequired.map((item) => item.source.id).join(", ")
    );
  }
  if (successful.length < (config.minSuccessfulSources ?? 1)) {
    throw new Error(
      "Only " + successful.length + " sources succeeded; minimum is " +
      config.minSuccessfulSources
    );
  }

  const merged = mergeParsedSources(successful.map((item) => item.parsed));
  const dnsDomains = sortUnique([...merged.domains.keys()]);
  const allRules = new Map(merged.rules);

  for (const domain of dnsDomains) {
    const generatedRule = "||" + domain + "^";
    if (!allRules.has(generatedRule)) {
      allRules.set(generatedRule, merged.domains.get(domain) ?? new Set());
    } else {
      for (const sourceId of merged.domains.get(domain) ?? []) {
        allRules.get(generatedRule).add(sourceId);
      }
    }
  }

  const browserRules = sortUnique([...allRules.keys()]);
  const previousBrowser = new Set(
    getRuleLines(await readOptional(path.join(DIST, "universal.txt")))
  );
  const previousDomains = new Set(
    (await readOptional(path.join(DIST, "dns", "domains.txt")))
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const currentBrowser = new Set(browserRules);
  const currentDomains = new Set(dnsDomains);
  const addedRules = sortUnique(browserRules.filter((rule) => !previousBrowser.has(rule)));
  const removedRules = sortUnique([...previousBrowser].filter((rule) => !currentBrowser.has(rule)));
  const addedDomains = sortUnique(dnsDomains.filter((domain) => !previousDomains.has(domain)));
  const removedDomains = sortUnique([...previousDomains].filter((domain) => !currentDomains.has(domain)));

  const ruleCounts = { network: 0, cosmetic: 0, exception: 0, other: 0 };
  for (const rule of browserRules) {
    const type = classifyRule(rule);
    ruleCounts[type] = (ruleCounts[type] ?? 0) + 1;
  }

  const sourceRecords = results.map(({ source, parsed, error }) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    format: source.format,
    category: source.category,
    enabled: source.enabled !== false,
    required: source.required === true,
    license: source.license ?? "See upstream",
    licenseUrl: source.licenseUrl ?? null,
    status: error ? "error" : "ok",
    error,
    parsedRules: parsed?.rules.size ?? 0,
    parsedDomains: parsed?.domains.size ?? 0,
    linesSeen: parsed?.linesSeen ?? 0,
    rejectedLines: parsed?.rejectedLines ?? 0
  }));

  const sourceSummary = {
    configured: config.sources.length,
    enabled: sources.length,
    successful: successful.length,
    failed: results.length - successful.length
  };

  const manifest = {
    schemaVersion: 1,
    name: "Universal Filter Engine",
    version: "0.1.0",
    status: sourceSummary.failed > 0 ? "partial" : "ok",
    sourceSummary,
    totals: {
      browserRules: browserRules.length,
      dnsDomains: dnsDomains.length,
      addedRules: addedRules.length,
      removedRules: removedRules.length,
      addedDomains: addedDomains.length,
      removedDomains: removedDomains.length,
      ruleTypes: ruleCounts
    },
    subscriptions: {
      browser: {
        format: "ABP-family",
        url: "https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/universal.txt"
      },
      dnsDomains: {
        format: "domain-per-line",
        url: "https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/dns/domains.txt"
      },
      hosts: {
        format: "hosts",
        url: "https://cdn.jsdelivr.net/gh/playlikeboy/universal-filter-engine-js@main/dist/dns/hosts.txt"
      }
    }
  };

  const changes = {
    schemaVersion: 1,
    counts: {
      addedRules: addedRules.length,
      removedRules: removedRules.length,
      addedDomains: addedDomains.length,
      removedDomains: removedDomains.length
    },
    samples: {
      addedRules: addedRules.slice(0, 100),
      removedRules: removedRules.slice(0, 100),
      addedDomains: addedDomains.slice(0, 100),
      removedDomains: removedDomains.slice(0, 100)
    }
  };

  const browserHeader = [
    "! Title: Universal Filter Engine",
    "! Description: Aggregated browser ad, tracker, annoyance and security filters",
    "! Homepage: https://github.com/playlikeboy/universal-filter-engine-js",
    "! Format: ABP-family; source-specific extensions may require uBlock Origin or AdGuard",
    "! DNS-safe domains are exported separately under dist/dns/",
    ""
  ].join("\n");

  const hostsHeader = [
    "# Universal Filter Engine",
    "# Aggregated exact-domain blocks; generated from the DNS-safe subset",
    "127.0.0.1 localhost",
    "::1 localhost",
    ""
  ].join("\n");

  await writeOutput("universal.txt", browserHeader + browserRules.join("\n") + "\n");
  await writeOutput("dns/domains.txt", dnsDomains.join("\n") + "\n");
  await writeOutput(
    "dns/hosts.txt",
    hostsHeader + dnsDomains.map((domain) => "0.0.0.0 " + domain).join("\n") + "\n"
  );
  await writeOutput("changes/added-rules.txt", addedRules.join("\n") + (addedRules.length ? "\n" : ""));
  await writeOutput("changes/removed-rules.txt", removedRules.join("\n") + (removedRules.length ? "\n" : ""));
  await writeOutput("changes/added-domains.txt", addedDomains.join("\n") + (addedDomains.length ? "\n" : ""));
  await writeOutput("changes/removed-domains.txt", removedDomains.join("\n") + (removedDomains.length ? "\n" : ""));
  await writeOutput("api/v1/manifest.json", json(manifest));
  await writeOutput("api/v1/sources.json", json({ schemaVersion: 1, sources: sourceRecords }));
  await writeOutput("api/v1/changes.json", json(changes));

  console.log(
    "Build complete: " + browserRules.length + " browser rules; " +
    dnsDomains.length + " DNS domains; " + addedRules.length + " added rules."
  );
}

main().catch((error) => {
  console.error("Build failed: " + error.message);
  process.exitCode = 1;
});

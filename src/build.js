import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import https from "node:https";
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

function requestText(url, source, config, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:") {
      reject(new Error("Only HTTPS source URLs and redirects are allowed"));
      return;
    }
    if (redirects > 5) {
      reject(new Error("Too many redirects from " + source.url));
      return;
    }

    const request = https.get(parsedUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/plain, */*"
      },
      timeout: config.timeoutMs ?? 30000
    }, (response) => {
      const status = response.statusCode ?? 0;

      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          reject(new Error("Redirect without a Location header from " + source.url));
          return;
        }

        let nextUrl;
        try {
          nextUrl = new URL(location, parsedUrl).toString();
        } catch {
          reject(new Error("Invalid redirect URL from " + source.url));
          return;
        }

        requestText(nextUrl, source, config, redirects + 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error("HTTP " + status + " from " + source.url));
        return;
      }

      const limit = config.maxBytesPerSource ?? 25000000;
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > limit) {
        response.destroy();
        reject(new Error("Source exceeds configured size limit"));
        return;
      }

      const chunks = [];
      let bytes = 0;

      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > limit) {
          response.destroy(new Error("Source exceeds configured size limit"));
          return;
        }
        chunks.push(chunk);
      });

      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (body.trim().length === 0) {
          reject(new Error("Source returned an empty response"));
          return;
        }
        resolve(body);
      });

      response.on("error", reject);
    });

    request.on("timeout", () => {
      request.destroy(new Error("Request timed out after " + (config.timeoutMs ?? 30000) + "ms"));
    });
    request.on("error", reject);
  });
}

async function fetchText(source, config) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestText(source.url, source, config);
    } catch (error) {
      lastError = error;
      console.error(
        "Fetch retry " + (attempt + 1) + "/3 for " + source.id + ": " + error.message
      );
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 750 * (2 ** attempt)));
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

async function writeOutput(relativePath, content, maxOutputBytes) {
  const bytes = Buffer.byteLength(content, "utf8");
  const limit = maxOutputBytes ?? 80 * 1024 * 1024;
  if (bytes > limit) {
    throw new Error(
      relativePath + " is " + bytes + " bytes; configured output limit is " + limit
    );
  }

  const filePath = path.join(DIST, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return bytes;
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const sources = config.sources.filter((source) => source.enabled !== false);
  if (sources.length === 0) throw new Error("No enabled sources are configured");

  console.log("Fetching " + sources.length + " enabled filter sources...");
  const results = await mapLimit(
    sources,
    config.fetchConcurrency ?? 2,
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

  const outputSizes = [];
  outputSizes.push([
    "universal.txt",
    await writeOutput("universal.txt", browserHeader + browserRules.join("\n") + "\n", config.maxOutputBytes)
  ]);
  outputSizes.push([
    "dns/domains.txt",
    await writeOutput("dns/domains.txt", dnsDomains.join("\n") + "\n", config.maxOutputBytes)
  ]);
  outputSizes.push([
    "dns/hosts.txt",
    await writeOutput(
      "dns/hosts.txt",
      hostsHeader + dnsDomains.map((domain) => "0.0.0.0 " + domain).join("\n") + "\n",
      config.maxOutputBytes
    )
  ]);
  outputSizes.push([
    "api/v1/manifest.json",
    await writeOutput("api/v1/manifest.json", json(manifest), config.maxOutputBytes)
  ]);
  outputSizes.push([
    "api/v1/sources.json",
    await writeOutput("api/v1/sources.json", json({ schemaVersion: 1, sources: sourceRecords }), config.maxOutputBytes)
  ]);
  outputSizes.push([
    "api/v1/changes.json",
    await writeOutput("api/v1/changes.json", json(changes), config.maxOutputBytes)
  ]);

  console.log("Generated file sizes:");
  for (const [name, bytes] of outputSizes) {
    console.log("  " + name + ": " + (bytes / (1024 * 1024)).toFixed(2) + " MiB");
  }

  console.log(
    "Build complete: " + browserRules.length + " browser rules; " +
    dnsDomains.length + " DNS domains; " + addedRules.length + " added rules; " +
    addedDomains.length + " added domains."
  );
}

main().catch((error) => {
  console.error("Build failed: " + error.message);
  process.exitCode = 1;
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLine,
  isValidDomain,
  parseHostsLine,
  extractExactDomainRule,
  parseSourceText,
  mergeParsedSources,
  classifyRule
} from "../src/engine.js";

test("normalizes BOM, CRLF and outer whitespace", () => {
  assert.equal(normalizeLine("\uFEFF  ||ads.example.com^\r "), "||ads.example.com^");
});

test("accepts regular hostnames and rejects unsafe or non-host values", () => {
  assert.equal(isValidDomain("ads.example.com"), true);
  assert.equal(isValidDomain("xn--bcher-kva.example"), true);
  assert.equal(isValidDomain("localhost"), false);
  assert.equal(isValidDomain("127.0.0.1"), false);
  assert.equal(isValidDomain("*.example.com"), false);
  assert.equal(isValidDomain("example.com/path"), false);
});

test("parses hosts records and ignores local aliases", () => {
  assert.deepEqual(
    parseHostsLine("0.0.0.0 ads.example.com tracker.example.net localhost"),
    ["ads.example.com", "tracker.example.net"]
  );
  assert.deepEqual(parseHostsLine("192.0.2.1 example.com"), []);
});

test("extracts only exact, unmodified domain block rules", () => {
  assert.equal(extractExactDomainRule("||ads.example.com^"), "ads.example.com");
  assert.equal(extractExactDomainRule("||ads.example.com^$script"), null);
  assert.equal(extractExactDomainRule("@@||ads.example.com^"), null);
  assert.equal(extractExactDomainRule("||example.com/path"), null);
});

test("parses ABP rules while preserving cosmetic and exception rules", () => {
  const parsed = parseSourceText(
    { id: "test-abp", format: "abp" },
    [
      "! comment",
      "[Adblock Plus 2.0]",
      "||ads.example.com^",
      "@@||allowed.example.com^",
      "example.com##.sponsored",
      "||cdn.example.com^$script,third-party"
    ].join("\n")
  );

  assert.equal(parsed.rules.has("||ads.example.com^"), true);
  assert.equal(parsed.rules.has("@@||allowed.example.com^"), true);
  assert.equal(parsed.rules.has("example.com##.sponsored"), true);
  assert.equal(parsed.rules.has("||cdn.example.com^$script,third-party"), true);
  assert.equal(parsed.domains.has("ads.example.com"), true);
  assert.equal(parsed.domains.has("allowed.example.com"), false);
  assert.equal(parsed.domains.has("cdn.example.com"), false);
});

test("parses a domains-per-line source", () => {
  const parsed = parseSourceText(
    { id: "domains", format: "domains" },
    "# heading\nads.example.com\nbad_domain.example\ntracker.example.net\n"
  );
  assert.deepEqual([...parsed.domains.keys()].sort(), [
    "ads.example.com",
    "tracker.example.net"
  ]);
});

test("deduplicates exact rules and retains every source attribution", () => {
  const first = parseSourceText(
    { id: "one", format: "abp" },
    "||ads.example.com^\nexample.com##.ad\n"
  );
  const second = parseSourceText(
    { id: "two", format: "abp" },
    "||ads.example.com^\nexample.com##.ad\n"
  );
  const merged = mergeParsedSources([first, second]);

  assert.equal(merged.rules.size, 2);
  assert.deepEqual([...merged.rules.get("||ads.example.com^")].sort(), ["one", "two"]);
  assert.deepEqual([...merged.domains.get("ads.example.com")].sort(), ["one", "two"]);
});

test("classifies rules for manifest statistics", () => {
  assert.equal(classifyRule("@@||allowed.example.com^"), "exception");
  assert.equal(classifyRule("example.com##.ad"), "cosmetic");
  assert.equal(classifyRule("||ads.example.com^"), "network");
  assert.equal(classifyRule("custom-filter-token"), "other");
});

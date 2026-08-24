/* The service worker's precache list must match the files on disk: every
 * served file present (so offline is complete), no phantom entries (so
 * install cannot fail on a missing file). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function servedFiles(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...servedFiles(dir, rel));
    } else if (!/\.test\.js$|^package\.json$|\.py$|README\.md$|^sw\.js$/.test(rel.split("/").pop()) && !rel.startsWith(".")) {
      out.push(rel);
    }
  }
  return out.sort();
}

test("sw.js precaches exactly the served files", () => {
  const source = fs.readFileSync(path.join(docs, "sw.js"), "utf8");
  const listed = [...source.matchAll(/^\s*"([^"]+)",\s*$/gm)].map((m) => m[1]).filter((p) => p !== "./").sort();
  const onDisk = servedFiles(docs);
  const missing = onDisk.filter((f) => !listed.includes(f));
  const phantom = listed.filter((f) => !onDisk.includes(f));
  assert.deepEqual(missing, [], `served but not precached: ${missing.join(", ")}`);
  assert.deepEqual(phantom, [], `precached but not on disk: ${phantom.join(", ")}`);
  assert.ok(source.includes('"./"'), "the navigation shell must be precached");
});

test("sw.js is network-first and never touches other origins", () => {
  const source = fs.readFileSync(path.join(docs, "sw.js"), "utf8");
  assert.ok(source.includes("url.origin !== self.location.origin"), "cross-origin requests pass through");
  assert.ok(/await fetch\(request\)/.test(source) && /cache\.match\(request/.test(source),
    "network first, cache on failure");
});

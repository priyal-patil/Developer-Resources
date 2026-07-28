#!/usr/bin/env node
// Adapter: reads an sdk-automation report and prints one normalized dashboard
// report (schemaVersion 1, see docs-automation-dashboard-data/SCHEMA.md) to
// stdout.
//
// Usage: node scripts/publish-to-dashboard.js [path/to/report.json] > out.json
//
// NOTE ON latest.json AMBIGUITY: reports/latest.json is a single file
// overwritten on every run, regardless of which SDK doc was run — it is NOT
// an aggregate across all SDK docs, and it is NOT one-file-per-doc. There
// are ~130+ timestamped files in reports/ (one per run per doc, e.g.
// content-delivery-sdk-java-reference-2026-07-24T12-03-54-935Z.json), one
// distinct `docName` per SDK/language/doc combo. Each distinct docName is
// its own suite (matching cli-automation's per-doc suite pattern), with
// totals computed as pass/fail/skip counts over that doc's `results` array.
//
// There is currently NO GitHub Actions workflow for sdk-automation (only
// cli-docs.yml and kickstart-docs.yml exist under .github/workflows/), so
// this adapter is not yet wired into CI. It's written now so a future
// workflow can call it the same way cli-docs.yml's matrix job would: run one
// SDK doc, then call this adapter against the report that run just
// produced (reports/latest.json immediately after that run, or the specific
// timestamped file, passed as an argv[2] path) — one suite published per job.
//
// Source shape:
//   { docName, docUrl, runId, results: [ { methodId, navSection, method,
//     outcome: "pass"|"fail"|"skipped"|"no-example", resolvedOutput?,
//     error?, substitutions } ] }
//
// outcome "no-example" means the doc had no runnable code example for that
// method — that's not a failure, so it's counted as skipped alongside
// "skipped" itself. A human should double check that's the right call for
// the dashboard (vs. e.g. surfacing "no-example" as its own signal).

import fs from "node:fs";
import path from "node:path";

const PROJECT = "developer-resources-docs-automation";
const PROJECT_LABEL = "Developer Resources Docs Automation";
const REPO = "priyal-patil/Developer-Resources";

const reportPath = process.argv[2] || path.resolve("reports/latest.json");

if (!fs.existsSync(reportPath)) {
  console.error(`sdk-automation adapter: no report found at ${reportPath}`);
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(reportPath, "utf-8"));

const docName = source.docName || "unknown-sdk-doc";
const docUrl = source.docUrl || null;
const results = Array.isArray(source.results) ? source.results : [];

const passed = results.filter((r) => r.outcome === "pass").length;
const failedResults = results.filter((r) => r.outcome === "fail");
const skipped = results.filter((r) => r.outcome === "skipped" || r.outcome === "no-example").length;
const total = results.length;

const failedItems = failedResults.map((r) => ({
  name: r.navSection ? `${r.navSection}: ${r.method}` : r.method,
  detail: r.error || null,
  docLink: docUrl,
}));

const runId = process.env.GITHUB_RUN_ID || source.runId || null;

// source.runId (when present and not overridden by a real GH run id) is a
// filesystem-safe timestamp like "2026-07-24T07-08-22-383Z" — convert it
// back to a proper ISO 8601 string for the `timestamp` field so history
// ordering on the dashboard is meaningful.
function runIdToIso(id) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(id || "");
  if (!m) return null;
  const [, date, hh, mm, ss, ms] = m;
  return `${date}T${hh}:${mm}:${ss}.${ms}Z`;
}
const sourceTimestamp = runIdToIso(source.runId);

const normalized = {
  schemaVersion: 1,
  project: PROJECT,
  projectLabel: PROJECT_LABEL,
  suite: docName,
  suiteLabel: docName,
  runId,
  runUrl: process.env.GITHUB_RUN_ID
    ? `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
  artifactsUrl: process.env.GITHUB_RUN_ID
    ? `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}#artifacts`
    : null,
  timestamp: sourceTimestamp || new Date().toISOString(),
  durationSeconds: null,
  totals: {
    total,
    passed,
    failed: failedResults.length,
    skipped,
    warnings: 0,
    timedOut: 0,
    interrupted: 0,
  },
  failedItems,
  docLinks: docUrl ? [docUrl] : [],
};

process.stdout.write(JSON.stringify(normalized, null, 2) + "\n");

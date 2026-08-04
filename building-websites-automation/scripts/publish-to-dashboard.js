#!/usr/bin/env node
// Adapter: reads building-websites-automation/reports/latest.json (shape produced by
// src/report/generateReport.ts) and prints one normalized dashboard report
// (schemaVersion 1, see docs-automation-dashboard-data/SCHEMA.md) to stdout.
//
// Usage: node scripts/publish-to-dashboard.js [path/to/latest.json] > out.json
//
// Source shape:
//   { generatedAt, totals: { kickstarts, failed },
//     results: [ { kickstart, startedAt, steps: [ { step, status, detail } ] } ] }
//
// Each `results` entry is one kickstart framework (nuxt, react, ...) tested
// end-to-end. Per generateReport.ts, a kickstart counts as "ok" iff none of
// its steps have status "failed" or "missing" (a step can also be "passed",
// "skipped", or "ambiguous" without failing the kickstart). totals.kickstarts
// / totals.failed already treat each kickstart as one pass/fail unit, so this
// adapter emits ONE suite ("kickstart-automation") aggregated across all
// results, with one failedItems entry per failing kickstart (not per step).
//
// items[]/warnings[] (schema v1.1, optional): generateReport.ts's card()
// now writes an `id="<slug>"` anchor per kickstart onto its report card, so
// each `items[]` entry can link reportUrl at reports/run-report.html#<slug>
// straight to that kickstart's card. `warnings[]` surfaces "ambiguous" steps
// (uncertain but non-blocking — they don't fail the kickstart per the "ok"
// rule above) which previously had no dashboard-visible representation.

import fs from "node:fs";
import path from "node:path";

const PROJECT = "developer-resources-docs-automation";
const PROJECT_LABEL = "Developer Resources Docs Automation";
const SUITE = "building-websites-automation";
const SUITE_LABEL = "Building Websites Automation";
const REPO = "priyal-patil/Developer-Resources";

// Kept identical to the `slugify` exported by src/report/generateReport.ts so
// the anchors generated there match the reportUrl fragments built here.
function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const REPORTS_BASE = `data/${PROJECT}/${SUITE}/reports/run-report.html`;

const reportPath = process.argv[2] || path.resolve("reports/latest.json");

if (!fs.existsSync(reportPath)) {
  console.error(`building-websites-automation adapter: no report found at ${reportPath}`);
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(reportPath, "utf-8"));

const results = Array.isArray(source.results) ? source.results : [];

const FAILING_STEP_STATUSES = new Set(["failed", "missing"]);

const failedItems = [];
const items = [];
const warnings = [];
for (const r of results) {
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const failingSteps = steps.filter((s) => FAILING_STEP_STATUSES.has(s.status));
  const slug = slugify(r.kickstart);
  const reportUrl = `${REPORTS_BASE}#${slug}`;

  if (failingSteps.length > 0) {
    const stepNames = failingSteps
      .map((s) => s.step?.title || `step ${s.step?.index}`)
      .join(", ");
    const detail = `Failed step(s): ${stepNames}`;
    failedItems.push({ name: r.kickstart, detail, docLink: null });
    items.push({ name: r.kickstart, status: "fail", detail, docLink: null, reportUrl });
  } else {
    items.push({ name: r.kickstart, status: "pass", detail: null, docLink: null, reportUrl });
  }

  for (const s of steps.filter((s) => s.status === "ambiguous")) {
    warnings.push({
      name: `${r.kickstart}: ${s.step?.title || `step ${s.step?.index}`}`,
      detail: s.detail || "Ambiguous — could not be verified conclusively.",
      docLink: null,
      reportUrl,
    });
  }
}

const total = typeof source.totals?.kickstarts === "number" ? source.totals.kickstarts : results.length;
const failed = typeof source.totals?.failed === "number" ? source.totals.failed : failedItems.length;
const passed = Math.max(total - failed, 0);

const runId = process.env.GITHUB_RUN_ID || null;

const normalized = {
  schemaVersion: 1,
  project: PROJECT,
  projectLabel: PROJECT_LABEL,
  suite: SUITE,
  suiteLabel: SUITE_LABEL,
  runId,
  runUrl: runId ? `https://github.com/${REPO}/actions/runs/${runId}` : null,
  artifactsUrl: runId ? `https://github.com/${REPO}/actions/runs/${runId}#artifacts` : null,
  timestamp: source.generatedAt || new Date().toISOString(),
  durationSeconds: null,
  totals: {
    total,
    passed,
    failed,
    skipped: 0,
    warnings: warnings.length,
    timedOut: 0,
    interrupted: 0,
  },
  failedItems,
  docLinks: [],
  items,
  warnings,
};

process.stdout.write(JSON.stringify(normalized, null, 2) + "\n");

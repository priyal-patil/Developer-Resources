#!/usr/bin/env node
// Adapter: reads kickstart-automation/reports/latest.json (shape produced by
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

import fs from "node:fs";
import path from "node:path";

const PROJECT = "developer-resources-docs-automation";
const PROJECT_LABEL = "Developer Resources Docs Automation";
const SUITE = "kickstart-automation";
const SUITE_LABEL = "Kickstart Automation";
const REPO = "priyal-patil/Developer-Resources";

const reportPath = process.argv[2] || path.resolve("reports/latest.json");

if (!fs.existsSync(reportPath)) {
  console.error(`kickstart-automation adapter: no report found at ${reportPath}`);
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(reportPath, "utf-8"));

const results = Array.isArray(source.results) ? source.results : [];

const FAILING_STEP_STATUSES = new Set(["failed", "missing"]);

const failedItems = [];
for (const r of results) {
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const failingSteps = steps.filter((s) => FAILING_STEP_STATUSES.has(s.status));
  if (failingSteps.length === 0) continue;
  const stepNames = failingSteps
    .map((s) => s.step?.title || `step ${s.step?.index}`)
    .join(", ");
  failedItems.push({
    name: r.kickstart,
    detail: `Failed step(s): ${stepNames}`,
    docLink: null,
  });
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
    warnings: 0,
    timedOut: 0,
    interrupted: 0,
  },
  failedItems,
  docLinks: [],
};

process.stdout.write(JSON.stringify(normalized, null, 2) + "\n");

#!/usr/bin/env node
// Adapter: reads building-websites-automation/reports/latest.json and prints
// one normalized dashboard report (schemaVersion 1, see
// docs-automation-dashboard-data/SCHEMA.md) to stdout.
//
// Usage: node scripts/publish-to-dashboard.js [path/to/latest.json] > out.json
//
// Source shape is identical to kickstart-automation's:
//   { generatedAt, totals: { kickstarts, failed },
//     results: [ { kickstart, startedAt, steps: [ { step, status, detail } ] } ] }
// (this subproject currently only has one `results` entry,
// "get-started-building-a-website", but the adapter aggregates the same way
// kickstart-automation's does in case more get added.)
//
// NOTE: there is currently no GitHub Actions workflow for this subproject
// (only cli-docs.yml and kickstart-docs.yml exist under .github/workflows/).
// This adapter is written so a future workflow can wire it in the same way;
// it is not yet invoked by CI.

import fs from "node:fs";
import path from "node:path";

const PROJECT = "developer-resources-docs-automation";
const PROJECT_LABEL = "Developer Resources Docs Automation";
const SUITE = "building-websites-automation";
const SUITE_LABEL = "Building Websites Automation";
const REPO = "priyal-patil/Developer-Resources";

const reportPath = process.argv[2] || path.resolve("reports/latest.json");

if (!fs.existsSync(reportPath)) {
  console.error(`building-websites-automation adapter: no report found at ${reportPath}`);
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(reportPath, "utf-8"));

const results = Array.isArray(source.results) ? source.results : [];

const FAILING_STEP_STATUSES = new Set(["failed", "missing"]);

// Kept in sync with the `slug()` helper in src/report/generateReport.ts,
// which anchors each kickstart's <section id="..."> in reports/index.html.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

const REPORTS_HTML_PATH = `data/${PROJECT}/${SUITE}/reports/index.html`;

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
    reportUrl: `${REPORTS_HTML_PATH}#${slug(r.kickstart)}`,
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
  // Folder this doc sits in on the dashboard (see SCHEMA.md "group").
  group: "building-websites",
  groupLabel: "Building Websites",
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

#!/usr/bin/env node
// Adapter: reads a cli-automation report (reports/latest.json by default) and
// prints one normalized dashboard report (schemaVersion 1, see
// docs-automation-dashboard-data/SCHEMA.md) to stdout.
//
// Usage: node scripts/publish-to-dashboard.js [path/to/report.json] > out.json
//
// cli-docs.yml's `run-docs` job runs ONE doc per matrix job (`npm run run-one
// -- <doc>`), so within a single job reports/latest.json holds exactly that
// doc's run — there is no cross-doc aggregation to do here. Suite = doc name
// (e.g. "configure-regions"), one suite per CLI doc, same pattern as
// sdk-automation's per-docName suites.
//
// Source shape (src/report/generateReport.ts):
//   { doc: { name, title, url, lastUpdated }, startedAt, finishedAt,
//     environment, prerequisites, execResults: [ { blockId, section,
//     docCommand, runCommand, status: "pass"|"fail"|"skipped", exitCode,
//     durationMs, outputTail } ], flagFindings, flagAudits,
//     structureFindings, lintFindings, teardown, verdict: "PASS"|"GAPS",
//     gapCount }
//
// NOTE ON GAPS: a doc can have verdict "GAPS" (gapCount > 0) even when every
// execResults entry passes — gaps come from flagFindings/structureFindings/
// lintFindings (doc-vs---help audits, missing structure trees, lint issues),
// which are a different kind of problem than a command failing outright.
// This adapter counts execResults failures under totals.failed/failedItems,
// and separately counts gapCount under totals.warnings, ALSO surfacing gap
// findings as failedItems (so they aren't silently dropped from the
// dashboard's "what needs attention" list) — a human should double check
// whether "warnings" is the right bucket for these vs. folding them into
// failed/total.
//
// items[]/warnings[] (schema v1.1, optional): this suite is already
// per-doc granularity (one suite = one doc), so there's no per-row anchor
// to add inside the doc's own reports/index.html the way kickstart's
// per-card anchors work — `items[]` here is ONE entry representing the
// whole doc's overall pass/fail, reportUrl pointing at the whole HTML
// report file (copied by the workflow into reports/<docName>.html, no
// fragment needed since it's the only item). `warnings[]` maps
// flagFindings/structureFindings/lintFindings 1:1 — these are genuinely
// non-blocking doc-vs-CLI audit findings (every execResults command still
// ran and is judged separately via failedItems/items status), except
// structureFindings entries with kind "note" (informational — "doc has no
// tree to verify" — not an actual finding), which are dropped rather than
// forced into warnings.

import fs from "node:fs";
import path from "node:path";

const PROJECT = "developer-resources-docs-automation";
const PROJECT_LABEL = "Developer Resources Docs Automation";
const REPO = "priyal-patil/Developer-Resources";

const reportPath = process.argv[2] || path.resolve("reports/latest.json");

if (!fs.existsSync(reportPath)) {
  console.error(`cli-automation adapter: no report found at ${reportPath}`);
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(reportPath, "utf-8"));

const docName = source.doc?.name || "unknown-cli-doc";
const docTitle = source.doc?.title || docName;
const docUrl = source.doc?.url || null;

const execResults = Array.isArray(source.execResults) ? source.execResults : [];

const passed = execResults.filter((r) => r.status === "pass").length;
const failedExec = execResults.filter((r) => r.status === "fail");
const skipped = execResults.filter((r) => r.status === "skipped").length;
const total = execResults.length;

const failedItems = failedExec.map((r) => ({
  name: r.section ? `${r.section}: ${r.docCommand}` : r.docCommand,
  detail: r.outputTail || `exited ${r.exitCode}`,
  docLink: docUrl,
}));

const gapCount = typeof source.gapCount === "number" ? source.gapCount : 0;
if (gapCount > 0) {
  const gapDetails = [
    ...(source.flagFindings || []).map((f) => `${f.kind}: ${f.flag} — ${f.cli || ""}`.trim()),
    ...(source.structureFindings || []).map((f) => `${f.kind}: ${f.entry} — ${f.detail || ""}`.trim()),
    ...(source.lintFindings || []).map((f) => `${f.kind || "lint"}: ${JSON.stringify(f)}`),
  ];
  failedItems.push({
    name: `${docName}: doc/CLI gaps (verdict GAPS)`,
    detail: gapDetails.join("; ") || `${gapCount} gap(s) found`,
    docLink: docUrl,
  });
}

const reportUrl = `data/${PROJECT}/${docName}/reports/${docName}.html`;

const overallStatus = failedExec.length > 0 ? "fail" : gapCount > 0 ? "warning" : "pass";
const overallDetail =
  overallStatus === "fail"
    ? failedItems.map((i) => i.name).join(", ")
    : overallStatus === "warning"
      ? `${gapCount} gap(s) found — see warnings`
      : null;

const items = [
  {
    name: docTitle,
    status: overallStatus,
    detail: overallDetail,
    docLink: docUrl,
    reportUrl,
  },
];

const warnings = [
  ...(source.flagFindings || []).map((f) => ({
    name: `Flag: ${f.flag}`,
    detail: `${f.kind} — doc: ${f.doc || "—"} / cli: ${f.cli || "—"}`,
    docLink: docUrl,
    reportUrl,
  })),
  ...(source.structureFindings || [])
    .filter((f) => f.kind !== "note")
    .map((f) => ({
      name: `Structure: ${f.entry}`,
      detail: `${f.kind}${f.detail ? ` — ${f.detail}` : ""}`,
      docLink: docUrl,
      reportUrl,
    })),
  ...(source.lintFindings || []).map((f) => ({
    name: `Lint (${f.section || "doc"})`,
    detail: `${f.issue}: ${f.snippet}`,
    docLink: docUrl,
    reportUrl,
  })),
];

let durationSeconds = null;
if (source.startedAt && source.finishedAt) {
  const started = Date.parse(source.startedAt);
  const finished = Date.parse(source.finishedAt);
  if (!Number.isNaN(started) && !Number.isNaN(finished)) {
    durationSeconds = Math.round((finished - started) / 1000);
  }
}

const runId = process.env.GITHUB_RUN_ID || null;

const normalized = {
  schemaVersion: 1,
  project: PROJECT,
  projectLabel: PROJECT_LABEL,
  suite: docName,
  suiteLabel: docTitle,
  runId,
  runUrl: runId ? `https://github.com/${REPO}/actions/runs/${runId}` : null,
  artifactsUrl: runId ? `https://github.com/${REPO}/actions/runs/${runId}#artifacts` : null,
  timestamp: source.startedAt || new Date().toISOString(),
  durationSeconds,
  totals: {
    total,
    passed,
    failed: failedExec.length,
    skipped,
    warnings: gapCount,
    timedOut: 0,
    interrupted: 0,
  },
  failedItems,
  docLinks: docUrl ? [docUrl] : [],
  items,
  warnings,
};

process.stdout.write(JSON.stringify(normalized, null, 2) + "\n");

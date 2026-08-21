#!/usr/bin/env node
// Adapter: reads kickstart-automation/reports/latest.json (shape produced by
// src/report/generateReport.ts) and writes ONE normalized dashboard report
// (schemaVersion 1 + v1.1 items[], see docs-automation-dashboard-data/SCHEMA.md)
// PER KICKSTART GUIDE into a staging dir, then prints the publish.js arguments
// (one `<report.json>:<reports-dir>` pair per line) to stdout.
//
// Usage: node scripts/publish-to-dashboard.js [path/to/latest.json] \
//          [--stage-dir /tmp/dashboard-kickstart]
//
// Source shape:
//   { generatedAt, totals: { kickstarts, failed },
//     results: [ { kickstart, startedAt, ok, steps: [ { step, status, detail,
//                  evidence } ] } ] }
//
// WHY ONE SUITE PER GUIDE: this used to emit a single aggregated
// "kickstart-automation" suite whose totals were 12 pass/fail units, one per
// guide. On the dashboard that collapsed all 12 kickstart docs into a single
// table row, so the individual docs under test were invisible until you
// clicked in — unlike cli-automation, which publishes one suite per doc
// (suite = doc name). This adapter now matches that convention: suite =
// "kickstart-<name>", and a suite's totals count its STEPS, so the dashboard
// shows which parts of each doc are broken rather than just "1 failed".
//
// Step status -> dashboard status:
//   passed            -> pass
//   failed | missing   -> fail      (counted in totals.failed)
//   ambiguous          -> warning   (counted in totals.warnings)
//   skipped            -> skipped

import fs from "node:fs";
import path from "node:path";

const PROJECT = "developer-resources-docs-automation";
const PROJECT_LABEL = "Developer Resources Docs Automation";
const REPO = "priyal-patil/Developer-Resources";

const argv = process.argv.slice(2);
const stageFlagIdx = argv.indexOf("--stage-dir");
const stageDir =
  stageFlagIdx >= 0 ? argv[stageFlagIdx + 1] : "/tmp/dashboard-kickstart-automation";
const positional = argv.filter(
  (a, i) => i !== stageFlagIdx && i !== stageFlagIdx + 1 && !a.startsWith("--")
);
const reportPath = positional[0] || path.resolve("reports/latest.json");
const reportsSrcDir = path.dirname(reportPath);

if (!fs.existsSync(reportPath)) {
  console.error(`kickstart-automation adapter: no report found at ${reportPath}`);
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
const results = Array.isArray(source.results) ? source.results : [];

// config/kickstarts.json is the only place the doc URL for each guide lives
// (the run report records the guide name, not its URL), so read it here to
// populate docLink/docLinks — without it every kickstart row on the dashboard
// shows "—" in the DOC LINK column with no way back to the doc under test.
function loadConfig() {
  for (const p of [
    path.resolve(path.dirname(reportsSrcDir), "config/kickstarts.json"),
    path.resolve("config/kickstarts.json"),
  ]) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  console.error("kickstart-automation adapter: config/kickstarts.json not found — doc links will be omitted");
  return [];
}

const config = loadConfig();
const configByName = new Map(config.map((c) => [c.name, c]));

// Kept in sync with the `slug()` helper in src/report/generateReport.ts, which
// names each guide's per-kickstart HTML file (reports/<slug>.html).
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

const FRAMEWORK_LABELS = {
  nuxt: "Nuxt",
  next: "Next.js",
  react: "React",
  angular: "Angular",
  sveltekit: "SvelteKit",
  astro: "Astro",
  veda: "Veda",
};
const VARIANT_LABELS = {
  standard: null, // the page's primary guide — no suffix
  default: null,
  ssr: "SSR",
  csr: "CSR",
  ssg: "SSG",
  middleware: "Middleware",
  graphql: "GraphQL",
};

function suiteLabelFor(name, cfg) {
  // "next-ssr" -> framework "next", variant "ssr" (config's variant wins).
  const framework = Object.keys(FRAMEWORK_LABELS).find(
    (f) => name === f || name.startsWith(`${f}-`)
  );
  const frameworkLabel = framework
    ? FRAMEWORK_LABELS[framework]
    : name.replace(/(^|-)([a-z])/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());
  const variantKey = cfg?.variant || (framework ? name.slice(framework.length + 1) : "");
  const variantLabel =
    variantKey in VARIANT_LABELS ? VARIANT_LABELS[variantKey] : variantKey.toUpperCase();
  return variantLabel
    ? `Kickstart: ${frameworkLabel} (${variantLabel})`
    : `Kickstart: ${frameworkLabel}`;
}

const STATUS_MAP = {
  passed: "pass",
  failed: "fail",
  missing: "fail",
  ambiguous: "warning",
  skipped: "skipped",
};

const runId = process.env.GITHUB_RUN_ID || null;

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

const publishArgs = [];

for (const r of results) {
  const name = r.kickstart;
  const cfg = configByName.get(name);
  const docUrl = cfg?.doc || null;
  const suite = `kickstart-${name}`;
  const steps = Array.isArray(r.steps) ? r.steps : [];

  // Per-guide reports dir: that guide's own HTML plus only the screenshots its
  // own steps reference. Copying the combined 2.3MB reports/ folder into all
  // 12 suite dirs would rewrite ~28MB of binaries in the data repo every run.
  const suiteReportsDir = path.join(stageDir, `reports-${suite}`);
  const guideHtml = path.join(reportsSrcDir, `${slug(name)}.html`);
  let reportFileName = null;
  if (fs.existsSync(guideHtml)) {
    fs.mkdirSync(suiteReportsDir, { recursive: true });
    reportFileName = `${slug(name)}.html`;
    fs.copyFileSync(guideHtml, path.join(suiteReportsDir, reportFileName));
    for (const s of steps) {
      if (!s.evidence) continue;
      const shot = path.join(reportsSrcDir, path.basename(s.evidence));
      if (fs.existsSync(shot)) {
        fs.copyFileSync(shot, path.join(suiteReportsDir, path.basename(shot)));
      }
    }
  }
  const reportUrl = reportFileName
    ? `data/${PROJECT}/${suite}/reports/${reportFileName}`
    : null;

  const items = steps.map((s) => {
    const status = STATUS_MAP[s.status] || "fail";
    return {
      name: s.step?.title || `step ${s.step?.index}`,
      status,
      detail: status === "pass" ? null : s.detail || null,
      docLink: docUrl,
      // Only non-passing rows get an inline report — a "Report" toggle on a
      // clean pass just opens the same guide report 12 times over.
      ...(status !== "pass" && reportUrl ? { reportUrl } : {}),
    };
  });

  const totals = {
    total: items.length,
    passed: items.filter((i) => i.status === "pass").length,
    failed: items.filter((i) => i.status === "fail").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    warnings: items.filter((i) => i.status === "warning").length,
    timedOut: 0,
    interrupted: 0,
  };

  const normalized = {
    schemaVersion: 1,
    project: PROJECT,
    projectLabel: PROJECT_LABEL,
    suite,
    suiteLabel: suiteLabelFor(name, cfg),
    // Folder this doc sits in on the dashboard (see SCHEMA.md "group").
    group: "kickstart-guides",
    groupLabel: "Kickstart Guides",
    runId,
    runUrl: runId ? `https://github.com/${REPO}/actions/runs/${runId}` : null,
    artifactsUrl: runId ? `https://github.com/${REPO}/actions/runs/${runId}#artifacts` : null,
    timestamp: r.startedAt || source.generatedAt || new Date().toISOString(),
    durationSeconds: null,
    totals,
    // failedItems kept for schema-v1 consumers; items[] is the richer view.
    failedItems: items
      .filter((i) => i.status === "fail")
      .map(({ name, detail, docLink, reportUrl }) => ({
        name,
        detail: detail || "failed",
        docLink,
        ...(reportUrl ? { reportUrl } : {}),
      })),
    items,
    itemsLabel: "Checked steps", // these are doc steps, not URLs
    docLinks: docUrl ? [docUrl] : [],
  };

  const jsonPath = path.join(stageDir, `${suite}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(normalized, null, 2) + "\n");
  publishArgs.push(reportFileName ? `${jsonPath}:${suiteReportsDir}` : jsonPath);
  console.error(
    `staged ${suite} (${totals.passed}/${totals.total} passed, ${totals.failed} failed)`
  );
}

if (publishArgs.length === 0) {
  console.error("kickstart-automation adapter: report contained no results — nothing to publish");
  process.exit(1);
}

process.stdout.write(publishArgs.join("\n") + "\n");

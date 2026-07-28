/**
 * HTML gap report - same dark Contentstack styling as the sibling
 * automations' reports so the dashboards feel like one family.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { RunReport } from "../types.js";

const PILL: Record<string, { bg: string; fg: string; label?: string }> = {
  pass: { bg: "#B0F7BA", fg: "#1A1919", label: "PASS" },
  fail: { bg: "#FF6B6B", fg: "#1A1919", label: "FAIL" },
  "no-example": { bg: "#525B89", fg: "#F5F5F4", label: "NO EXAMPLE" },
  skipped: { bg: "#525B89", fg: "#F5F5F4", label: "SKIPPED" },
  "missing-method": { bg: "#FF6B6B", fg: "#1A1919", label: "MISSING METHOD" },
  "output-mismatch": { bg: "#F7C56B", fg: "#1A1919", label: "OUTPUT" },
  lint: { bg: "#F7D07B", fg: "#1A1919", label: "LINT" },
};

function pill(kind: string): string {
  const c = PILL[kind] ?? PILL.lint;
  return `<span class="pill" style="background:${c.bg};color:${c.fg}">${c.label ?? kind}</span>`;
}

function esc(s: string | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function generateHtml(r: RunReport): string {
  const passCount = r.results.filter((x) => x.outcome === "pass").length;
  const failCount = r.results.filter((x) => x.outcome === "fail").length;
  const noExampleCount = r.results.filter((x) => x.outcome === "no-example").length;
  const skippedCount = r.results.filter((x) => x.outcome === "skipped").length;

  const resultRows = r.results
    .map(
      (res) => `<tr data-status="${res.outcome}">
      <td>${pill(res.outcome)}</td>
      <td class="mono">${esc(res.method)}</td>
      <td class="dim">${esc(res.navSection)}</td>
      <td class="dim">${Object.entries(res.substitutions).map(([k, v]) => esc(`${k} → ${v}`)).join("<br>") || "—"}</td>
      <td class="mono">${esc(res.error ?? res.skipReason ?? res.resolvedOutput ?? "")}</td>
    </tr>`
    )
    .join("\n");

  const findingRows = r.findings
    .map(
      (f) => `<tr>
      <td>${pill(f.kind)}</td>
      <td class="mono">${esc(f.method)}</td>
      <td class="dim">${esc(f.navSection)}</td>
      <td>${esc(f.detail)}</td>
    </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>SDK Docs Validation — ${esc(r.docName)}</title>
<style>
  body { margin:0; background:#1A1919; color:#F5F5F4; font-family:Inter,system-ui,-apple-system,sans-serif; padding:40px; }
  .eyebrow { color:#AC75FF; font-weight:500; text-transform:uppercase; letter-spacing:.08em; font-size:12px; }
  h1 { margin:6px 0 4px; font-size:26px; }
  h2 { font-size:16px; margin:0 0 12px; }
  .sub { color:#9A9998; font-size:14px; margin-bottom:28px; }
  .sub a { color:#AC75FF; }
  .card { background:#292928; border:1px solid #393838; border-radius:12px; padding:20px 22px; margin-bottom:22px; }
  .pill { display:inline-block; padding:2px 10px; border-radius:99px; font-size:11px; font-weight:600; white-space:nowrap; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#9A9998; font-weight:500; border-bottom:1px solid #393838; padding:8px 10px; }
  td { border-bottom:1px solid #262525; padding:10px; vertical-align:top; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; word-break:break-all; }
  .dim { color:#9A9998; font-size:12px; }
  .kpis { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:22px; }
  .kpi { background:#292928; border:1px solid #393838; border-radius:12px; padding:14px 20px; min-width:130px; }
  .kpi .n { font-size:24px; font-weight:600; }
  .kpi .l { color:#9A9998; font-size:12px; margin-top:2px; }
  .filters { display:flex; gap:8px; margin-bottom:16px; }
  .filter-btn { background:#232322; border:1px solid #393838; color:#D8D7D5; font-size:12px; font-weight:600; padding:6px 14px; border-radius:99px; cursor:pointer; }
  .filter-btn:hover { border-color:#525B89; }
  .filter-btn.active { background:#AC75FF; border-color:#AC75FF; color:#1A1919; }
</style></head><body>
<div class="eyebrow">SDK Docs Automation</div>
<h1>${esc(r.docName)}</h1>
<div class="sub">
  <a href="${esc(r.docUrl)}">${esc(r.docUrl)}</a> · run ${esc(r.runId)}
</div>

<div class="kpis">
  <div class="kpi"><div class="n">${passCount}</div><div class="l">snippets passed</div></div>
  <div class="kpi"><div class="n">${failCount}</div><div class="l">snippets failed</div></div>
  <div class="kpi"><div class="n">${noExampleCount}</div><div class="l">no example to run</div></div>
  ${skippedCount ? `<div class="kpi"><div class="n">${skippedCount}</div><div class="l">skipped (safety)</div></div>` : ""}
  <div class="kpi"><div class="n">${r.findings.length}</div><div class="l">audit findings</div></div>
</div>

<div class="card"><h2>Every method's example, executed verbatim</h2>
<div class="filters" id="result-filters">
  <button class="filter-btn active" data-filter="all">All (${r.results.length})</button>
  <button class="filter-btn" data-filter="fail">Fail (${failCount})</button>
  <button class="filter-btn" data-filter="pass">Pass (${passCount})</button>
  <button class="filter-btn" data-filter="no-example">No example (${noExampleCount})</button>
  ${skippedCount ? `<button class="filter-btn" data-filter="skipped">Skipped (${skippedCount})</button>` : ""}
</div>
<table id="results-table"><tr><th>Status</th><th>Method</th><th>Nav section</th><th>Dummy → real substitutions</th><th>Result / error</th></tr>${resultRows}</table></div>
<script>
(function () {
  var buttons = document.querySelectorAll('#result-filters .filter-btn');
  var rows = document.querySelectorAll('#results-table tr[data-status]');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var filter = btn.getAttribute('data-filter');
      rows.forEach(function (row) {
        row.style.display = filter === 'all' || row.getAttribute('data-status') === filter ? '' : 'none';
      });
    });
  });
})();
</script>

<div class="card"><h2>Audit findings — missing methods, output shape, doc-text lint</h2>
${
  findingRows
    ? `<table><tr><th>Kind</th><th>Method</th><th>Nav section</th><th>Detail</th></tr>${findingRows}</table>`
    : `<div class="dim">No findings. ✓</div>`
}</div>
</body></html>`;
}

export function writeReport(r: RunReport, reportsDir: string): void {
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(`${reportsDir}/latest.json`, JSON.stringify(r, null, 2));
  writeFileSync(`${reportsDir}/${r.docName}-${r.runId}.json`, JSON.stringify(r, null, 2));
  writeFileSync(`${reportsDir}/index.html`, generateHtml(r));
}

// Regenerate from reports/latest.json: `npm run report`
if (process.argv[1]?.endsWith("generateReport.ts")) {
  const reportsDir = new URL("../../reports", import.meta.url).pathname;
  const r: RunReport = JSON.parse(readFileSync(`${reportsDir}/latest.json`, "utf8"));
  writeFileSync(`${reportsDir}/index.html`, generateHtml(r));
  console.log(`Wrote ${reportsDir}/index.html`);
}

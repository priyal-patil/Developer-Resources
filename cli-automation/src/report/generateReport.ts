/**
 * HTML gap report — same dark Contentstack styling as the kickstart
 * automation's reports so the two dashboards feel like siblings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { RunReport } from "../types.js";

const PILL: Record<string, { bg: string; fg: string; label?: string }> = {
  pass: { bg: "#B0F7BA", fg: "#1A1919", label: "PASS" },
  fail: { bg: "#FF6B6B", fg: "#1A1919", label: "FAIL" },
  skipped: { bg: "#525B89", fg: "#F5F5F4", label: "SKIPPED" },
  "missing-in-doc": { bg: "#F7C56B", fg: "#1A1919", label: "MISSING IN DOC" },
  "extra-in-doc": { bg: "#FF6B6B", fg: "#1A1919", label: "EXTRA IN DOC" },
  "short-flag-mismatch": { bg: "#F7D07B", fg: "#1A1919", label: "SHORT FLAG" },
  "description-mismatch": { bg: "#F7D07B", fg: "#1A1919", label: "DESCRIPTION" },
  "missing-on-disk": { bg: "#FF6B6B", fg: "#1A1919", label: "MISSING ON DISK" },
  "extra-on-disk": { bg: "#F7C56B", fg: "#1A1919", label: "EXTRA ON DISK" },
  note: { bg: "#525B89", fg: "#F5F5F4", label: "NOTE" },
  info: { bg: "#525B89", fg: "#F5F5F4", label: "INFO" },
};

function pill(kind: string): string {
  const c = PILL[kind] ?? PILL.note;
  return `<span class="pill" style="background:${c.bg};color:${c.fg}">${c.label ?? kind}</span>`;
}

function esc(s: string | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function generateHtml(r: RunReport): string {
  const verdictPill =
    r.verdict === "PASS"
      ? `<span class="pill" style="background:#B0F7BA;color:#1A1919">ALL GOOD</span>`
      : `<span class="pill" style="background:#FF6B6B;color:#1A1919">${r.gapCount} GAPS FOUND</span>`;

  // The doc's own markdown often repeats the exact same bare command
  // verbatim in multiple, non-adjacent sections (main walkthrough, then
  // "Alternatively", then "Examples") — each is a genuinely separate
  // block we still execute independently, but showing 3 identical rows
  // (interleaved with the doc's other, different flagged examples) just
  // reads as noise. Group every row that's fully identical (same command,
  // section, substitutions, and result) wherever it appears into one row
  // with an "×N" count, at its first-seen position — no underlying data
  // is dropped, only the display collapses.
  const execRowKey = (x: (typeof r.execResults)[number]) => `${x.status}|${x.docCommand}|${x.section}|${x.substitutions.join(",")}|${x.gap ?? x.skipReason ?? ""}`;
  const groups = new Map<string, { e: (typeof r.execResults)[number]; count: number }>();
  const dedupedExecRows: { e: (typeof r.execResults)[number]; count: number }[] = [];
  for (const e of r.execResults) {
    const key = execRowKey(e);
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      const entry = { e, count: 1 };
      groups.set(key, entry);
      dedupedExecRows.push(entry);
    }
  }

  const execRows = dedupedExecRows
    .map(
      ({ e, count }) => `<tr>
      <td>${pill(e.status)}${count > 1 ? ` <span class="dim">×${count}</span>` : ""}</td>
      <td class="mono">${esc(e.docCommand)}</td>
      <td class="dim">${esc(e.section)}${e.label ? `<br><em>${esc(e.label)}</em>` : ""}</td>
      <td class="dim">${e.substitutions.map(esc).join("<br>") || "—"}</td>
      <td>${esc(e.gap ?? e.skipReason ?? "")}</td>
    </tr>`
    )
    .join("\n");

  const flagRows = r.flagAudits
    .flatMap((a) =>
      a.findings.map(
        (f) => `<tr>
        <td class="mono">${esc(a.command)}</td>
        <td>${pill(f.kind)}</td>
        <td class="mono">${esc(f.flag)}</td>
        <td>${esc(f.doc ?? "—")}</td>
        <td>${esc(f.cli ?? "—")}</td>
      </tr>`
      )
    )
    .join("\n");

  const structRows = r.structureFindings
    .map((f) => `<tr><td>${pill(f.kind)}</td><td class="mono">${esc(f.entry)}</td><td>${esc(f.detail)}</td></tr>`)
    .join("\n");

  const lintRows = (r.lintFindings ?? [])
    .map(
      (f) =>
        `<tr><td class="dim">${f.blockId >= 0 ? `block #${f.blockId}` : "prose"}</td><td>${esc(f.issue)}</td><td class="mono">${esc(f.snippet)}</td><td class="dim">${esc(f.section)}</td></tr>`
    )
    .join("\n");

  const prereqRows = r.prerequisites
    .map((p) => `<tr><td>${pill(p.status)}</td><td>${esc(p.text)}</td><td class="dim">${esc(p.detail)}</td></tr>`)
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>CLI Docs Validation — ${esc(r.doc.title)}</title>
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
</style></head><body>
<div class="eyebrow">CLI Docs Automation</div>
<h1>${esc(r.doc.title)} ${verdictPill}</h1>
<div class="sub">
  <a href="${esc(r.doc.url)}">${esc(r.doc.url)}</a> · doc last_updated ${esc(r.doc.lastUpdated)} ·
  run ${esc(r.startedAt)} → ${esc(r.finishedAt)} ·
  csdx ${esc(r.environment.csdxVersion)} on node ${esc(r.environment.node)} · region ${esc(r.environment.region)} ·
  stack ${esc(r.environment.stackName)} (deleted: ${r.teardown.stackDeleted})
</div>

<div class="kpis">
  <div class="kpi"><div class="n">${r.execResults.filter((e) => e.status === "pass").length}</div><div class="l">commands passed</div></div>
  <div class="kpi"><div class="n">${r.execResults.filter((e) => e.status === "fail").length}</div><div class="l">commands failed</div></div>
  <div class="kpi"><div class="n">${r.execResults.filter((e) => e.status === "skipped").length}</div><div class="l">skipped (platform)</div></div>
  <div class="kpi"><div class="n">${r.flagAudits.reduce((n, a) => n + a.findings.length, 0)}</div><div class="l">flag findings</div></div>
  <div class="kpi"><div class="n">${r.structureFindings.filter((f) => f.kind !== "note").length}</div><div class="l">structure gaps</div></div>
</div>

<div class="card"><h2>Prerequisites</h2>
<table><tr><th>Status</th><th>Prerequisite</th><th>Detail</th></tr>${prereqRows}</table></div>

<div class="card"><h2>Flag audit — doc Options table vs <span class="mono">--help</span></h2>
${
  flagRows
    ? `<table><tr><th>Command</th><th>Finding</th><th>Flag</th><th>Doc says</th><th>CLI says</th></tr>${flagRows}</table>`
    : `<div class="dim">Doc Options table matches --help exactly. ✓</div>`
}</div>

<div class="card"><h2>Doc text lint (code blocks + prose) — typos, smart quotes, invisible characters</h2>
${
  lintRows
    ? `<table><tr><th>Block</th><th>Issue</th><th>Snippet</th><th>Section</th></tr>${lintRows}</table>`
    : `<div class="dim">No typos, smart quotes, or invisible characters in any code block. ✓</div>`
}</div>

<div class="card"><h2>Every command &amp; example, executed verbatim</h2>
<table><tr><th>Status</th><th>Command (as documented)</th><th>Section</th><th>Dummy → real substitutions</th><th>Gap / reason</th></tr>${execRows}</table></div>

<div class="card"><h2>Export directory structure — doc tree vs disk</h2>
${
  structRows
    ? `<table><tr><th>Finding</th><th>Entry</th><th>Detail</th></tr>${structRows}</table>`
    : `<div class="dim">Doc tree matches the exported directory exactly. ✓</div>`
}</div>

<div class="card"><h2>Teardown</h2>
<div class="dim">Stack deleted: ${r.teardown.stackDeleted} · token alias removed: ${r.teardown.aliasRemoved} · csdx config restored: ${r.teardown.configRestored}</div></div>
</body></html>`;
}

// Regenerate from reports/latest.json: `npm run report`
if (process.argv[1]?.endsWith("generateReport.ts")) {
  const r = JSON.parse(readFileSync("reports/latest.json", "utf8")) as RunReport;
  writeFileSync("reports/index.html", generateHtml(r));
  console.log("reports/index.html regenerated");
}

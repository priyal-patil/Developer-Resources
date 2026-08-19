/**
 * STAGE 4 — REPORT
 *
 * Emits reports/latest.json (machine) and reports/index.html (human), flagging per
 * step: BROKEN (failed), MISSING, AMBIGUOUS. On-brand Contentstack Tier-2 styling.
 */
import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { KickstartResult, StepResult, StepStatus } from "../types.js";

export function generateReport(results: KickstartResult[], outPath: string): void {
  const summary = {
    generatedAt: new Date().toISOString(),
    totals: { kickstarts: results.length, failed: results.filter((r) => !r.ok).length },
    results,
  };
  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  const htmlPath = join(dirname(outPath), "index.html");
  writeFileSync(htmlPath, renderHtml(results));
  console.log(`Report: ${outPath}\n        ${htmlPath}`);
}

const COLORS: Record<StepStatus, { bg: string; fg: string; label: string }> = {
  passed: { bg: "#B0F7BA", fg: "#1A1919", label: "PASS" },
  failed: { bg: "#FF6B6B", fg: "#1A1919", label: "BROKEN" },
  missing: { bg: "#F7C56B", fg: "#1A1919", label: "MISSING" },
  ambiguous: { bg: "#F7D07B", fg: "#1A1919", label: "AMBIGUOUS" },
  skipped: { bg: "#525B89", fg: "#F5F5F4", label: "SKIPPED" },
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Anchor id for a kickstart's card, so the dashboard can link straight to it. */
export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-");

function pill(status: StepStatus): string {
  const c = COLORS[status] ?? COLORS.skipped;
  return `<span class="pill" style="background:${c.bg};color:${c.fg}">${c.label}</span>`;
}

function stepRow(s: StepResult): string {
  const shot = s.evidence
    ? `<a href="${basename(s.evidence)}" target="_blank"><img class="shot" src="${basename(s.evidence)}" alt="screenshot"></a>`
    : "";
  return `<tr>
    <td>${pill(s.status)}</td>
    <td><span class="kind">${s.step.kind}</span></td>
    <td class="title">${esc(s.step.title)}</td>
    <td class="detail"><pre>${esc(s.detail ?? "")}</pre>${shot}</td>
  </tr>`;
}

function card(r: KickstartResult): string {
  const badge = r.ok
    ? `<span class="pill" style="background:#B0F7BA;color:#1A1919">ALL GOOD</span>`
    : `<span class="pill" style="background:#FF6B6B;color:#1A1919">ISSUES FOUND</span>`;
  const counts = (["failed", "ambiguous", "missing", "passed", "skipped"] as StepStatus[])
    .map((st) => ({ st, n: r.steps.filter((s) => s.status === st).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${COLORS[x.st].label.toLowerCase()}`)
    .join(" · ");
  return `<section class="card" id="${slug(r.kickstart)}">
    <div class="card-head">
      <h2>${esc(r.kickstart)}</h2>${badge}
    </div>
    <div class="meta">${counts} &nbsp;·&nbsp; ${esc(r.startedAt)}</div>
    <table>
      <thead><tr><th>Status</th><th>Type</th><th>Step</th><th>Detail</th></tr></thead>
      <tbody>${r.steps.map(stepRow).join("")}</tbody>
    </table>
  </section>`;
}

function renderHtml(results: KickstartResult[]): string {
  const failed = results.filter((r) => !r.ok).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kickstart Docs — Validation Report</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#1A1919; color:#F5F5F4; font-family:Inter,system-ui,-apple-system,sans-serif; padding:40px; }
  .eyebrow { color:#AC75FF; font-weight:500; text-transform:uppercase; letter-spacing:.08em; font-size:12px; }
  h1 { margin:6px 0 4px; font-size:28px; }
  .sub { color:#9A9998; font-size:14px; margin-bottom:28px; }
  .card { background:#292928; border:1px solid #393838; border-radius:12px; padding:20px 22px; margin-bottom:22px; }
  .card-head { display:flex; align-items:center; gap:12px; }
  .card-head h2 { margin:0; font-size:20px; flex:0 0 auto; }
  .meta { color:#797777; font-size:12px; margin:6px 0 14px; }
  .pill { font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; letter-spacing:.03em; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#9A9998; font-weight:500; border-bottom:1px solid #393838; padding:8px 10px; }
  td { border-bottom:1px solid #262525; padding:10px; vertical-align:top; }
  .kind { color:#899CFA; font-family:ui-monospace,monospace; font-size:12px; }
  .title { font-weight:500; }
  .detail pre { margin:0; white-space:pre-wrap; color:#C9C7C6; font-family:ui-monospace,monospace; font-size:12px; line-height:1.5; }
  .shot { margin-top:10px; max-width:360px; border:1px solid #393838; border-radius:8px; display:block; }
  footer { color:#484747; font-size:11px; margin-top:20px; }
</style></head>
<body>
  <div class="eyebrow">Kickstart Docs Automation</div>
  <h1>Validation Report</h1>
  <div class="sub">${results.length} kickstart${results.length === 1 ? "" : "s"} checked · ${failed} with issues · generated ${new Date().toISOString()}</div>
  ${results.map(card).join("")}
  <footer>Auto-generated by kickstart-automation · reads each doc, performs the steps, verifies the app, flags broken/missing/ambiguous steps.</footer>
</body></html>`;
}

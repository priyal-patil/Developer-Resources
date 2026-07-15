/**
 * Orchestrator: parse doc → snapshot csdx config → seed QA stack →
 * execute every block verbatim → flag audit → structure check →
 * teardown → report.
 *
 *   npm run run-one            # first doc in config/docs.json
 *   npm run run-one -- <name>  # doc by name
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchDocMarkdown, parseDoc } from "./parse/parseDoc.js";
import { seed } from "./setup/seed.js";
import { prepareImportDoc, deleteSourceStack } from "./setup/prepareImport.js";
import { csdxEnv, node22Bin, run, snapshotCsdxConfig } from "./setup/csdx.js";
import { teardown } from "./setup/teardown.js";
import { executeDoc } from "./execute/executeDoc.js";
import { auditFlags, getCliFlags } from "./verify/flagAudit.js";
import { checkStructure } from "./verify/structureCheck.js";
import { lintBlocks, lintProse } from "./verify/lintBlocks.js";
import { generateHtml } from "./report/generateReport.js";
import type { RunReport } from "./types.js";

const CONFIG = JSON.parse(readFileSync("config/docs.json", "utf8")) as {
  docs: { name: string; url: string; commands: string[]; needsSourceExport?: boolean }[];
};

const docName = process.argv[2];
const docCfg = docName ? CONFIG.docs.find((d) => d.name === docName) : CONFIG.docs[0];
if (!docCfg) throw new Error(`Doc "${docName}" not found in config/docs.json`);

const startedAt = new Date().toISOString();
const runId = startedAt.slice(0, 19).replace(/[:T]/g, "-");
const runDir = path.resolve("workdir", `run-${runId}`);
const configBackup = path.resolve("workdir", ".csdx-config-backup");
mkdirSync(runDir, { recursive: true });

console.log(`\n━━ cli-automation: ${docCfg.name} ━━`);
console.log(`Doc: ${docCfg.url}`);

// ── Parse ──────────────────────────────────────────────────────────────
console.log("\n[1/6] Parsing doc…");
const md = await fetchDocMarkdown(docCfg.url);
const doc = parseDoc(docCfg.name, md);
console.log(`  ${doc.blocks.length} code blocks, ${doc.options.length} option rows, ${doc.prerequisites.length} prerequisites (last_updated: ${doc.lastUpdated})`);

// Static text lint — code blocks (typos, smart quotes, invisible chars) plus
// prose (malformed command mentions, dash-flags, quote mismatches, doubled words).
const lintFindings = [
  ...lintBlocks(doc.blocks),
  ...lintProse(doc.prose, doc.options.map((o) => o.flag)),
];
console.log(`  Text lint (code blocks + prose): ${lintFindings.length} finding(s)`);
for (const f of lintFindings) console.log(`    - [${f.label === "(prose)" ? "prose" : `block #${f.blockId}`}] ${f.issue}: ${f.snippet}`);

// ── Prerequisite checks ────────────────────────────────────────────────
console.log("\n[2/6] Checking prerequisites…");
const prereqResults: RunReport["prerequisites"] = [];
const nodeV = await run("node --version", { timeoutMs: 30_000 });
const csdxV = await run("csdx --version", { timeoutMs: 60_000 });
const csdxVersion = csdxV.output.match(/@contentstack\/cli\/([\d.]+)/)?.[1] ?? "unknown";
for (const p of doc.prerequisites) {
  let status: "pass" | "fail" | "info" = "info";
  let detail: string | undefined;
  if (/CLI.*installed|installed.*CLI/i.test(p)) {
    status = csdxV.exitCode === 0 ? "pass" : "fail";
    detail = `csdx ${csdxVersion} on node ${nodeV.output.trim()}`;
  } else if (/authenticated/i.test(p)) {
    detail = "performed during setup (csdx auth:login)";
    status = "pass";
  } else if (/management token/i.test(p)) {
    detail = "performed during setup (token created + alias registered)";
    status = "pass";
  } else if (/account/i.test(p)) {
    detail = "QA org account from .env";
    status = "pass";
  }
  prereqResults.push({ text: p, status, detail });
  console.log(`  [${status}] ${p}${detail ? ` — ${detail}` : ""}`);
}

// ── Setup ──────────────────────────────────────────────────────────────
console.log("\n[3/6] Setup: snapshot csdx config + seed QA stack…");
const hadConfig = snapshotCsdxConfig(configBackup);
if (!hadConfig) console.log("  (no existing csdx config to snapshot)");
let ctx = await seed();
console.log(`  Stack ready: ${ctx.stackName} (${ctx.stackApiKey})`);

// Docs like import-content need real exported content to work with, and
// their examples target a DESTINATION stack distinct from the one they
// exported from — swap in a second, empty stack and re-point the alias.
let sourceStackApiKey: string | undefined;
if (docCfg.needsSourceExport) {
  console.log("  Preparing source export + destination stack for this doc…");
  const prep = await prepareImportDoc(ctx, runDir);
  sourceStackApiKey = prep.sourceStackApiKey;
  ctx = prep.ctx;
  console.log(`  Destination stack ready: ${ctx.stackName} (${ctx.stackApiKey})`);
}

let report: RunReport | null = null;
try {
  // ── Execute every block ──────────────────────────────────────────────
  console.log("\n[4/6] Executing every command/example from the doc…");
  const execResults = await executeDoc(doc, ctx, runDir, console.log);

  // ── Flag audit ───────────────────────────────────────────────────────
  console.log("\n[5/6] Flag audit (doc Options vs --help)…");
  const flagAudits: RunReport["flagAudits"] = [];
  for (const command of docCfg.commands) {
    // Prefer this command's own inline Options list (multi-command docs like
    // cli-authentication / configure-regions); fall back to the doc's single
    // shared Options table (single-command docs like export-content).
    const docOptions = doc.commandOptions[command]?.length ? doc.commandOptions[command] : doc.options;
    try {
      const cliFlags = await getCliFlags(command);
      const findings = auditFlags(docOptions, cliFlags);
      flagAudits.push({ command, docOptionCount: docOptions.length, cliFlagCount: cliFlags.length, findings });
      console.log(`  ${command}: ${cliFlags.length} CLI flags vs ${docOptions.length} doc options → ${findings.length} findings`);
      for (const f of findings) console.log(`    - ${f.kind}: ${f.flag}`);
    } catch (e) {
      flagAudits.push({
        command,
        docOptionCount: docOptions.length,
        cliFlagCount: 0,
        findings: [{ kind: "extra-in-doc", flag: `(command "${command}" itself)`, doc: (e as Error).message.slice(0, 200) }],
      });
      console.log(`  ${command}: --help FAILED — ${(e as Error).message.slice(0, 120)}`);
    }
  }

  // ── Structure check ──────────────────────────────────────────────────
  const treeBlocks = doc.blocks.filter((b) => b.kind === "tree");
  const structureFindings = checkStructure(treeBlocks, path.join(runDir, "export"));
  for (const f of structureFindings) console.log(`  [structure:${f.kind}] ${f.entry}${f.detail ? ` — ${f.detail}` : ""}`);

  // ── Teardown ─────────────────────────────────────────────────────────
  console.log("\n[6/6] Teardown: delete stack, remove alias, restore csdx config…");
  const td = await teardown(ctx.stackApiKey, ctx.alias, configBackup);
  if (sourceStackApiKey) {
    const sourceDeleted = await deleteSourceStack(sourceStackApiKey).catch(() => false);
    console.log(`  source stack deleted=${sourceDeleted}`);
    td.stackDeleted = td.stackDeleted && sourceDeleted;
  }
  console.log(`  stackDeleted=${td.stackDeleted} aliasRemoved=${td.aliasRemoved} configRestored=${td.configRestored}`);

  const gapCount =
    execResults.filter((r) => r.status === "fail").length +
    flagAudits.reduce((n, a) => n + a.findings.length, 0) +
    structureFindings.filter((f) => f.kind !== "note").length +
    lintFindings.length;

  report = {
    doc: { name: doc.name, title: doc.title, url: doc.url, lastUpdated: doc.lastUpdated },
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: {
      node: nodeV.output.trim(),
      csdxVersion,
      region: process.env.CONTENTSTACK_REGION ?? "AWS-NA",
      stackApiKey: ctx.stackApiKey,
      stackName: ctx.stackName,
    },
    prerequisites: prereqResults,
    execResults,
    flagFindings: flagAudits.flatMap((a) => a.findings),
    flagAudits,
    structureFindings,
    lintFindings,
    teardown: td,
    verdict: gapCount === 0 ? "PASS" : "GAPS",
    gapCount,
  };
} catch (err) {
  // Never leave a stack behind, even on a crash mid-run.
  console.error(`\nRun crashed: ${(err as Error).message}\nTearing down…`);
  await teardown(ctx.stackApiKey, ctx.alias, configBackup).catch(() => {});
  if (sourceStackApiKey) await deleteSourceStack(sourceStackApiKey).catch(() => {});
  throw err;
}

mkdirSync("reports", { recursive: true });
writeFileSync("reports/latest.json", JSON.stringify(report, null, 2));
writeFileSync(`reports/${docCfg.name}-${runId}.json`, JSON.stringify(report, null, 2));
writeFileSync("reports/index.html", generateHtml(report));
console.log(`\n━━ VERDICT: ${report.verdict} (${report.gapCount} gaps) ━━`);
console.log("Report: reports/index.html  |  reports/latest.json");

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
import { prepareCloneAliases, teardownCloneAliases } from "./setup/prepareClone.js";
import { findLaunchProjectByName, deleteLaunchProject } from "./api/launch.js";
import { createTaxonomy, createRteContentType, createRteEntry, findStackByName, deleteStack } from "./api/contentstack.js";
import { prepareMigrationExamples } from "./setup/prepareMigrationExamples.js";
import { prepareAppsCli, deleteDevHubApp, findAppByName } from "./setup/prepareAppsCli.js";
import { prepareTaxonomyMigration } from "./setup/prepareTaxonomyMigration.js";
import { prepareReferenceUidFix } from "./setup/prepareReferenceUidFix.js";
import { prepareMigrateBetweenStacks } from "./setup/prepareMigrateBetweenStacks.js";
import { csdxEnv, node22Bin, run, snapshotCsdxConfig } from "./setup/csdx.js";
import { teardown } from "./setup/teardown.js";
import { executeDoc } from "./execute/executeDoc.js";
import { auditFlags, getCliFlags } from "./verify/flagAudit.js";
import { checkStructure } from "./verify/structureCheck.js";
import { lintBlocks, lintProse } from "./verify/lintBlocks.js";
import { generateHtml } from "./report/generateReport.js";
import type { RunReport } from "./types.js";

const CONFIG = JSON.parse(readFileSync("config/docs.json", "utf8")) as {
  docs: {
    name: string;
    url: string;
    commands: string[];
    needsSourceExport?: boolean;
    needsCloneAliases?: boolean;
    needsTaxonomy?: boolean;
    needsRteFields?: boolean;
    needsMigrationExamples?: boolean;
    needsAppsCli?: boolean;
    needsTaxonomyMigration?: boolean;
    needsReferenceUidFix?: boolean;
    needsMigrateBetweenStacks?: boolean;
    needsCustomPluginCleanup?: boolean;
  }[];
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
  ctx = { ...prep.ctx, sourceStackApiKeyForMigration: prep.sourceStackApiKey };
  console.log(`  Destination stack ready: ${ctx.stackName} (${ctx.stackApiKey})`);
}

// update-missing-reference-uids needs a real prior cm:stacks:import to have
// happened (its own prerequisite) so a genuine backup/mapper directory
// exists for the doc's linked fixup script to read.
if (docCfg.needsReferenceUidFix) {
  console.log("  Preparing a real import + genuine mapper backup for the reference-uid-fix doc…");
  const prep = await prepareReferenceUidFix(ctx, runDir);
  sourceStackApiKey = prep.sourceStackApiKey;
  ctx = { ...prep.ctx, referenceFixScriptPath: prep.scriptPath, referenceFixConfigPath: prep.configPath };
  console.log(`  Ready: script=${prep.scriptPath} config=${prep.configPath}`);
}

// The cli-supported-features doc uses two aliases at once (source-alias,
// target-alias) for its clone/marketplace examples — register both,
// pointing at the seeded stack and a second empty one, matching the doc's
// own example names exactly (no substitution needed for those examples).
let cloneDestApiKey: string | undefined;
if (docCfg.needsCloneAliases) {
  console.log("  Registering source-alias/target-alias for clone examples…");
  const prep = await prepareCloneAliases(ctx);
  cloneDestApiKey = prep.destinationStackApiKey;
  console.log(`  Clone destination stack ready: ${cloneDestApiKey}`);
}

// export-content-to-csv's taxonomy examples need a real --taxonomy-uid to
// test against — taxonomies are stack-scoped, so one must be created fresh
// on this run's own seeded stack (the doc gives no taxonomy of its own to reuse).
if (docCfg.needsTaxonomy) {
  console.log("  Creating a real taxonomy + term for the CSV export's --taxonomy-uid examples…");
  const { taxonomyUid } = await createTaxonomy(ctx.stackApiKey, "cli_automation_taxonomy", "CLI Automation Taxonomy");
  ctx = { ...ctx, taxonomyUid };
  console.log(`  Taxonomy ready: ${taxonomyUid}`);
}

// migrate-content-from-html-rte-to-json-rte's migration commands need a
// content type that already has both an HTML RTE field (with real content
// to migrate) and a JSON RTE field — the doc's own steps describe adding
// these interactively in the app, which this run has no UI for.
if (docCfg.needsRteFields) {
  console.log("  Creating a content type with real HTML RTE + JSON RTE fields, and an entry with real RTE content…");
  await createRteContentType(ctx.stackApiKey, "rte_migration_demo");
  await createRteEntry(ctx.stackApiKey, "rte_migration_demo");
  console.log("  RTE content type + entry ready: rte_migration_demo");
}

// change-master-locale needs the real GitHub example script + real exported
// data to run its migration command against — neither is shown inline in
// that doc itself.
if (docCfg.needsMigrationExamples) {
  console.log("  Downloading the real change-master-locale example script + running two independent real exports…");
  const { scriptPath, exportDirs } = await prepareMigrationExamples(ctx, runDir);
  ctx = { ...ctx, migrationScriptPath: scriptPath, migrationExportDirs: exportDirs };
  console.log(`  Ready: script=${scriptPath} exportDirs=${exportDirs.join(", ")}`);
}

// apps-cli-plugin's whole lifecycle (get/install/update/deploy/reinstall/
// uninstall/delete) needs a real Developer Hub app to already exist.
let appUidForTeardown: string | undefined;
if (docCfg.needsAppsCli) {
  const { appUid, appName } = await prepareAppsCli(process.env.CONTENTSTACK_ORG_ID ?? "", runDir);
  ctx = { ...ctx, appUid, appName };
  appUidForTeardown = appUid;
  console.log(`  App ready: ${appName} (${appUid})`);
}

// taxonomy-migration's own command needs the real sample script + CSV it
// links to on GitHub — the doc never shows the script's content inline.
if (docCfg.needsTaxonomyMigration) {
  console.log("  Downloading the real taxonomy-migration sample script + CSV template…");
  const { scriptPath, csvPath } = await prepareTaxonomyMigration(runDir);
  ctx = { ...ctx, taxonomyMigrationScriptPath: scriptPath, taxonomyMigrationCsvPath: csvPath };
  console.log(`  Ready: script=${scriptPath} csv=${csvPath}`);
}

// migrate-content-between-stacks' own commands pass explicit -k flags for
// BOTH a source and target stack (no alias) — the already-seeded stack
// serves as the real source unchanged; only a second, empty destination
// stack needs creating.
let migrateTargetStackApiKey: string | undefined;
if (docCfg.needsMigrateBetweenStacks) {
  console.log("  Creating a second, empty destination stack for the migrate-between-stacks doc…");
  const { targetStackApiKey } = await prepareMigrateBetweenStacks(ctx.stackName);
  migrateTargetStackApiKey = targetStackApiKey;
  ctx = { ...ctx, migrateTargetStackApiKey: targetStackApiKey };
  console.log(`  Target stack ready: ${targetStackApiKey}`);
}

let report: RunReport | null = null;
let launchProjectName: string | undefined;
let createdStackNames: string[] = [];
let createdAppNames: string[] = [];
try {
  // ── Execute every block ──────────────────────────────────────────────
  console.log("\n[4/6] Executing every command/example from the doc…");
  const execDocResult = await executeDoc(doc, ctx, runDir, console.log);
  const execResults = execDocResult.results;
  launchProjectName = execDocResult.launchProjectName;
  createdStackNames = execDocResult.createdStackNames;
  createdAppNames = execDocResult.createdAppNames;

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
  if (migrateTargetStackApiKey) {
    const targetDeleted = await deleteStack(migrateTargetStackApiKey).catch(() => false);
    console.log(`  migrate-target stack deleted=${targetDeleted}`);
    td.stackDeleted = td.stackDeleted && targetDeleted;
  }
  if (docCfg.needsCustomPluginCleanup) {
    // create-custom-cli-plugins links a real "myplugin" into the global
    // csdx plugin registry, pointing at this run's own ephemeral workdir —
    // left alone, it dangles once that directory is eventually cleaned up.
    const unlinked = await run("csdx plugins:uninstall myplugin").catch(() => ({ exitCode: 1 }));
    console.log(`  myplugin unlinked=${unlinked.exitCode === 0}`);
  }
  if (cloneDestApiKey) {
    const cloneDeleted = await teardownCloneAliases(cloneDestApiKey).catch(() => false);
    console.log(`  clone destination stack + aliases removed=${cloneDeleted}`);
    td.stackDeleted = td.stackDeleted && cloneDeleted;
  }
  // No CLI delete command exists for Launch projects — go through the
  // Launch API directly, the same way stack teardown bypasses the CLI too.
  if (launchProjectName) {
    const project = await findLaunchProjectByName(launchProjectName).catch(() => undefined);
    const launchDeleted = project ? await deleteLaunchProject(project.uid).catch(() => false) : false;
    console.log(`  Launch project "${launchProjectName}" deleted=${launchDeleted}`);
    td.stackDeleted = td.stackDeleted && launchDeleted;
  }
  // cm:stacks:seed --org --stack-name creates a real, separate stack (the
  // one this doc run's own seeded stack is distinct from) — its API key
  // isn't known until after creation, so it must be looked up by name.
  for (const name of createdStackNames) {
    const found = await findStackByName(name).catch(() => undefined);
    const seededDeleted = found ? await deleteStack(found.apiKey).catch(() => false) : false;
    console.log(`  Seeded stack "${name}" deleted=${seededDeleted}`);
    td.stackDeleted = td.stackDeleted && seededDeleted;
  }
  // The doc's own app:delete example may already have deleted this app
  // during execution — deleteDevHubApp returning false here just means
  // there was nothing left to delete, not a teardown failure.
  if (appUidForTeardown) {
    const appDeleted = await deleteDevHubApp(process.env.CONTENTSTACK_ORG_ID ?? "", appUidForTeardown).catch(() => false);
    console.log(`  Developer Hub app deleted=${appDeleted} (false may just mean the doc's own app:delete example already removed it)`);
  }
  for (const name of createdAppNames) {
    const found = await findAppByName(process.env.CONTENTSTACK_ORG_ID ?? "", name).catch(() => undefined);
    const extraAppDeleted = found ? await deleteDevHubApp(process.env.CONTENTSTACK_ORG_ID ?? "", found.uid).catch(() => false) : false;
    console.log(`  Extra Developer Hub app "${name}" deleted=${extraAppDeleted}`);
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
  if (migrateTargetStackApiKey) await deleteStack(migrateTargetStackApiKey).catch(() => {});
  if (docCfg.needsCustomPluginCleanup) await run("csdx plugins:uninstall myplugin").catch(() => {});
  if (cloneDestApiKey) await teardownCloneAliases(cloneDestApiKey).catch(() => {});
  if (launchProjectName) {
    const project = await findLaunchProjectByName(launchProjectName).catch(() => undefined);
    if (project) await deleteLaunchProject(project.uid).catch(() => {});
  }
  for (const name of createdStackNames) {
    const found = await findStackByName(name).catch(() => undefined);
    if (found) await deleteStack(found.apiKey).catch(() => {});
  }
  if (appUidForTeardown) {
    await deleteDevHubApp(process.env.CONTENTSTACK_ORG_ID ?? "", appUidForTeardown).catch(() => {});
  }
  for (const name of createdAppNames) {
    const found = await findAppByName(process.env.CONTENTSTACK_ORG_ID ?? "", name).catch(() => undefined);
    if (found) await deleteDevHubApp(process.env.CONTENTSTACK_ORG_ID ?? "", found.uid).catch(() => {});
  }
  throw err;
}

mkdirSync("reports", { recursive: true });
writeFileSync("reports/latest.json", JSON.stringify(report, null, 2));
writeFileSync(`reports/${docCfg.name}-${runId}.json`, JSON.stringify(report, null, 2));
writeFileSync("reports/index.html", generateHtml(report));
console.log(`\n━━ VERDICT: ${report.verdict} (${report.gapCount} gaps) ━━`);
console.log("Report: reports/index.html  |  reports/latest.json");

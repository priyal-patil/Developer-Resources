/**
 * Extra setup specific to the update-missing-reference-uids doc.
 *
 * That doc's own prerequisite is "Import the data ... using the
 * cm:stacks:import command" — a real import must already have happened so
 * a genuine `_backup_<number>/logs/import` mapper directory (with
 * per-module uid-mapping.json files) exists on disk for the doc's own
 * reference-fixup script to read. The doc never shows the import command
 * itself, so this:
 *
 *  1. exports real content from a source stack (mirrors prepareImportDoc)
 *  2. creates an empty destination stack, re-points the "production"
 *     alias at it
 *  3. runs a REAL, full `cm:stacks:import` to generate a genuine backup +
 *     mapper directory (auto-created by the CLI itself, not fabricated)
 *  4. downloads the doc's own linked `05-Update-reference-entry-from-
 *     mapper.js` script from GitHub, verbatim — not patched even though it
 *     has real bugs (see below)
 *  5. builds a real config.json pointing at the real backup dir and this
 *     run's real content type UIDs
 *
 * Known issue in the doc's own linked script, left un-patched on purpose
 * (verbatim-execution contract — report the doc's real resource as-is):
 * `readAllModulesUids` calls an undefined `sanitizePath()` helper, and
 * `replaceEntriesWithUpdatedUids` references `uisdMapping` (typo for
 * `uidMapping`) — both are real ReferenceErrors in the published example,
 * not something introduced by this harness.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createManagementToken, createStack } from "../api/contentstack.js";
import { addTokenAlias, run } from "./csdx.js";
import type { SeedContext } from "./seed.js";

const GITHUB_SCRIPT_URL =
  "https://raw.githubusercontent.com/contentstack/cli/v2.0.0-beta/packages/contentstack-migration/examples/05-Update-reference-entry-from-mapper.js";

export interface ReferenceUidFixResult {
  ctx: SeedContext; // now points at the destination stack
  sourceStackApiKey: string;
  scriptPath: string;
  configPath: string;
}

export async function prepareReferenceUidFix(sourceCtx: SeedContext, runDir: string): Promise<ReferenceUidFixResult> {
  const exportDir = path.join(runDir, "reference-fix-export");
  console.log("  Exporting real content from source stack…");
  const exportResult = await run(`csdx cm:stacks:export -a ${sourceCtx.alias} --data-dir ${exportDir}`, {
    cwd: runDir,
    timeoutMs: 5 * 60 * 1000,
  });
  if (exportResult.exitCode !== 0) {
    throw new Error(`Pre-run export for update-missing-reference-uids doc failed: ${exportResult.output.slice(-300)}`);
  }

  console.log("  Creating empty destination stack…");
  const destName = `${sourceCtx.stackName}-reffix-dest`;
  const { apiKey: destApiKey } = await createStack(destName);
  const destToken = await createManagementToken(destApiKey);
  console.log(`  Re-pointing alias "${sourceCtx.alias}" at the destination stack…`);
  await addTokenAlias(sourceCtx.alias, destApiKey, destToken);

  console.log("  Running a real full import to generate a genuine mapper/uid-mapping backup…");
  const importResult = await run(`csdx cm:stacks:import -a ${sourceCtx.alias} --data-dir ${exportDir}`, {
    cwd: runDir,
    timeoutMs: 10 * 60 * 1000,
  });
  if (importResult.exitCode !== 0) {
    throw new Error(`Pre-run import for update-missing-reference-uids doc failed: ${importResult.output.slice(-500)}`);
  }

  // Locate the CLI's own auto-generated backup dir rather than assuming a
  // fixed relative location — verified by hand that its exact placement
  // isn't guaranteed to sit next to --data-dir.
  const findResult = await run(`find "${runDir}" -maxdepth 4 -type d -name "_backup_*"`, { cwd: runDir, timeoutMs: 30_000 });
  const backupDir = findResult.output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort()
    .pop();
  if (!backupDir) {
    throw new Error(`Could not find an auto-generated _backup_ directory after a real cm:stacks:import under ${runDir}`);
  }
  console.log(`  Found real backup dir: ${backupDir}`);

  const scriptPath = path.join(runDir, "05-Update-reference-entry-from-mapper.js");
  if (!existsSync(scriptPath)) {
    const res = await fetch(GITHUB_SCRIPT_URL);
    if (!res.ok) throw new Error(`Failed to download 05-Update-reference-entry-from-mapper.js: HTTP ${res.status}`);
    writeFileSync(scriptPath, await res.text());
  }

  const configPath = path.join(runDir, "reference-fix-config.json");
  writeFileSync(configPath, JSON.stringify({ "mapper-path": `${backupDir}/`, contentTypes: sourceCtx.contentTypes }, null, 2));

  return {
    ctx: { ...sourceCtx, stackApiKey: destApiKey, stackName: destName, managementToken: destToken },
    sourceStackApiKey: sourceCtx.stackApiKey,
    scriptPath,
    configPath,
  };
}

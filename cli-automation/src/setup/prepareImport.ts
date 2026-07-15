/**
 * Extra setup specific to the import-content doc.
 *
 * That doc's own prerequisite is "Exported content extracted (unzipped) in
 * a local folder", and its `-k`/`-a` examples target the DESTINATION stack
 * (not the source you exported from) — importing into the same stack you
 * exported from would just upsert identical content and not exercise the
 * doc as intended. So this:
 *
 *  1. runs a real `cm:stacks:export` from the seeded source stack to
 *     produce genuine ./export content on disk (satisfies the prereq)
 *  2. creates a second, empty destination stack
 *  3. re-points the `production` token alias at the destination stack
 *  4. returns an updated SeedContext whose `stackApiKey` is the
 *     destination (so `-k blt...` substitutions target it, matching what
 *     the doc's Options table says `-k` means for this command)
 *
 * Teardown must delete BOTH stacks — the source stack API key is returned
 * separately for that purpose.
 */
import path from "node:path";
import { createManagementToken, createStack, deleteStack } from "../api/contentstack.js";
import { addTokenAlias, run } from "./csdx.js";
import type { SeedContext } from "./seed.js";

export interface ImportPrepResult {
  ctx: SeedContext; // stackApiKey now points at the destination stack
  sourceStackApiKey: string; // the original seeded stack — must also be torn down
  exportDir: string;
}

export async function prepareImportDoc(sourceCtx: SeedContext, runDir: string): Promise<ImportPrepResult> {
  const exportDir = path.join(runDir, "export");
  console.log(`  Exporting real content from source stack to satisfy the doc's prerequisite…`);
  const exportResult = await run(`csdx cm:stacks:export -a ${sourceCtx.alias} --data-dir ${exportDir}`, {
    cwd: runDir,
    timeoutMs: 5 * 60 * 1000,
  });
  if (exportResult.exitCode !== 0) {
    throw new Error(`Pre-run export for import-content doc failed: ${exportResult.output.slice(-300)}`);
  }

  console.log("  Creating empty destination stack…");
  const destName = `${sourceCtx.stackName}-dest`;
  const { apiKey: destApiKey } = await createStack(destName);
  const destToken = await createManagementToken(destApiKey);

  console.log(`  Re-pointing alias "${sourceCtx.alias}" at the destination stack…`);
  await addTokenAlias(sourceCtx.alias, destApiKey, destToken);

  return {
    ctx: { ...sourceCtx, stackApiKey: destApiKey, stackName: destName, managementToken: destToken },
    sourceStackApiKey: sourceCtx.stackApiKey,
    exportDir,
  };
}

export async function deleteSourceStack(apiKey: string): Promise<boolean> {
  return deleteStack(apiKey);
}

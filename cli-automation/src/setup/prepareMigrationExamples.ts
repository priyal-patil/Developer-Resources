/**
 * Extra setup specific to the change-master-locale doc.
 *
 * That doc's own code blocks are just `cd <path-to-examples>` and the
 * `cm:stacks:migration --config ...`/`--config-file ...` invocations — it
 * never shows an actual `cm:stacks:export` block inline (Steps 1 and 4 just
 * link to the export/import docs), and the migration script itself isn't
 * shown either (readers are told to download it from GitHub). So this:
 *
 *  1. downloads the real `change-master-locale` example folder (both
 *     script versions + their `locales.json` companion — the script
 *     `require`s it from the same directory) from the exact GitHub path
 *     the doc links to
 *  2. runs a real `cm:stacks:export` from the seeded stack to produce
 *     genuine exported data on disk for `data_dir` to point at
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "./csdx.js";
import type { SeedContext } from "./seed.js";

const GITHUB_BASE = "https://raw.githubusercontent.com/contentstack/cli/v2.0.0-beta/packages/contentstack-migration/examples/change-master-locale";

export interface MigrationExamplesResult {
  scriptPath: string;
  /** Two INDEPENDENT exports — the doc's two examples (--config vs --config-file)
   * are alternative syntaxes for the SAME operation, not meant to be chained.
   * Running the migration twice against the same export corrupts it (the
   * script isn't idempotent — the second pass sees its own first-pass output
   * and misinterprets it), verified by hand. Each command gets its own fresh copy. */
  exportDirs: [string, string];
}

export async function prepareMigrationExamples(ctx: SeedContext, runDir: string): Promise<MigrationExamplesResult> {
  const examplesDir = path.join(runDir, "change-master-locale");
  mkdirSync(examplesDir, { recursive: true });
  for (const filename of ["locales.json", "01-change-master-locale.js", "02-change-master-locale-new-file-structure.js"]) {
    const dest = path.join(examplesDir, filename);
    if (existsSync(dest)) continue;
    const res = await fetch(`${GITHUB_BASE}/${filename}`);
    if (!res.ok) throw new Error(`Failed to download ${filename} from GitHub: HTTP ${res.status}`);
    writeFileSync(dest, await res.text());
  }

  const exportDirs: [string, string] = [path.join(runDir, "export-1"), path.join(runDir, "export-2")];
  for (const exportDir of exportDirs) {
    console.log(`  Exporting real content from the seeded stack to ${exportDir}…`);
    const exportResult = await run(`csdx cm:stacks:export -a ${ctx.alias} --data-dir ${exportDir}`, {
      cwd: runDir,
      timeoutMs: 5 * 60 * 1000,
    });
    if (exportResult.exitCode !== 0) {
      throw new Error(`Pre-run export for change-master-locale doc failed: ${exportResult.output.slice(-300)}`);
    }
  }

  return {
    scriptPath: path.join(examplesDir, "02-change-master-locale-new-file-structure.js"),
    exportDirs,
  };
}

/**
 * Extra setup specific to the taxonomy-migration doc.
 *
 * The doc explicitly recommends using its own real sample script and CSV
 * template from GitHub ("Preferably, use this sample script...") rather
 * than showing the script's content inline, so this downloads both real
 * files exactly as the doc links to them. substitute.ts derives its own
 * per-invocation, uid-suffixed (and optionally pipe-delimited) copies of
 * this base CSV — the doc repeats an equivalent import command 4 times
 * against the same stack, and reusing one fixed set of taxonomy uids
 * verbatim across all of them would collide.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const GITHUB_BASE = "https://raw.githubusercontent.com/contentstack/cli/v2.0.0-beta/packages/contentstack-migration/examples/taxonomies";

export interface TaxonomyMigrationResult {
  scriptPath: string;
  csvPath: string;
}

export async function prepareTaxonomyMigration(runDir: string): Promise<TaxonomyMigrationResult> {
  const scriptPath = path.join(runDir, "import-taxonomies.js");
  const csvPath = path.join(runDir, "test_taxonomies.csv");

  if (!existsSync(scriptPath)) {
    const res = await fetch(`${GITHUB_BASE}/import-taxonomies.js`);
    if (!res.ok) throw new Error(`Failed to download import-taxonomies.js from GitHub: HTTP ${res.status}`);
    writeFileSync(scriptPath, await res.text());
  }
  if (!existsSync(csvPath)) {
    const res = await fetch(`${GITHUB_BASE}/test_taxonomies.csv`);
    if (!res.ok) throw new Error(`Failed to download test_taxonomies.csv from GitHub: HTTP ${res.status}`);
    writeFileSync(csvPath, await res.text());
  }

  return { scriptPath, csvPath };
}

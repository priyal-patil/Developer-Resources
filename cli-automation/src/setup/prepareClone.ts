/**
 * Extra setup specific to the cli-supported-features doc. Unlike the other
 * docs, this one's examples use different alias names for source/destination
 * per section — and inconsistently so: the Marketplace Apps section uses
 * `source-alias`/`target-alias`, while the Clone section uses
 * `source-alias`/`destination-alias` for the same conceptual roles. Rather
 * than substitute those, seed real stacks and register token aliases under
 * every exact name the doc uses — the doc's examples then run with zero
 * substitution, same principle as seeding content types named `blog_post`
 * for the export doc.
 *
 * `source-alias` → the normal seeded stack (has content: content types,
 * entries, asset, environments — a genuine source to export/clone FROM).
 * `target-alias` and `destination-alias` → both point at a second, empty
 * stack (a genuine, collision-free destination to import/clone INTO).
 */
import { createManagementToken, createStack, deleteStack } from "../api/contentstack.js";
import { addTokenAlias, removeTokenAlias } from "./csdx.js";
import type { SeedContext } from "./seed.js";

export const SOURCE_ALIAS = "source-alias";
export const DEST_ALIASES = ["target-alias", "destination-alias"];

export interface CloneAliasesResult {
  destinationStackApiKey: string;
}

export async function prepareCloneAliases(sourceCtx: SeedContext): Promise<CloneAliasesResult> {
  console.log(`  Registering alias "${SOURCE_ALIAS}" → source stack (${sourceCtx.stackName})…`);
  await addTokenAlias(SOURCE_ALIAS, sourceCtx.stackApiKey, sourceCtx.managementToken);

  console.log("  Creating empty destination stack for clone/import target…");
  const destName = `${sourceCtx.stackName}-target`;
  const { apiKey: destApiKey } = await createStack(destName);
  const destToken = await createManagementToken(destApiKey);
  for (const alias of DEST_ALIASES) {
    console.log(`  Registering alias "${alias}" → destination stack (${destName})…`);
    await addTokenAlias(alias, destApiKey, destToken);
  }

  return { destinationStackApiKey: destApiKey };
}

export async function teardownCloneAliases(destinationStackApiKey: string): Promise<boolean> {
  await removeTokenAlias(SOURCE_ALIAS).catch(() => {});
  for (const alias of DEST_ALIASES) await removeTokenAlias(alias).catch(() => {});
  return deleteStack(destinationStackApiKey);
}

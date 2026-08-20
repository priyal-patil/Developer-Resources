/**
 * Teardown: delete the seeded stack from the QA org, drop the csdx token
 * alias, and restore the csdx global config snapshot taken before the run.
 */
import "dotenv/config";
import { deleteStack, sweepOrphanStacks } from "../api/contentstack.js";
import { removeTokenAlias, restoreCsdxConfig } from "./csdx.js";

export interface TeardownResult {
  stackDeleted: boolean;
  aliasRemoved: boolean;
  configRestored: boolean;
}

export async function teardown(
  stackApiKey: string,
  alias: string,
  configBackupDir: string
): Promise<TeardownResult> {
  // Restoring the config snapshot also removes the token alias entry the
  // run added, but remove it explicitly first in case the snapshot is stale.
  const aliasRemoved = await removeTokenAlias(alias).catch(() => false);
  const stackDeleted = await deleteStack(stackApiKey).catch(() => false);
  const configRestored = restoreCsdxConfig(configBackupDir);
  return { stackDeleted, aliasRemoved, configRestored };
}

// Manual cleanup: `npm run teardown -- <stackApiKey>`
// Sweep leftovers from earlier runs: `npm run sweep [-- <maxAgeHours>]`
if (process.argv[1]?.endsWith("teardown.ts") && process.argv[2]) {
  if (process.argv[2] === "sweep") {
    const hours = Number(process.argv[3] ?? 2);
    console.log(`Sweeping "cli-automation-*" stacks older than ${hours}h…`);
    console.log(`Swept ${await sweepOrphanStacks(hours * 60 * 60 * 1000)} stack(s).`);
  } else {
    const res = await teardown(process.argv[2], "production", "workdir/.csdx-config-backup");
    console.log(res);
  }
}

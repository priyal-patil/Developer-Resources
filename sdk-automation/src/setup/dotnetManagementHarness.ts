import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dotnetEnv } from "./dotnetHarness.js";

const execFileAsync = promisify(execFile);
const ROOT = new URL("../../", import.meta.url).pathname;
export const DOTNET_MGMT_PROJECT_DIR = `${ROOT}dotnetharness-management/Harness`;

export async function ensureDotnetManagementProject(): Promise<void> {
  // Warm the build cache against a trivial valid Program.cs, not whatever
  // broken file the previous snippet (or a previous run) left behind - the
  // same fix already needed for the Delivery .NET harness.
  const programCs = `${DOTNET_MGMT_PROJECT_DIR}/Program.cs`;
  const previous = existsSync(programCs) ? readFileSync(programCs, "utf8") : null;
  writeFileSync(programCs, `using System;\nConsole.WriteLine("warm");\n`);
  await execFileAsync("dotnet", ["build", DOTNET_MGMT_PROJECT_DIR], { env: dotnetEnv(), timeout: 120_000 });
  if (previous !== null) writeFileSync(programCs, previous);
}

export { dotnetEnv };

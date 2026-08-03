/**
 * .NET execution environment for the Delivery SDK .NET doc - a single
 * `dotnet` console project (dotnetharness/Harness) referencing the real
 * published `contentstack.csharp` NuGet package, whose Program.cs is
 * overwritten and re-run per snippet (mirrors the Java harness's cached
 * classpath resolution - `dotnet restore` is a one-time cost, `dotnet run`
 * recompiles the single file each time).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = new URL("../../", import.meta.url).pathname;
export const DOTNET_PROJECT_DIR = `${ROOT}dotnetharness/Harness`;
export const DOTNET_HOME = `${process.env.HOME}/.dotnet`;

export function dotnetEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${DOTNET_HOME}:${process.env.PATH}`, DOTNET_CLI_TELEMETRY_OPTOUT: "1" };
}

export async function ensureDotnetProject(): Promise<void> {
  if (!existsSync(`${DOTNET_PROJECT_DIR}/Harness.csproj`)) {
    await execFileAsync("dotnet", ["new", "console", "-n", "Harness", "-o", DOTNET_PROJECT_DIR, "--force"], { env: dotnetEnv() });
    await execFileAsync("dotnet", ["add", DOTNET_PROJECT_DIR, "package", "contentstack.csharp"], { env: dotnetEnv() });
    // The published contentstack.csharp package only ships a net10.0 lib
    // (confirmed: ~/.nuget/packages/contentstack.csharp/*/lib/ has no
    // netstandard/net9.0 target) - a project targeting anything lower
    // restores "successfully" but silently can't resolve the namespace at
    // compile time. Requires the .NET 10 SDK to be installed.
    const csproj = `${DOTNET_PROJECT_DIR}/Harness.csproj`;
    const contents = readFileSync(csproj, "utf8").replace(/<TargetFramework>net\d+\.\d+<\/TargetFramework>/, "<TargetFramework>net10.0</TargetFramework>");
    writeFileSync(csproj, contents);
  }
  // Warm the build cache once (against a trivial valid Program.cs, since a
  // leftover file from the previous snippet may not compile) so per-snippet
  // `dotnet run` calls are fast.
  const programCs = `${DOTNET_PROJECT_DIR}/Program.cs`;
  const previous = existsSync(programCs) ? readFileSync(programCs, "utf8") : null;
  writeFileSync(programCs, `using System;\nConsole.WriteLine("warm");\n`);
  await execFileAsync("dotnet", ["build", DOTNET_PROJECT_DIR], { env: dotnetEnv(), timeout: 120_000 });
  if (previous !== null) writeFileSync(programCs, previous);
}

/**
 * Harness for the .NET Management SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-management-sdk/dot-net/reference).
 *
 * Reuses the Delivery .NET harness's proven patterns (top-level statements,
 * stdout-first error priority for build failures, paren-depth-aware
 * missing-semicolon repair) with this doc's own placeholder convention:
 * angle-bracket-wrapped tokens quoted as string literals, e.g. `"<AUTHTOKEN>"`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { DOTNET_MGMT_PROJECT_DIR } from "../setup/dotnetManagementHarness.js";
import { dotnetEnv } from "../setup/dotnetHarness.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

function managementDotnetPlaceholderMap(overrides: Record<string, string>): Record<string, string> {
  return {
    "<AUTHTOKEN>": process.env.MGMT_AUTHTOKEN ?? "",
    "<API_KEY>": process.env.MGMT_STACK_API_KEY ?? "",
    "<API_HOST>": "api.contentstack.io",
    "<EMAIL>": "",
    "<PASSWORD>": "",
    "<my_tfa_token>": "",
    "<my_mfa_secret>": "",
    ...overrides,
  };
}

function substituteCs(code: string, map: Record<string, string>): { code: string; substitutions: Record<string, string> } {
  let out = code;
  const substitutions: Record<string, string> = {};
  for (const [placeholder, real] of Object.entries(map)) {
    if (!real) continue;
    const escaped = placeholder.replace(/[<>]/g, (c) => `\\${c}`);
    const re = new RegExp(`(['"])${escaped}\\1(?!\\s*:)`, "g");
    if (re.test(out)) {
      out = out.replace(re, `$1${real}$1`);
      substitutions[placeholder] = real;
    }
  }
  return { code: out, substitutions };
}

/** `name = value` used as a positional-argument-list entry (Python-style keyword arg syntax leaking into C#), e.g. `client.Login(credentials, token = tfa_token)` - confirmed genuine doc bug, not fixed, just needs the bare `tfa_token`/`mfa_secret` variables it references to exist. */
const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  tfa_token: "",
  mfa_secret: "",
};

function fixMissingSemicolons(code: string): string {
  const lines = code.split("\n");
  let parenDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const depthAtStart = parenDepth;
    for (const ch of lines[i]) {
      if (ch === "(" || ch === "{") parenDepth++;
      else if (ch === ")" || ch === "}") parenDepth--;
    }
    const justClosedToZero = depthAtStart > 0 && parenDepth === 0;
    if (depthAtStart > 0 && !justClosedToZero) continue;
    if (parenDepth > 0) continue;
    let nextIdx = i + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;
    const next = lines[nextIdx]?.trim() ?? "";
    if (next.startsWith(".") || next.startsWith(")") || next.startsWith("{")) continue;
    // A standalone closing `}` that just brought us back to depth 0 closes
    // an object/collection-initializer *expression* here (this snippet
    // body never contains its own control-flow blocks like `if`/`try` -
    // those are only added later, when wrapping in the outer try/catch) -
    // so it needs the statement-terminating `;` that C# object initializers
    // require, which the doc's own rendering omits just like it omits
    // semicolons everywhere else.
    if (justClosedToZero && trimmed === "}") {
      if (!next.startsWith(";")) lines[i] = `${lines[i]};`;
      continue;
    }
    if (!trimmed || /[;{}]$/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("using ")) continue;
    if (!/[)\w"]$/.test(trimmed)) continue;
    lines[i] = `${lines[i]};`;
  }
  return lines.join("\n");
}

function lastTopLevelAssignment(code: string): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let last: string | undefined;
  const re = /(\w+)\s*=(?!=)/g;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && /\w/.test(ch) && (i === 0 || !/\w/.test(code[i - 1]))) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i) last = m[1];
    }
  }
  return last;
}

function injectBareIdentifiers(code: string): string {
  const lines: string[] = [];
  for (const name of Object.keys(BARE_IDENTIFIER_VALUES)) {
    if (new RegExp(`\\bstring\\s+${name}\\b`).test(code)) continue;
    if (!new RegExp(`\\b${name}\\b`).test(code)) continue;
    lines.push(`string ${name} = "";`);
  }
  return lines.length ? `${lines.join("\n")}\n${code}` : code;
}

function buildHarness(body: string): string {
  const withoutUsings = body
    .split("\n")
    .filter((l) => !/^\s*using\s/.test(l))
    .join("\n");
  const semicolonFixed = fixMissingSemicolons(withoutUsings);
  const bareFixed = injectBareIdentifiers(semicolonFixed);
  const lastVar = lastTopLevelAssignment(bareFixed);

  return `using Contentstack.Management.Core;
using Contentstack.Management.Core.Models;
using System;
using System.Net;
using System.Collections.Generic;
using System.Threading.Tasks;

try
{
${bareFixed
  .split("\n")
  .map((l) => (l.trim() ? `    ${l}` : ""))
  .join("\n")}
${lastVar ? `    Console.WriteLine(${JSON.stringify(RESULT_MARKER)} + (${lastVar} == null ? "null" : ${lastVar}.ToString()));` : ""}
}
catch (Exception e)
{
    Console.WriteLine(${JSON.stringify(ERROR_MARKER)} + e.Message);
    System.Environment.Exit(1);
}
`;
}

export async function runManagementDotnetSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  overridePlaceholders: Record<string, string> = {}
): Promise<RunResult> {
  const { code: substituted, substitutions } = substituteCs(rawCode, managementDotnetPlaceholderMap(overridePlaceholders));
  const harness = buildHarness(substituted);
  writeFileSync(`${DOTNET_MGMT_PROJECT_DIR}/Program.cs`, harness);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(`${runDir}/mgmt-dotnet-snippet-${methodId}.cs`, harness);

  try {
    const { stdout } = await execFileAsync("dotnet", ["run", "--project", DOTNET_MGMT_PROJECT_DIR, "--no-restore"], {
      timeout: 30_000,
      env: dotnetEnv(),
      cwd: process.cwd(),
    });
    const resultLine = stdout.split("\n").find((l) => l.includes(RESULT_MARKER));
    return {
      methodId,
      navSection,
      method,
      outcome: "pass",
      resolvedValue: resultLine ? resultLine.slice(resultLine.indexOf(RESULT_MARKER) + RESULT_MARKER.length) : undefined,
      substitutions,
    };
  } catch (e: any) {
    const stdout: string = e.stdout ?? "";
    const stderr: string = e.stderr ?? "";
    const errorLine = stdout.split("\n").find((l: string) => l.includes(ERROR_MARKER));
    const message = errorLine
      ? errorLine.slice(errorLine.indexOf(ERROR_MARKER) + ERROR_MARKER.length)
      : stdout || stderr || e.message || String(e);
    return { methodId, navSection, method, outcome: "fail", error: message, substitutions };
  }
}

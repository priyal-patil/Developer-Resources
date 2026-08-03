/**
 * Harness for the .NET Delivery SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/dot-net/reference).
 *
 * Each snippet is written as the single Program.cs of a shared console
 * project (see dotnetHarness.ts) using C# top-level statements (no
 * explicit Main needed, `await` works directly), compiled+run with
 * `dotnet run`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { DOTNET_PROJECT_DIR, dotnetEnv } from "../setup/dotnetHarness.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

function dotnetPlaceholderMap(): Record<string, string> {
  return {
    api_key: process.env.STACK_API_KEY ?? "",
    delivery_token: process.env.DELIVERY_TOKEN ?? "",
    environment: process.env.ENVIRONMENT ?? "production",
    "<API_KEY>": process.env.STACK_API_KEY ?? "",
    "<DELIVERY_TOKEN>": process.env.DELIVERY_TOKEN ?? "",
    "<ENVIRONMENT>": process.env.ENVIRONMENT ?? "production",
    content_type_uid: "blog_post",
    content_Type_uid: "blog_post",
    entry_uid: process.env.SEED_ENTRY_UID ?? "",
    asset_uid: process.env.SEED_ASSET_UID ?? "",
    global_field_uid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
    sync_token: "",
    pagination_token: "",
  };
}

/** Strips literal `<span>...</span>` tags that leak into the scraped code - confirmed doc/scraper rendering corruption (e.g. `content_type_uid<span>_from_url_query</span>`), not real C#. */
function stripLeakedHtml(code: string): string {
  return code.replace(/<\/?span>/g, "");
}

/** Replace quoted placeholder literals, skipping a match immediately followed by `:` (a dict/object-initializer key position). */
function substituteCs(code: string, map: Record<string, string>): { code: string; substitutions: Record<string, string> } {
  let out = stripLeakedHtml(code);
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

/** Appends a trailing `;` to lines that look like a complete statement (end in `)` or a string/identifier) but are missing it - the same doc-rendering corruption class confirmed on the Java doc, found here too (e.g. `stack.RemoveHeader("custom_header_key")` with no `;`). */
function fixMissingSemicolons(code: string): string {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || /[;{}]$/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("using ")) continue;
    if (!/[)\w"]$/.test(trimmed)) continue;
    let nextIdx = i + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;
    const next = lines[nextIdx]?.trim() ?? "";
    if (next.startsWith(".") || next.startsWith(")") || next.startsWith("{")) continue;
    lines[i] = `${lines[i]};`;
  }
  return lines.join("\n");
}

/**
 * `client` is referenced as if declared by an earlier example on the same
 * page (only `stack` is actually declared in a standalone run) - inject an
 * alias, same "bare reference to a previous section's variable" bug class
 * as the legacy JS harness's `stack` injection. Inserted right after the
 * snippet's own `stack` declaration line rather than prepended - C# local
 * variables can't be referenced before their declaration point even by an
 * unrelated later statement, so injecting `var client = stack;` above
 * `ContentstackClient stack = ...;` is itself a compile error.
 */
function injectClientAlias(code: string): { code: string; injected: boolean } {
  const declaresClient = /\b(?:var|ContentstackClient)\s+client\b/.test(code);
  const referencesClient = /(?<!["'.])\bclient\b(?!["'])/.test(code);
  if (declaresClient || !referencesClient) return { code, injected: false };
  const lines = code.split("\n");
  const stackDeclIndex = lines.findIndex((l) => /\bstack\s*=/.test(l));
  if (stackDeclIndex === -1) return { code: `var client = stack;\n${code}`, injected: true };
  lines.splice(stackDeclIndex + 1, 0, "var client = stack;");
  return { code: lines.join("\n"), injected: true };
}

/** Last top-level (brace-depth 0) assignment target - the identifier immediately before a bare `=` (not `==`), regardless of its declared type/generic prefix. Mirrors lastTopLevelConst() in runSnippet.ts. */
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

function buildHarness(body: string): string {
  const withoutUsings = body
    .split("\n")
    .filter((l) => !/^\s*using\s/.test(l))
    .join("\n");
  const lastVar = lastTopLevelAssignment(withoutUsings);

  return `using Contentstack.Core;
using Contentstack.Core.Models;
using Contentstack.Core.Configuration;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

try
{
${withoutUsings
  .split("\n")
  .map((l) => (l.trim() ? `    ${l}` : ""))
  .join("\n")}
${lastVar ? `    Console.WriteLine(${JSON.stringify(RESULT_MARKER)} + (${lastVar} == null ? "null" : ${lastVar}.ToString()));` : ""}
}
catch (Exception e)
{
    Console.WriteLine(${JSON.stringify(ERROR_MARKER)} + e.Message);
    Environment.Exit(1);
}
`;
}

export async function runDotnetSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string
): Promise<RunResult> {
  const { code: substituted, substitutions } = substituteCs(rawCode, dotnetPlaceholderMap());
  let code = fixMissingSemicolons(substituted);
  const { code: aliased, injected } = injectClientAlias(code);
  code = aliased;
  if (injected) substitutions["client"] = "stack (aliased - referenced without its own declaration)";

  const harness = buildHarness(code);
  writeFileSync(`${DOTNET_PROJECT_DIR}/Program.cs`, harness);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(`${runDir}/dotnet-snippet-${methodId}.cs`, harness);

  try {
    const { stdout } = await execFileAsync("dotnet", ["run", "--project", DOTNET_PROJECT_DIR, "--no-restore"], {
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
    // On a build failure, the useful `error CSxxxx: ...` detail is on
    // stdout - stderr is just the generic "The build failed." banner, so
    // stdout must be preferred over stderr here (the opposite of the other
    // language harnesses, where stderr has the real detail).
    const message = errorLine
      ? errorLine.slice(errorLine.indexOf(ERROR_MARKER) + ERROR_MARKER.length)
      : stdout || stderr || e.message || String(e);
    return {
      methodId,
      navSection,
      method,
      outcome: "fail",
      error: message,
      substitutions,
    };
  }
}

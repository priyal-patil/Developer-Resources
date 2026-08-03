/**
 * Harness for the Python Delivery SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/python/reference).
 *
 * Each snippet is wrapped in a runnable .py script and executed with the
 * venv's `python` (see pythonHarness.ts) against the real published
 * `contentstack` pip package. Per the verbatim-execution contract, the
 * snippet's own logic is never rewritten - only placeholder literals are
 * substituted and undeclared-but-referenced bare identifiers are injected,
 * exactly like the other language harnesses in this project.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { VENV_PYTHON } from "../setup/pythonHarness.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

function pythonPlaceholderMap(): Record<string, string> {
  return {
    api_key: process.env.STACK_API_KEY ?? "",
    delivery_token: process.env.DELIVERY_TOKEN ?? "",
    access_token: process.env.DELIVERY_TOKEN ?? "",
    environment: process.env.ENVIRONMENT ?? "production",
    environment_name: process.env.ENVIRONMENT ?? "production",
    content_type_uid: "blog_post",
    contenttype_uid: "blog_post",
    entry_uid: process.env.SEED_ENTRY_UID ?? "",
    asset_uid: process.env.SEED_ASSET_UID ?? "",
    global_field_uid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
    locale_code: "en-us",
    sync_token: "",
  };
}

/** Replace quoted placeholder literals ('api_key' / "api_key"), skipping a match that's actually a dict/kwarg KEY (immediately followed by `:` or `=`). */
function substitutePy(code: string, map: Record<string, string>): { code: string; substitutions: Record<string, string> } {
  let out = code;
  const substitutions: Record<string, string> = {};
  for (const [placeholder, real] of Object.entries(map)) {
    if (!real) continue;
    const re = new RegExp(`(['"])${placeholder}\\1(?!\\s*[:=])`, "g");
    if (re.test(out)) {
      out = out.replace(re, `$1${real}$1`);
      substitutions[placeholder] = real;
    }
  }
  return { code: out, substitutions };
}

/** Bare (unquoted) placeholder names referenced as Python identifiers - injected as a `name = "value"` preamble when referenced but never assigned in the snippet itself. */
const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  api_key: process.env.STACK_API_KEY ?? "",
  delivery_token: process.env.DELIVERY_TOKEN ?? "",
  access_token: process.env.DELIVERY_TOKEN ?? "",
  environment: process.env.ENVIRONMENT ?? "production",
  content_type_uid: "blog_post",
  contenttype_uid: "blog_post",
  entry_uid: process.env.SEED_ENTRY_UID ?? "",
  asset_uid: process.env.SEED_ASSET_UID ?? "",
  variants_uid1: process.env.SEED_ENTRY_UID ?? "",
  number: "1",
  version: "1",
  count: "10",
};

/** Bare `kwargs` used as a stand-in for "put your own keyword arguments here" (e.g. `stack.live_preview_query(**kwargs)`) - inject an empty dict so the call is at least runnable. */
const DICT_BARE_IDENTIFIERS = ["kwargs"];

function declaresTopLevel(code: string, name: string): boolean {
  return new RegExp(`^${name}\\s*=[^=]`, "m").test(code);
}
function references(code: string, name: string): boolean {
  return new RegExp(`(?<!["'.])\\b${name}\\b(?!["'])(?!\\s*=[^=])(?!\\s*\\()`).test(code);
}

/** Last top-level (column-0, unindented) `name = expr` assignment - mirrors lastTopLevelConst() in runSnippet.ts but for Python's significant-whitespace scoping instead of brace depth. */
function lastTopLevelAssignment(code: string): string | undefined {
  let last: string | undefined;
  const re = /^([A-Za-z_]\w*)\s*=(?!=)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) last = m[1];
  return last;
}

function buildHarness(body: string): { harness: string; injected: Record<string, string> } {
  const withoutImports = body
    .split("\n")
    .filter((l) => !/^\s*import\s+contentstack\b/.test(l))
    .join("\n");

  const injected: Record<string, string> = {};
  const injectedLines: string[] = [];
  for (const [name, value] of Object.entries(BARE_IDENTIFIER_VALUES)) {
    if (!value || declaresTopLevel(withoutImports, name) || !references(withoutImports, name)) continue;
    injectedLines.push(`${name} = ${JSON.stringify(value)}`);
    injected[name] = value;
  }
  for (const name of DICT_BARE_IDENTIFIERS) {
    if (declaresTopLevel(withoutImports, name) || !references(withoutImports, name)) continue;
    injectedLines.push(`${name} = {}`);
    injected[name] = "{}";
  }
  // QueryOperation is referenced by at least one snippet without its own
  // `from contentstack.basequery import QueryOperation` - a genuine doc bug,
  // but importing it costs nothing and gets real signal on the rest of that
  // snippet's own logic instead of a harness-level NameError masking it.
  if (references(withoutImports, "QueryOperation") && !/\bimport\s+QueryOperation\b/.test(withoutImports)) {
    injectedLines.push(`from contentstack.basequery import QueryOperation`);
    injected["QueryOperation"] = "from contentstack.basequery import QueryOperation";
  }

  const lastVar = lastTopLevelAssignment(withoutImports);

  const harness = `import contentstack
import os
import logging
logger = logging.getLogger(__name__)

${injectedLines.join("\n")}

def __run():
${withoutImports
  .split("\n")
  .map((l) => (l.trim() ? `    ${l}` : ""))
  .join("\n")}
${lastVar ? `    print(${JSON.stringify(RESULT_MARKER)} + str(${lastVar}))` : ""}

try:
    __run()
except Exception as e:
    print(${JSON.stringify(ERROR_MARKER)} + str(e))
    raise SystemExit(1)
`;
  return { harness, injected };
}

export async function runPythonSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string
): Promise<RunResult> {
  const { code: substituted, substitutions } = substitutePy(rawCode, pythonPlaceholderMap());
  const { harness, injected } = buildHarness(substituted);
  Object.assign(substitutions, injected);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/py-snippet-${methodId}.py`;
  writeFileSync(file, harness);

  try {
    const { stdout } = await execFileAsync(VENV_PYTHON, [file], { timeout: 30_000, cwd: process.cwd() });
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
      : stderr || stdout || e.message || String(e);
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

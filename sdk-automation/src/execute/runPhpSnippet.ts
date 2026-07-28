/**
 * Harness for the PHP Delivery SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/php/reference).
 *
 * Each snippet is wrapped in a runnable .php script and executed with the
 * system `php` CLI against the real published `contentstack/contentstack`
 * Composer package (installed once under phpharness/vendor).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";
const ROOT = new URL("../../", import.meta.url).pathname;
const PHP_VENDOR_AUTOLOAD = `${ROOT}phpharness/vendor/autoload.php`;

function phpPlaceholderMap(): Record<string, string> {
  return {
    api_key: process.env.STACK_API_KEY ?? "",
    delivery_token: process.env.DELIVERY_TOKEN ?? "",
    environment: process.env.ENVIRONMENT ?? "production",
    content_type_uid: "blog_post",
    content_type_uid_1: "blog_post",
    entry_uid: process.env.SEED_ENTRY_UID ?? "",
    asset_uid: process.env.SEED_ASSET_UID ?? "",
    global_field_uid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
    host: "cdn.contentstack.io",
    protocol: "https",
    port: "443",
  };
}

function substitutePhp(code: string, map: Record<string, string>): { code: string; substitutions: Record<string, string> } {
  let out = code;
  const substitutions: Record<string, string> = {};
  for (const [placeholder, real] of Object.entries(map)) {
    if (!real) continue;
    const re = new RegExp(`(['"])${placeholder}\\1`, "g");
    if (re.test(out)) {
      out = out.replace(re, `$1${real}$1`);
      substitutions[placeholder] = real;
    }
  }
  return { code: out, substitutions };
}

/** Last top-level (brace-depth 0) `$name = expr` assignment, mirroring lastTopLevelConst() in runSnippet.ts. */
function lastTopLevelAssignment(code: string): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let last: string | undefined;
  const re = /\$(\w+)\s*=(?!=|>)/g;
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
    else if (depth === 0 && ch === "$") {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i) last = m[1];
    }
  }
  return last;
}

function buildHarness(body: string): string {
  const withoutUses = body
    .split("\n")
    .filter((l) => !/^\s*use\s+Contentstack/.test(l))
    .join("\n");
  const lastVar = lastTopLevelAssignment(withoutUses);

  return `<?php
require '${PHP_VENDOR_AUTOLOAD}';
use Contentstack\\Contentstack;

try {
${withoutUses}
${lastVar ? `    echo ${JSON.stringify(RESULT_MARKER)} . (is_scalar($${lastVar}) ? $${lastVar} : json_encode($${lastVar}));` : ""}
} catch (\\Throwable $e) {
    echo ${JSON.stringify(ERROR_MARKER)} . $e->getMessage();
    exit(1);
}
`;
}

export async function runPhpSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string
): Promise<RunResult> {
  const { code: substituted, substitutions } = substitutePhp(rawCode, phpPlaceholderMap());
  const harness = buildHarness(substituted);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/php-snippet-${methodId}.php`;
  writeFileSync(file, harness);

  try {
    const { stdout } = await execFileAsync("php", [file], { timeout: 30_000, cwd: process.cwd() });
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

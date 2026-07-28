/**
 * Harness for the Dart Delivery SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/dart/reference).
 *
 * Pure-Dart package (no Flutter dependency - confirmed via pubspec.yaml
 * before assuming this needed a Flutter/mobile toolchain), so a plain
 * `dart run` against a small pub package (dartharness/) is sufficient - no
 * emulator/simulator needed, same discovery as React Native.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";
const ROOT = new URL("../../", import.meta.url).pathname;
const DART_PROJECT_DIR = `${ROOT}dartharness`;
// Prefer whatever "dart" resolves to on PATH (e.g. dart-lang/setup-dart's
// install in CI) - only fall back to this project's own local macOS
// Homebrew path when that exact path exists, so local dev keeps working.
const HOMEBREW_DART_BIN = "/opt/homebrew/opt/dart-sdk/bin/dart";
const DART_BIN = existsSync(HOMEBREW_DART_BIN) ? HOMEBREW_DART_BIN : "dart";

function dartEnv(): NodeJS.ProcessEnv {
  if (!existsSync(HOMEBREW_DART_BIN)) return { ...process.env };
  return { ...process.env, PATH: `/opt/homebrew/opt/dart-sdk/bin:${process.env.PATH}` };
}

function dartPlaceholderMap(): Record<string, string> {
  return {
    apiKey: process.env.STACK_API_KEY ?? "",
    deliveryToken: process.env.DELIVERY_TOKEN ?? "",
    environment: process.env.ENVIRONMENT ?? "production",
    contentTypeUid: "blog_post",
    contentTypeId: "blog_post",
    entryUid: process.env.SEED_ENTRY_UID ?? "",
    uid: process.env.SEED_ASSET_UID ?? "",
    globalFieldUid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
  };
}

function substituteDart(code: string, map: Record<string, string>): { code: string; substitutions: Record<string, string> } {
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

/** Strips leaked `</span>` (and stray trailing whitespace before it) - confirmed scraper/CMS rendering artifact, not real Dart, same class as the .NET doc's leaked `<span>` tags. */
function stripLeakedHtml(code: string): string {
  return code.replace(/\s*<\/span>/g, "");
}

/** Normalizes curly/smart quotes to straight quotes - confirmed doc-rendering corruption (e.g. `stack.contentType("content_type_uid")` with curly quotes), same class of bug as the Marketplace Java doc's login() example. */
function normalizeSmartQuotes(code: string): string {
  return code.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** Dart requires statement-terminating semicolons (unlike Python/Ruby) - the doc's own rendering omits them on every line, the same corruption class as the Java/.NET docs. */
function fixMissingSemicolons(code: string): string {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || /[;{}]$/.test(trimmed) || trimmed.startsWith("//")) continue;
    if (!/[)\w"]$/.test(trimmed)) continue;
    let nextIdx = i + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;
    const next = lines[nextIdx]?.trim() ?? "";
    if (next.startsWith(".") || next.startsWith(")") || next.startsWith("{")) continue;
    lines[i] = `${lines[i]};`;
  }
  return lines.join("\n");
}

/** Bare (unquoted) placeholder identifiers used as positional args, e.g. `contentstack.Stack(apiKey, deliveryToken, environment)` with no quotes at all. */
const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  apiKey: process.env.STACK_API_KEY ?? "",
  deliveryToken: process.env.DELIVERY_TOKEN ?? "",
  environment: process.env.ENVIRONMENT ?? "production",
  contentTypeUid: "blog_post",
  entryUid: process.env.SEED_ENTRY_UID ?? "",
  imageUrl: "https://images.contentstack.io/v3/assets/sdk-automation-fixture.jpg",
  fieldUid: "title",
};

function declaresTopLevel(code: string, name: string): boolean {
  return new RegExp(`\\b(?:var|final)\\s+${name}\\b`).test(code);
}
function referencesBare(code: string, name: string): boolean {
  return new RegExp(`(?<!["'.])\\b${name}\\b(?!["'])(?!\\s*\\()`).test(code);
}

/**
 * Two injection groups, in dependency order: plain values (apiKey etc.)
 * have no dependency on `stack` and must be available BEFORE any use -
 * including the snippet's own `stack = contentstack.Stack(apiKey, ...)`
 * declaration, so they're always prepended at the very top. `stack`/`entry`
 * aliases instead DEPEND ON `stack` existing, so they must be inserted
 * AFTER the snippet's own stack declaration if one exists (same ordering
 * bug class fixed for the .NET harness's `client` alias) - prepending them
 * unconditionally would reference `stack` before it's declared.
 */
function injectBareIdentifiers(code: string): { code: string; injected: Record<string, string> } {
  const injected: Record<string, string> = {};
  const valueLines: string[] = [];
  for (const [name, value] of Object.entries(BARE_IDENTIFIER_VALUES)) {
    if (!value || declaresTopLevel(code, name) || !referencesBare(code, name)) continue;
    valueLines.push(`var ${name} = ${JSON.stringify(value)};`);
    injected[name] = value;
  }

  const stackDependentLines: string[] = [];
  // `stack` (lowercase) is referenced by a couple of Query examples as if
  // declared by an earlier section - only `contentstack.Stack(...)` (capital
  // S factory call assigned to a differently-named var) exists standalone.
  if (referencesBare(code, "stack") && !declaresTopLevel(code, "stack")) {
    stackDependentLines.push(
      `var stack = contentstack.Stack(${JSON.stringify(process.env.STACK_API_KEY ?? "")}, ${JSON.stringify(process.env.DELIVERY_TOKEN ?? "")}, ${JSON.stringify(process.env.ENVIRONMENT ?? "production")});`
    );
    injected["stack"] = "contentstack.Stack(...)";
  }
  if (referencesBare(code, "entry") && !declaresTopLevel(code, "entry")) {
    stackDependentLines.push(
      `var entry = stack.contentType(${JSON.stringify("blog_post")}).entry(entryUid: ${JSON.stringify(process.env.SEED_ENTRY_UID ?? "")});`
    );
    injected["entry"] = "stack.contentType('blog_post').entry(entryUid: ...)";
  }

  let result = code;
  if (stackDependentLines.length) {
    const codeLines = result.split("\n");
    const ownStackDeclIndex = codeLines.findIndex((l) => /\b(?:var|final)\s+stack\s*=/.test(l));
    if (ownStackDeclIndex === -1) {
      result = `${stackDependentLines.join("\n")}\n${result}`;
    } else {
      codeLines.splice(ownStackDeclIndex + 1, 0, ...stackDependentLines);
      result = codeLines.join("\n");
    }
  }
  if (valueLines.length) {
    result = `${valueLines.join("\n")}\n${result}`;
  }
  return { code: result, injected };
}

/** Last top-level (brace-depth 0) `var name = expr` assignment. */
function lastTopLevelAssignment(code: string): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let last: string | undefined;
  const re = /\bvar\s+(\w+)\s*=(?!=)/g;
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
    else if (depth === 0 && ch === "v") {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i) last = m[1];
    }
  }
  return last;
}

function buildHarness(body: string): { harness: string; injected: Record<string, string> } {
  const withoutImports = normalizeSmartQuotes(
    stripLeakedHtml(
      body
        .split("\n")
        .filter((l) => !/^\s*import\s/.test(l))
        .join("\n")
    )
  );
  const semicolonFixed = fixMissingSemicolons(withoutImports);
  const { code: fixed, injected } = injectBareIdentifiers(semicolonFixed);
  const lastVar = lastTopLevelAssignment(fixed);

  const harness = `import 'package:contentstack/contentstack.dart' as contentstack;

Future<void> main() async {
  try {
${fixed
  .split("\n")
  .map((l) => (l.trim() ? `    ${l}` : ""))
  .join("\n")}
${lastVar ? `    print(${JSON.stringify(RESULT_MARKER)} + ${lastVar}.toString());` : ""}
  } catch (e) {
    print(${JSON.stringify(ERROR_MARKER)} + e.toString());
  }
}
`;
  return { harness, injected };
}

export async function runDartSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string
): Promise<RunResult> {
  const { code: substituted, substitutions } = substituteDart(rawCode, dartPlaceholderMap());
  const { harness, injected } = buildHarness(substituted);
  Object.assign(substitutions, injected);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/dart-snippet-${methodId}.dart`;
  writeFileSync(file, harness);
  writeFileSync(`${DART_PROJECT_DIR}/bin/snippet.dart`, harness);

  try {
    const { stdout } = await execFileAsync(DART_BIN, ["run", `${DART_PROJECT_DIR}/bin/snippet.dart`], {
      timeout: 30_000,
      env: dartEnv(),
      cwd: DART_PROJECT_DIR,
    });
    const resultLine = stdout.split("\n").find((l) => l.includes(RESULT_MARKER));
    const errorLine = stdout.split("\n").find((l) => l.includes(ERROR_MARKER));
    if (errorLine) {
      return {
        methodId,
        navSection,
        method,
        outcome: "fail",
        error: errorLine.slice(errorLine.indexOf(ERROR_MARKER) + ERROR_MARKER.length),
        substitutions,
      };
    }
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

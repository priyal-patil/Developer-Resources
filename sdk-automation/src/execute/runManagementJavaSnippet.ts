/**
 * Harness for the Java Management SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-management-sdk/java/reference).
 *
 * Package is `com.contentstack.cms` (Maven artifact `com.contentstack.sdk:cms`)
 * - confirmed from source, since the doc's own `import contentstack;` line
 * is a simplified placeholder, not real Java. Mirrors the proven patterns
 * from runJavaDeliverySnippet.ts/runJavaSnippet.ts (bare-identifier
 * injection, missing-semicolon repair, Error-type qualification, "keep
 * first documented variant" truncation) adapted for this doc's own
 * conventions (`//OR` / bare `or` truncation markers instead of `(or)`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { javaEnv } from "../setup/javaHarness.js";
import { readFileSync, existsSync } from "node:fs";

const execFileAsync = promisify(execFile);
const ROOT = new URL("../../", import.meta.url).pathname;
const HARNESS_DIR = `${ROOT}javaharness-management`;

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

let cachedClasspath: string | undefined;
export async function resolveManagementJavaClasspath(): Promise<string> {
  if (cachedClasspath) return cachedClasspath;
  const cpFile = `${HARNESS_DIR}/cp.txt`;
  if (!existsSync(cpFile)) {
    await execFileAsync("mvn", ["-q", "dependency:build-classpath", "-Dmdep.outputFile=cp.txt"], { cwd: HARNESS_DIR, env: javaEnv(), timeout: 120_000 });
  }
  cachedClasspath = readFileSync(cpFile, "utf8").trim();
  return cachedClasspath;
}

function managementJavaPlaceholderMap(overrides: Record<string, string>): Record<string, string> {
  return {
    AUTHTOKEN: process.env.MGMT_AUTHTOKEN ?? "",
    authtoken: process.env.MGMT_AUTHTOKEN ?? "",
    apiKey: process.env.MGMT_STACK_API_KEY ?? "",
    contentType: process.env.MGMT_CONTENT_TYPE_UID ?? "",
    ...overrides,
  };
}

function substitute(code: string, map: Record<string, string>): { code: string; substitutions: Record<string, string> } {
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

/** This doc truncates alternative one-liners with `//OR` (a comment) or a bare `or` on its own line, unlike the Marketplace Java doc's `(or)` marker - keep only the first documented variant. */
function keepFirstJavaVariant(code: string): string {
  const m = code.match(/\n\s*(?:\/\/\s*OR|or)\s*\n/i);
  return m && m.index !== undefined ? code.slice(0, m.index) : code;
}

/** Bare (unquoted) placeholder identifiers, e.g. `.setAuthToken(AUTHTOKEN)`. */
const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  AUTHTOKEN: process.env.MGMT_AUTHTOKEN ?? "",
  API_KEY: process.env.MGMT_STACK_API_KEY ?? "",
  apiKey: process.env.MGMT_STACK_API_KEY ?? "",
  body: "new org.json.JSONObject()",
  value: "value",
  key: "key",
};

/**
 * Nearly every snippet builds its own `Contentstack` instance standalone
 * (`new Contentstack.Builder().build()`) without an authtoken, since the
 * doc's own examples assume - incorrectly, when run standalone rather than
 * read top-to-bottom as continuous narrative - that a session already
 * exists from an earlier example on the page. Any call past the basic
 * `.user()`/`.stack()`/`.organisation()` accessor then fails at runtime
 * with "Please login to access X instance", not a compile error. Inject a
 * real authtoken into the Builder chain when the snippet builds one but
 * never calls `.setAuthtoken(...)` itself.
 */
function injectAuthtoken(code: string): { code: string; injected: boolean } {
  if (!/new\s+Contentstack\.Builder\s*\(\s*\)/.test(code)) return { code, injected: false };
  if (/\.setAuthtoken\s*\(/i.test(code)) return { code, injected: false };
  const authtoken = process.env.MGMT_AUTHTOKEN ?? "";
  if (!authtoken) return { code, injected: false };
  const replaced = code.replace(/new\s+Contentstack\.Builder\s*\(\s*\)/, `new Contentstack.Builder().setAuthtoken(${JSON.stringify(authtoken)})`);
  return { code: replaced, injected: replaced !== code };
}

/**
 * Many methods' return type is declared as `Response<ResponseBody>` in the
 * doc, but the real SDK methods (confirmed against source) return
 * `Call<ResponseBody>` - a `.execute()` call is required to get the actual
 * Response. Same "doc declares the wrong type" class of bug already
 * confirmed on the Marketplace Java doc. Narrowly rewrite only
 * `Response<...>`/`Call<...>` declarations to `var` (not a blanket rewrite
 * of every declaration - that would also mangle array-initializer
 * shorthand like `String[] x = {...}`, which needs its explicit type).
 */
function rewriteResponseDeclarationsToVar(code: string): string {
  return code.replace(/\b(?:final\s+)?(?:Response|Call)<[^>]*>\s+(\w+)\s*=(?!=)/g, "var $1 =");
}

function declares(code: string, name: string): boolean {
  return new RegExp(`\\b(?:\\w+(?:<[^>]*>)?\\s+)?${name}\\s*=`).test(code);
}
function references(code: string, name: string): boolean {
  return new RegExp(`(?<!["'.])\\b${name}\\b(?!["'])(?!\\s*\\()`).test(code);
}

function injectBareIdentifiers(code: string): { code: string; injected: Record<string, string> } {
  const injected: Record<string, string> = {};
  const lines: string[] = [];
  for (const [name, value] of Object.entries(BARE_IDENTIFIER_VALUES)) {
    if (!value || declares(code, name) || !references(code, name)) continue;
    const decl = name === "body" ? `Object ${name} = ${value};` : `String ${name} = ${JSON.stringify(value)};`;
    lines.push(decl);
    injected[name] = value;
  }
  return { code: lines.length ? `${lines.join("\n")}\n${code}` : code, injected };
}

function fixMissingSemicolons(code: string): string {
  const lines = code.split("\n");
  let parenDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const depthAtStart = parenDepth;
    for (const ch of lines[i]) {
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
    }
    if (depthAtStart > 0 || parenDepth > 0) continue;
    if (!trimmed || /[;{}]$/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("import ")) continue;
    if (trimmed === ".") continue;
    if (!/[)\w"]$/.test(trimmed)) continue;
    let nextIdx = i + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;
    const next = lines[nextIdx]?.trim() ?? "";
    if (next.startsWith(".") || next.startsWith(")") || next.startsWith("{")) continue;
    lines[i] = `${lines[i]};`;
  }
  return lines.join("\n");
}

function qualifyErrorType(code: string): string {
  return code.replace(/\bError(\s+\w+\s*[,)])/g, "com.contentstack.cms.core.CMASException$1");
}

function lastTopLevelVar(code: string): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let last: string | undefined;
  const re = /\b(?:final\s+)?[\w<>\[\], ]+\s+(\w+)\s*=(?!=)/g;
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
    if (ch === "{" || ch === "(") depth++;
    else if (ch === "}" || ch === ")") depth--;
    else if (depth === 0 && /[;\n]/.test(code[i - 1] ?? "\n")) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i) last = m[1];
    }
  }
  return last;
}

let nextFileId = 0;

function buildHarness(className: string, body: string): string {
  const withoutImports = body
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l))
    .join("\n");
  const truncated = keepFirstJavaVariant(withoutImports);
  const semicolonFixed = fixMissingSemicolons(truncated);
  const errorQualified = qualifyErrorType(semicolonFixed);
  const varRewritten = rewriteResponseDeclarationsToVar(errorQualified);
  const { code: authInjected } = injectAuthtoken(varRewritten);
  const { code } = injectBareIdentifiers(authInjected);
  const lastVar = lastTopLevelVar(code);

  // The SDK's real classes live in subpackages (organization, stack, user,
  // core, models), not the top-level com.contentstack.cms package itself -
  // confirmed via the actually-published cms-1.6.1.jar's own package
  // listing (NOT the cloned repo's HEAD source, which is a much newer,
  // unpublished 1.12.2 with an extra "oauth" subpackage that doesn't exist
  // in the real installed artifact and broke compilation when imported).
  return `import com.contentstack.cms.*;
import com.contentstack.cms.organization.*;
import com.contentstack.cms.stack.*;
import com.contentstack.cms.user.*;
import com.contentstack.cms.core.*;
import com.contentstack.cms.models.*;
import org.json.JSONObject;
import retrofit2.Call;
import retrofit2.Response;
import okhttp3.ResponseBody;

public class ${className} {
  public static void main(String[] args) throws Exception {
    try {
${code
  .split("\n")
  .map((l) => (l.trim() ? `      ${l}` : ""))
  .join("\n")}
${lastVar ? `      Object __v = ${lastVar};\n      System.out.println(${JSON.stringify(RESULT_MARKER)} + (__v == null ? "null" : __v.toString()));` : ""}
    } catch (Exception e) {
      System.out.println(${JSON.stringify(ERROR_MARKER)} + (e.getMessage() != null ? e.getMessage() : e.toString()));
      System.exit(1);
    }
  }
}
`;
}

export async function runManagementJavaSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  overridePlaceholders: Record<string, string> = {}
): Promise<RunResult> {
  const { code: substituted, substitutions } = substitute(rawCode, managementJavaPlaceholderMap(overridePlaceholders));
  const className = `MgmtJavaSnippet${methodId}_${nextFileId++}`;
  const harness = buildHarness(className, substituted);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/${className}.java`;
  writeFileSync(file, harness);

  const classpath = await resolveManagementJavaClasspath();
  const env = javaEnv();

  try {
    await execFileAsync("javac", ["-cp", classpath, "-d", runDir, file], { env, timeout: 60_000 });
    const { stdout } = await execFileAsync("java", ["-cp", `${classpath}:${runDir}`, className], { env, timeout: 30_000, cwd: process.cwd() });
    const errorLine = stdout.split("\n").find((l) => l.includes(ERROR_MARKER));
    if (errorLine) {
      return { methodId, navSection, method, outcome: "fail", error: errorLine.slice(errorLine.indexOf(ERROR_MARKER) + ERROR_MARKER.length), substitutions };
    }
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
    const message = stderr || stdout || e.message || String(e);
    return { methodId, navSection, method, outcome: "fail", error: message, substitutions };
  }
}

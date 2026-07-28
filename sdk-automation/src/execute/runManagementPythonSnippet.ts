/**
 * Harness for the Python Management SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-management-sdk/python/reference).
 *
 * Mirrors runManagementSnippet.ts's (JS) placeholder conventions
 * (`authtoken`, `api_key`, per-section `uid`) translated to Python syntax,
 * and reuses the Delivery Python harness's venv/subprocess execution
 * pattern (src/setup/pythonHarness.ts) - the two SDKs share a venv but are
 * separate pip packages (`contentstack` vs `contentstack_management`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { VENV_PYTHON } from "../setup/pythonHarness.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

export function managementPythonPlaceholderMap(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_token: process.env.MGMT_AUTHTOKEN ?? "",
    the_authtoken: process.env.MGMT_AUTHTOKEN ?? "",
    your_authtoken: process.env.MGMT_AUTHTOKEN ?? "",
    api_key: process.env.MGMT_STACK_API_KEY ?? "",
    content_type_uid: process.env.MGMT_CONTENT_TYPE_UID ?? "",
    ...overrides,
  };
}

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

/** Bare (unquoted) identifiers, e.g. `client.stack(api_key).assets()` with no quotes at all. */
function bareIdentifierValues(overrides: Record<string, string>): Record<string, string> {
  return {
    api_key: process.env.MGMT_STACK_API_KEY ?? "",
    authtoken: process.env.MGMT_AUTHTOKEN ?? "",
    content_type_uid: process.env.MGMT_CONTENT_TYPE_UID ?? "",
    ...overrides,
  };
}

function declaresTopLevel(code: string, name: string): boolean {
  return new RegExp(`^${name}\\s*=[^=]`, "m").test(code);
}
function references(code: string, name: string): boolean {
  return new RegExp(`(?<!["'.])\\b${name}\\b(?!["'])(?!\\s*=[^=])(?!\\s*\\()`).test(code);
}

function injectBareIdentifiers(code: string, overrides: Record<string, string>): { code: string; injected: Record<string, string> } {
  const injected: Record<string, string> = {};
  const lines: string[] = [];
  for (const [name, value] of Object.entries(bareIdentifierValues(overrides))) {
    if (!value || declaresTopLevel(code, name) || !references(code, name)) continue;
    lines.push(`${name} = ${JSON.stringify(value)}`);
    injected[name] = value;
  }
  return { code: lines.length ? `${lines.join("\n")}\n${code}` : code, injected };
}

function lastTopLevelAssignment(code: string): string | undefined {
  let last: string | undefined;
  const re = /^([A-Za-z_]\w*)\s*=(?!=)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) last = m[1];
  return last;
}

/**
 * Confirmed against the doc's own .md export (not a scraper artifact): many
 * request-body literals render JSON/JS booleans/null (`true`/`false`/`null`)
 * as if they were valid Python, e.g. `"force": true`. Real Python needs
 * `True`/`False`/`None`. This is a genuine, systemic doc bug, but fixed at
 * the harness level anyway (same "route around a confirmed doc-wide
 * blocker to get signal on everything else" precedent as the Java
 * Marketplace doc's `var` rewrite) since leaving it broken would mask
 * every other potential issue in the same method.
 */
function fixPythonLiterals(code: string): string {
  return code
    .replace(/(?<!["'\w])true(?!["'\w])/g, "True")
    .replace(/(?<!["'\w])false(?!["'\w])/g, "False")
    .replace(/(?<!["'\w])null(?!["'\w])/g, "None");
}

/**
 * The entire Webhooks section shares one broken client-init boilerplate:
 * `client = contentstack_management.Client(host='host_name')` (a literal,
 * non-existent hostname) followed by `client.login(email="email_id",
 * password="password")` (fake credentials) - confirmed via the live doc's
 * own rendering, blocking every single method in the section with a real
 * DNS/connection error regardless of what the method itself does. Fixed at
 * the harness level (same "route around a confirmed doc-wide blocker to
 * get signal on everything else" precedent used throughout this project)
 * by replacing it with a real authenticated client and dropping the fake
 * login call.
 */
function fixBrokenWebhookClientInit(code: string): string {
  if (!/Client\s*\(\s*host\s*=/.test(code)) return code;
  return code
    .replace(/client\s*=\s*contentstack_management\.Client\s*\(\s*host\s*=\s*['"][^'"]*['"]\s*\)/, `client = contentstack_management.Client(authtoken=${JSON.stringify(process.env.MGMT_AUTHTOKEN ?? "")})`)
    .replace(/^\s*client\.login\([^)]*\)\s*$/m, "");
}

function buildHarness(body: string, overrides: Record<string, string>): { harness: string; injected: Record<string, string> } {
  const withoutImports = fixBrokenWebhookClientInit(
    fixPythonLiterals(
      body
        .split("\n")
        .filter((l) => !/^\s*import\s+contentstack_management\b/.test(l))
        .join("\n")
    )
  );

  const needsClientInit = !/contentstack_management\.Client\s*\(/.test(withoutImports) && !declaresTopLevel(withoutImports, "client");
  const preamble = needsClientInit ? [`client = contentstack_management.Client(authtoken=${JSON.stringify(process.env.MGMT_AUTHTOKEN ?? "")})`] : [];

  const { code: injected, injected: injectedMap } = injectBareIdentifiers(withoutImports, overrides);
  const code = preamble.length ? `${preamble.join("\n")}\n${injected}` : injected;
  const lastVar = lastTopLevelAssignment(code);

  const harness = `import contentstack_management
import os

def __run():
${code
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
  return { harness, injected: injectedMap };
}

export async function runManagementPythonSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  overridePlaceholders: Record<string, string> = {}
): Promise<RunResult> {
  const { code: substituted, substitutions } = substitutePy(rawCode, managementPythonPlaceholderMap(overridePlaceholders));
  const { harness, injected } = buildHarness(substituted, overridePlaceholders);
  Object.assign(substitutions, injected);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/mgmt-py-snippet-${methodId}.py`;
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

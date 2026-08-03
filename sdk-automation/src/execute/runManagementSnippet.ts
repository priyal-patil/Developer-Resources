/**
 * Management-SDK counterpart to runSnippet.ts - kept as a separate module
 * rather than branching deeply inside the Delivery-SDK harness, since the
 * two SDKs have different init conventions (`contentstack.client({
 * authtoken })` + `.stack({ api_key })`, vs Delivery's single
 * `contentstack.stack({ apiKey, deliveryToken, environment })`) and
 * different risk profile (Management snippets create/update/DELETE real
 * resources; Delivery snippets are read-only). Keeping them separate means
 * changes here can't accidentally destabilize the working Delivery
 * pipeline.
 *
 * `overridePlaceholders` lets a caller (index.ts's create-then-delete
 * handling for ContentType/Entry/Asset) inject a fresh, disposable
 * resource's real UID for just one snippet, without polluting the global
 * placeholder map - `uid` in particular means a different resource type in
 * nearly every section (branch uid, webhook uid, role uid, ...), so it's
 * only ever substituted when explicitly supplied per-call, never globally.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { substitute, keepFirstVariant } from "./runSnippet.js";

const execFileAsync = promisify(execFile);
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

export function managementPlaceholderMap(): Record<string, string> {
  return {
    api_key: process.env.MGMT_STACK_API_KEY ?? "",
    AUTHTOKEN: process.env.MGMT_AUTHTOKEN ?? "",
    content_type_uid: process.env.MGMT_CONTENT_TYPE_UID ?? "",
  };
}

const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  authtoken: process.env.MGMT_AUTHTOKEN ?? "",
};

function buildManagementHarness(body: string): { harness: string; injected: Record<string, string> } {
  const withoutImports = body
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l))
    .filter((l) => !/^\s*Example\s*\d*\s*:\s*$/.test(l))
    .join("\n")
    .replace(/^\s*Example\s*\d*\s*:\s*/, "");

  const declares = (name: string) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(withoutImports);
  const references = (name: string) => new RegExp(`\\b${name}\\b`).test(withoutImports);

  const injected: Record<string, string> = {};
  const injectedLines: string[] = [];
  for (const [name, value] of Object.entries(BARE_IDENTIFIER_VALUES)) {
    if (!value || declares(name) || !references(name)) continue;
    injectedLines.push(`const ${name} = ${JSON.stringify(value)};`);
    injected[name] = value;
  }

  const needsClientInit = !/contentstack\.client\s*\(/i.test(body) && !declares("client");
  if (needsClientInit) {
    injectedLines.push(`const client = contentstack.client({ authtoken: process.env.MGMT_AUTHTOKEN });`);
  }

  // The doc's own snippets use `import * as contentstack from
  // '@contentstack/management'`, but the package is CJS-based without a
  // proper ESM named-exports shim - confirmed by running that EXACT import
  // line in plain Node.js ESM: `contentstack.client` is undefined because
  // Node wraps the whole CJS module.exports under `contentstack.default`
  // instead of spreading it onto the namespace. `import contentstack from
  // ...` (default import) works correctly. This is a real doc bug (the doc
  // targets Node.js specifically) - see the doc-bugs report - but the
  // harness needs the working form to test anything else in the doc.
  //
  // Unlike the Delivery SDK doc (async/await throughout), almost every
  // Management SDK example uses `.then((x) => console.log(x))` with no
  // `await` and no `.catch()`. If that promise rejects, it's an
  // UNHANDLED REJECTION - Node crashes with a raw, unhelpful stack trace
  // instead of a clean error message, and it happens completely outside
  // __run()'s own try/catch since the chain is never awaited or returned.
  // A process-level handler converts that into the same clean
  // ERROR_MARKER path as a synchronous throw - this doesn't touch the
  // doc's own logic, it just makes the harness observe failures the doc's
  // own code pattern would otherwise hide behind a Node crash dump.
  // Also: since nothing awaits the `.then()` chain, there's no reliable
  // "last const" to log - resolvedOutput instead captures whatever the
  // snippet's own `.then(x => console.log(x))` printed to stdout.
  const harness = `import contentstack from '@contentstack/management';
import 'dotenv/config';

process.on('unhandledRejection', (e) => {
  console.error(${JSON.stringify(ERROR_MARKER)} + (e && e.message ? e.message : String(e)));
  process.exitCode = 1;
});

${injectedLines.join("\n")}

async function __run() {
${withoutImports}
}

__run().catch((e) => {
  console.error(${JSON.stringify(ERROR_MARKER)} + (e && e.message ? e.message : String(e)));
  process.exitCode = 1;
});
`;
  return { harness, injected };
}

export async function runManagementSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  overridePlaceholders: Record<string, string> = {}
): Promise<RunResult> {
  const map = { ...managementPlaceholderMap(), ...overridePlaceholders };
  const { code: substituted, substitutions } = substitute(rawCode, map);
  const code = keepFirstVariant(substituted);
  if (code.length !== substituted.length) substitutions["(truncated)"] = "kept first documented variant only - duplicate const declaration detected";
  const { harness, injected } = buildManagementHarness(code);
  Object.assign(substitutions, injected);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/snippet-${methodId}.ts`;
  writeFileSync(file, harness);

  try {
    const { stdout } = await execFileAsync("npx", ["tsx", file], { timeout: 30_000, cwd: process.cwd() });
    // No RESULT_MARKER convention here (see buildManagementHarness) - the
    // doc's own `.then(x => console.log(x))` pattern already prints
    // whatever the snippet resolved to, so that IS the evidence.
    return {
      methodId,
      navSection,
      method,
      outcome: "pass",
      resolvedOutput: stdout.trim() ? stdout.trim().slice(0, 2000) : undefined,
      substitutions,
    };
  } catch (e: any) {
    const stderr = (e.stderr ?? "").toString();
    const errLine = stderr.split("\n").find((l: string) => l.includes(ERROR_MARKER));
    return {
      methodId,
      navSection,
      method,
      outcome: "fail",
      error: (errLine ? errLine.split(ERROR_MARKER)[1] : stderr || e.message)?.slice(0, 1000),
      substitutions,
    };
  }
}

/**
 * Marketplace-SDK counterpart to runSnippet.ts/runManagementSnippet.ts -
 * kept separate for the same reason those two are separate from each other:
 * a distinct init convention and risk profile. The Marketplace SDK shares
 * Management's `contentstack.client({ authtoken })` init call, but scopes
 * via `.marketplace(organization_uid)` (org-level) rather than
 * `.stack({ api_key })` (stack-level), and its own package has the exact
 * same CJS/ESM default-vs-namespace-import bug already confirmed for
 * `@contentstack/management` (verified separately - see the doc-bugs
 * report) - so the same default-import fix and unhandledRejection handling
 * apply here.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { substitute, keepFirstVariant } from "./runSnippet.js";

const execFileAsync = promisify(execFile);
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

export function marketplacePlaceholderMap(): Record<string, string> {
  return {
    organization_uid: process.env.MKT_ORG_UID ?? "",
    TOKEN: process.env.MKT_AUTHTOKEN ?? "",
    manifest_uid: process.env.MKT_APP_UID ?? "",
    app_uid: process.env.MKT_APP_UID ?? "",
    installation_uid: process.env.MKT_INSTALLATION_UID ?? "",
    STACK_API_KEY: process.env.MKT_STACK_API_KEY ?? "",
  };
}

const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  authtoken: process.env.MKT_AUTHTOKEN ?? "",
};

function buildMarketplaceHarness(body: string): { harness: string; injected: Record<string, string> } {
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
    injectedLines.push(`const client = contentstack.client({ authtoken: process.env.MKT_AUTHTOKEN });`);
  }

  // Same confirmed bug as the Management SDK doc: `import * as contentstack
  // from '@contentstack/marketplace-sdk'` resolves `contentstack.client` to
  // undefined in plain Node.js ESM (CJS package, no ESM named-export shim) -
  // `import contentstack from '@contentstack/marketplace-sdk'` (default
  // import) is the working form. A handful of the doc's own examples (and
  // the SDK's own source JSDoc, e.g. lib/marketplace/app/index.js) go a step
  // further and import from '@contentstack/marketplace' (missing "-sdk"),
  // which doesn't resolve to any installed package at all - both are
  // real, confirmed doc bugs, not harness quirks.
  const harness = `import contentstack from '@contentstack/marketplace-sdk';
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

export async function runMarketplaceSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  overridePlaceholders: Record<string, string> = {}
): Promise<RunResult> {
  const map = { ...marketplacePlaceholderMap(), ...overridePlaceholders };
  const { code: substituted, substitutions } = substitute(rawCode, map);
  const code = keepFirstVariant(substituted);
  if (code.length !== substituted.length) substitutions["(truncated)"] = "kept first documented variant only - duplicate const declaration detected";
  const { harness, injected } = buildMarketplaceHarness(code);
  Object.assign(substitutions, injected);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/snippet-${methodId}.ts`;
  writeFileSync(file, harness);

  try {
    const { stdout } = await execFileAsync("npx", ["tsx", file], { timeout: 30_000, cwd: process.cwd() });
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

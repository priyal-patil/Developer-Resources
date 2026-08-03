/**
 * Harness for the JavaScript-browser Delivery SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/javascript-browser/reference).
 *
 * This doc documents a genuinely different SDK from the TypeScript Delivery
 * SDK doc - the legacy `contentstack` npm package (repo
 * `contentstack/contentstack-javascript`, default export bound to the name
 * `Contentstack`, capitalized `Stack`/`ContentType`/`Entry`/`Assets`/`Query`
 * factory methods, snake_case config keys) rather than `@contentstack/delivery-sdk`
 * (lowercase `contentstack.stack(...)`, camelCase everything). Reuses
 * substitute()/keepFirstVariant()/lastTopLevelConst() from runSnippet.ts -
 * only the harness wrapper and placeholder/bare-identifier maps differ.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { substitute, keepFirstVariant, lastTopLevelConst } from "./runSnippet.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

function legacyPlaceholderMap(): Record<string, string> {
  return {
    api_key: process.env.STACK_API_KEY ?? "",
    apiKey: process.env.STACK_API_KEY ?? "",
    your_api_key: process.env.STACK_API_KEY ?? "",
    delivery_token: process.env.DELIVERY_TOKEN ?? "",
    deliveryToken: process.env.DELIVERY_TOKEN ?? "",
    your_delivery_token: process.env.DELIVERY_TOKEN ?? "",
    environment: process.env.ENVIRONMENT ?? "production",
    your_environment: process.env.ENVIRONMENT ?? "production",
    content_type_uid: "blog_post",
    ct_uid: "blog_post",
    contentType_uid: "blog_post",
    entry_uid: process.env.SEED_ENTRY_UID ?? "",
    asset_uid: process.env.SEED_ASSET_UID ?? "",
    global_field_uid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
    language_code: "en-us",
  };
}

/** Shorthand-property object literals (`{ api_key, delivery_token, environment }`) reference these as bare identifiers instead of quoted literals. */
const LEGACY_BARE_IDENTIFIER_VALUES: Record<string, string> = {
  api_key: process.env.STACK_API_KEY ?? "",
  delivery_token: process.env.DELIVERY_TOKEN ?? "",
  environment: process.env.ENVIRONMENT ?? "production",
  imageURL: "https://images.contentstack.io/v3/assets/sdk-automation-fixture.jpg",
};

function buildHarness(body: string, importSpecifier: string): { harness: string; injected: Record<string, string> } {
  const withoutImports = body
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l))
    .join("\n");

  const declares = (name: string) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(withoutImports);
  const references = (name: string) => new RegExp(`(?<!["'.])\\b${name}\\b(?!["'])(?!\\s*\\()`).test(withoutImports);

  const injected: Record<string, string> = {};
  const injectedLines: string[] = [];

  for (const [name, value] of Object.entries(LEGACY_BARE_IDENTIFIER_VALUES)) {
    if (!value || declares(name) || !references(name)) continue;
    injectedLines.push(`const ${name} = ${JSON.stringify(value)};`);
    injected[name] = value;
  }

  // The Taxonomy section's examples reference a bare lowercase `stack`
  // left over from an earlier section's own (differently-cased) example -
  // never true when a method runs standalone. Inject the real, correctly
  // capitalized initializer so the method still gets a real signal.
  if (references("stack") && !declares("stack")) {
    injectedLines.push(
      `const stack = Contentstack.Stack({ api_key: process.env.STACK_API_KEY, delivery_token: process.env.DELIVERY_TOKEN, environment: process.env.ENVIRONMENT });`
    );
    injected["stack"] = "Contentstack.Stack({...})";
  }

  const lastConst = lastTopLevelConst(withoutImports);

  const harness = `import Contentstack from '${importSpecifier}';
import 'dotenv/config';

${injectedLines.join("\n")}

async function __run() {
${withoutImports}
${lastConst ? `  console.log(${JSON.stringify(RESULT_MARKER)} + JSON.stringify(${lastConst}));` : ""}
}

__run().catch((e) => {
  let __msg = String(e);
  try { __msg = e && e.message ? e.message : JSON.stringify(e); } catch {}
  console.error(${JSON.stringify(ERROR_MARKER)} + __msg);
  process.exit(1);
});
`;
  return { harness, injected };
}

export async function runDeliveryLegacyJsSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  importSpecifier: string = "contentstack"
): Promise<RunResult> {
  const { code: substituted, substitutions } = substitute(rawCode, legacyPlaceholderMap());
  const code = keepFirstVariant(substituted);
  if (code.length !== substituted.length) substitutions["(truncated)"] = "kept first documented variant only - duplicate const declaration detected";
  const { harness, injected } = buildHarness(code, importSpecifier);
  Object.assign(substitutions, injected);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/legacy-snippet-${methodId}.ts`;
  writeFileSync(file, harness);

  try {
    const { stdout } = await execFileAsync("npx", ["tsx", file], { timeout: 30_000, cwd: process.cwd() });
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

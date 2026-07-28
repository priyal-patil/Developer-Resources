/**
 * Java Delivery SDK counterpart to runJavaSnippet.ts (Marketplace SDK) - a
 * separate harness since the two Java SDKs have different init conventions
 * and, more importantly, a different EXECUTION MODEL: most methods here are
 * plain synchronous getters/setters (no network call at all), but the
 * actual fetch-style methods are ASYNCHRONOUS - they take a callback object
 * (`EntryResultCallBack`, `FetchResultCallback`, ...) and return
 * immediately, invoking `onCompletion(...)` later, possibly on a
 * background thread. A bare `main()` would exit before that callback ever
 * fires.
 *
 * CONFIRMED REAL BUG (see the doc-bugs report): the SDK declares its own
 * `com.contentstack.sdk.Error` class, and the doc's own
 * `import com.contentstack.sdk.*;` wildcard import makes every callback
 * signature referencing the bare `Error` type ambiguous with
 * `java.lang.Error` - confirmed via direct compilation
 * ("reference to Error is ambiguous"). The harness fully-qualifies it to
 * get real execution signal on everything else, tracked as its own
 * confirmed finding (same "harness needs the working form" precedent as
 * every other doc in this project).
 *
 * The doc's own callback bodies are almost always EMPTY (`{ }` - the doc
 * shows registering the callback, not what to do with the result), so
 * there's nothing to observe without adding instrumentation. Per the
 * verbatim-execution contract this doesn't rewrite any of the doc's own
 * logic - it only fills in a body the doc itself left blank, printing
 * whatever parameters the callback actually received (works for any
 * callback type/arity without hardcoding each one). A fixed
 * `Thread.sleep()` after the snippet's own code gives any dispatched
 * callback a chance to fire before the JVM exits - simpler than a
 * CountDownLatch and accurate enough for a doc-verbatim smoke test.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { substitute, keepFirstVariant, lastTopLevelConst } from "./runSnippet.js";
import { resolveDeliveryClasspath, javaEnv } from "../setup/javaDeliveryHarness.js";

const execFileAsync = promisify(execFile);

/**
 * The doc uses at least THREE different placeholder conventions for the
 * same values, inconsistently across snippets - confirmed by grepping the
 * actual generated files: quoted camelCase (`"apiKey"`), quoted ALL_CAPS
 * (`"API_KEY"`), and bare/unquoted ALL_CAPS (`API_KEY`, no quotes at all).
 * `substitute()` only replaces quoted literals, so the ALL_CAPS variants
 * need both a placeholder-map entry (for the quoted form) AND a
 * BARE_IDENTIFIER_VALUES-style injection (for the bare form) - same
 * "inject a preamble if referenced-but-undeclared" pattern already used in
 * runSnippet.ts for this exact kind of doc inconsistency.
 */
export function javaDeliveryPlaceholderMap(): Record<string, string> {
  return {
    apiKey: process.env.STACK_API_KEY ?? "",
    stackApiKey: process.env.STACK_API_KEY ?? "",
    API_KEY: process.env.STACK_API_KEY ?? "",
    deliveryToken: process.env.DELIVERY_TOKEN ?? "",
    DELIVERY_TOKEN: process.env.DELIVERY_TOKEN ?? "",
    environmentName: process.env.ENVIRONMENT ?? "production",
    environment: process.env.ENVIRONMENT ?? "production",
    ENVIRONMENT: process.env.ENVIRONMENT ?? "production",
    // "ENVIRNOMENT" (sic) - a confirmed doc typo, not a harness typo; see
    // the doc-bugs report. Mapped here purely to get real execution signal
    // on the rest of that one snippet.
    ENVIRNOMENT: process.env.ENVIRONMENT ?? "production",
    ENV: process.env.ENVIRONMENT ?? "production",
    contentType: "blog_post",
    contentTypeUid: "blog_post",
    entryUid: process.env.SEED_ENTRY_UID ?? "",
    assetUid: process.env.SEED_ASSET_UID ?? "",
    ASSET_UID: process.env.SEED_ASSET_UID ?? "",
    globalFieldUid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
  };
}

const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  API_KEY: process.env.STACK_API_KEY ?? "",
  DELIVERY_TOKEN: process.env.DELIVERY_TOKEN ?? "",
  ENVIRONMENT: process.env.ENVIRONMENT ?? "production",
  ENVIRNOMENT: process.env.ENVIRONMENT ?? "production",
  ENV: process.env.ENVIRONMENT ?? "production",
  ASSET_UID: process.env.SEED_ASSET_UID ?? "",
  // Same bare-identifier problem, camelCase form this time - confirmed live
  // (`Contentstack.stack(apiKey, deliveryToken, environment, config)` with
  // no quotes at all, "cannot find symbol: apiKey").
  apiKey: process.env.STACK_API_KEY ?? "",
  stackApiKey: process.env.STACK_API_KEY ?? "",
  deliveryToken: process.env.DELIVERY_TOKEN ?? "",
  environment: process.env.ENVIRONMENT ?? "production",
  environmentName: process.env.ENVIRONMENT ?? "production",
  entryUid: process.env.SEED_ENTRY_UID ?? "",
  assetUid: process.env.SEED_ASSET_UID ?? "",
  globalFieldUid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
  contentType: "blog_post",
  contentTypeUid: "blog_post",
};

/** Injects `String NAME = "value";` for each bare (unquoted) identifier the snippet references but never declares - see the module doc comment. */
function injectBareIdentifiers(code: string): { code: string; injected: Record<string, string> } {
  const declares = (name: string) => new RegExp(`\\b\\w+\\s+${name}\\s*=`).test(code);
  // Excludes quoted occurrences AND `.name(` method calls (e.g.
  // `stack.contentType("blog_post")` - "contentType" here is a METHOD, not
  // a variable reference, same false-positive class as the Marketplace SDK
  // harness's `.installation()` bug found earlier this session).
  const references = (name: string) => new RegExp(`(?<!["'.])\\b${name}\\b(?!["'])(?!\\s*\\()`).test(code);
  const injected: Record<string, string> = {};
  const lines: string[] = [];
  for (const [name, value] of Object.entries(BARE_IDENTIFIER_VALUES)) {
    if (!value || declares(name) || !references(name)) continue;
    lines.push(`String ${name} = ${JSON.stringify(value)};`);
    injected[name] = value;
  }
  return { code: lines.length ? `${lines.join("\n")}\n${code}` : code, injected };
}

/** Fully-qualifies the bare `Error` type - see the module doc comment on the confirmed ambiguity bug. Only matches the TYPE position (preceded by a comma/paren, followed by a parameter name), never the lowercase `error` variable itself. */
function qualifyErrorType(code: string): string {
  return code.replace(/\bError(\s+\w+\s*[,)])/g, "com.contentstack.sdk.Error$1");
}

/**
 * CONFIRMED, WIDESPREAD DOC BUG: many one-line examples across Asset/
 * Assetlibrary/Contenttype/Entry/Query are missing their trailing semicolon
 * entirely (`Entry entry = entry.getUid()` with no `;` at all) - confirmed
 * by reading the actual generated source (this isn't a scraper artifact;
 * the live page's own rendered code literally has no semicolon on these
 * lines). A line ending in `)` with nothing else - no trailing `;`, and not
 * immediately followed by a method-chain continuation (`.` on the next
 * line) - gets one appended, to get real execution signal on everything
 * else in the doc. This is a mechanical, unambiguous fix (there's only one
 * place a semicolon could go), not a guess at the doc's intent.
 */
function fixMissingSemicolons(code: string): string {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || /[;{}]$/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("@")) continue;
    if (!/\)$/.test(trimmed)) continue;
    const next = lines[i + 1]?.trim() ?? "";
    if (next.startsWith(".")) continue; // a real multi-line chained call - leave it alone
    lines[i] = `${lines[i]};`;
  }
  return lines.join("\n");
}

/**
 * CONFIRMED DOC BUG: at least one callback signature uses a literal
 * `<ENTRY>` as its parameter TYPE (`public void onCompletion(ResponseType
 * responseType, <ENTRY> entry, Error error)`) - angle brackets aren't valid
 * Java type syntax. Normalizes any `<ALLCAPS>` used as a type (immediately
 * followed by a parameter name) to the real PascalCase class name the SDK
 * actually defines (`Entry`, `Asset`, ...), to get real execution signal on
 * the rest of that snippet.
 */
function fixAngleBracketType(code: string): string {
  return code.replace(/<([A-Z_]+)>(\s+\w+\s*[,)])/g, (_m, name: string, rest: string) => {
    const pascalCase = name.charAt(0) + name.slice(1).toLowerCase();
    return `${pascalCase}${rest}`;
  });
}

/** Fills in an empty callback body (`{ }` or whitespace-only) with a print of whatever parameters it received - see the module doc comment. Leaves non-empty bodies (the doc's own real logic) untouched. */
function instrumentEmptyCallbacks(code: string): string {
  return code.replace(/(public\s+void\s+\w+\s*\(([^)]*)\)\s*\{)(\s*)(\})/g, (_match, head, params: string, _ws, tail) => {
    const names = params
      .split(",")
      .map((p) => p.trim().split(/\s+/).pop())
      .filter(Boolean);
    if (names.length === 0) return `${head}${tail}`;
    const printArgs = names.map((n) => `"${n}=" + ${n}`).join(' + " " + ');
    return `${head}\n  System.out.println(${JSON.stringify("__CALLBACK__")} + ${printArgs});\n${tail}`;
  });
}

let cachedClasspath: string | undefined;
let nextFileId = 0;

export async function runJavaDeliverySnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  overridePlaceholders: Record<string, string> = {}
): Promise<RunResult> {
  const map = { ...javaDeliveryPlaceholderMap(), ...overridePlaceholders };
  // Strip the snippet's own `import` lines - the wrapper already supplies
  // one canonical `import com.contentstack.sdk.*;` above main(), and Java
  // doesn't allow import statements inside a method body anyway (confirmed
  // live: "illegal start of expression" when this wasn't stripped).
  const withoutImports = rawCode
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l))
    .join("\n");
  const { code: substituted, substitutions } = substitute(withoutImports, map);
  const angleFixed = fixAngleBracketType(substituted);
  const { code: withBare, injected } = injectBareIdentifiers(angleFixed);
  Object.assign(substitutions, injected);
  const semicolonFixed = fixMissingSemicolons(withBare);
  const qualified = qualifyErrorType(semicolonFixed);
  const instrumented = instrumentEmptyCallbacks(qualified);
  const code = keepFirstVariant(instrumented);
  if (code.length !== instrumented.length) substitutions["(truncated)"] = "kept first documented variant only - duplicate declaration detected";
  if (angleFixed !== substituted) substitutions["(angle-bracket type fixed)"] = "normalized a literal `<ALLCAPS>` used as a parameter type (e.g. `<ENTRY>`) to the real class name - not valid Java syntax as printed";
  if (semicolonFixed !== withBare) substitutions["(semicolon added)"] = "appended a missing trailing semicolon - the doc's own rendered example omits it entirely on this line";
  if (qualified !== semicolonFixed) substitutions["(Error qualified)"] = "fully-qualified com.contentstack.sdk.Error - the doc's bare `Error` type is ambiguous with java.lang.Error under its own wildcard import";
  if (instrumented !== qualified) substitutions["(callback instrumented)"] = "filled the doc's own empty callback body with a print of its received parameters";

  const declares = (name: string) => new RegExp(`\\b(?:Stack|final)\\s+\\w+\\s+${name}\\b|\\b${name}\\s*=`).test(code);
  const references = (name: string) => new RegExp(`(?<!\\.)\\b${name}\\b`).test(code);
  const preamble =
    references("stack") && !declares("stack")
      ? `Stack stack = Contentstack.stack(${JSON.stringify(process.env.STACK_API_KEY ?? "")}, ${JSON.stringify(process.env.DELIVERY_TOKEN ?? "")}, ${JSON.stringify(process.env.ENVIRONMENT ?? "production")});\n`
      : "";
  if (preamble) substitutions["(preamble)"] = "injected a `stack` declaration - the snippet bare-referenced it assuming an earlier example on the page already declared it";

  const lastConst = lastTopLevelConst(code);
  const printLine = lastConst ? `\nSystem.out.println(${JSON.stringify("__RESULT__")} + String.valueOf(${lastConst}));` : "";

  const className = `DeliverySnippet${methodId}_${nextFileId++}`;
  const source = `import com.contentstack.sdk.*;

public class ${className} {
    public static void main(String[] args) throws Exception {
${preamble}${code}
${printLine}
        Thread.sleep(3000);
    }
}
`;

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/${className}.java`;
  writeFileSync(file, source);

  try {
    if (!cachedClasspath) cachedClasspath = await resolveDeliveryClasspath();
    await execFileAsync("javac", ["-cp", cachedClasspath, "-d", runDir, file], { cwd: runDir, env: javaEnv(), timeout: 30_000 });
    const { stdout } = await execFileAsync("java", ["-cp", `${cachedClasspath}:${runDir}`, className], {
      cwd: runDir,
      env: javaEnv(),
      timeout: 15_000,
    });
    const lines = stdout.split("\n").filter((l) => l.includes("__RESULT__") || l.includes("__CALLBACK__"));
    return {
      methodId,
      navSection,
      method,
      outcome: "pass",
      resolvedOutput: (lines.join(" | ") || stdout.trim()).slice(0, 2000),
      substitutions,
    };
  } catch (e: any) {
    const stderr = (e.stderr ?? "").toString().trim();
    const stdout = (e.stdout ?? "").toString().trim();
    const fallback = e.killed ? "Process killed (timeout)" : `Exited with code ${e.code}, no output on stdout/stderr.`;
    return {
      methodId,
      navSection,
      method,
      outcome: "fail",
      error: (stderr || stdout || fallback || e.message).slice(0, 1200),
      substitutions,
    };
  }
}

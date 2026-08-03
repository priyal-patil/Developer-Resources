/**
 * Java counterpart to runSnippet.ts/runManagementSnippet.ts/
 * runMarketplaceSnippet.ts - for the Java Marketplace SDK doc
 * (`com.contentstack.sdk:marketplace`, Maven Central). Unlike the three
 * Node-based harnesses, this compiles and runs a real `.java` file per
 * snippet via `javac`/`java` against a classpath resolved once by
 * javaHarness.ts, since there's no interpreter - genuinely compiling and
 * executing the doc's own code, not simulating it.
 *
 * CONFIRMED, DOC-WIDE BUG (see the doc-bugs report): essentially every
 * example on this doc declares its result with the WRONG type - e.g.
 * `App app = marketplace.app().findApps();`, but `findApps()` (and every
 * other create/update/delete/find method on App/Auth/Installation/
 * AppRequest) actually returns `Call<ResponseBody>`, not `App` - confirmed
 * against the real method signatures in the cloned repo's source. As
 * written, NONE of these examples compile. This is even baked into the
 * SDK's OWN javadoc comments (the doc site auto-generates from them), not
 * just a docs-site transcription error.
 *
 * Per the verbatim-execution contract, the raw snippet is tried once
 * completely unmodified first (to honestly confirm the compile failure is
 * real, not a harness assumption) - see `runJavaSnippetRaw` below, used only
 * for the one-time confirmation in the report, not for per-method results.
 * For actual execution signal on everything else in the doc, every
 * top-level `Type varName = expr;` declaration is rewritten to
 * `var varName = expr;` (Java 10+ local-variable type inference) - this is
 * always valid regardless of the expression's real type, so it sidesteps
 * the type-mismatch bug entirely without guessing the correct generic type
 * for 30+ different methods. This is the harness analogue of the Management
 * SDK doc's default-import fix - a real bug blocks nearly everything until
 * routed around at the harness level, tracked as its own confirmed finding.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { substitute, keepFirstVariant } from "./runSnippet.js";
import { resolveClasspath, javaEnv } from "../setup/javaHarness.js";

const execFileAsync = promisify(execFile);

export function javaPlaceholderMap(): Record<string, string> {
  return {
    ORGANIZATION_UID: process.env.JAVAMKT_ORG_UID ?? "",
    // Both host strings the doc's own examples inconsistently show -
    // neither is reachable for this SDK; the real default (confirmed in
    // the cloned repo's Constants.java) is developerhub-api.contentstack.com.
    "marketplace.contentstack.io": "developerhub-api.contentstack.com",
    "api.contentstack.io": "developerhub-api.contentstack.com",
    installationId: process.env.JAVAMKT_INSTALLATION_UID ?? "",
    app_uid: process.env.JAVAMKT_APP_UID ?? "",
    authorizationUid: process.env.JAVAMKT_AUTHORIZATION_UID ?? "",
  };
}

/** Curly/smart quotes (confirmed present in the doc's own `login()` example: `.login(“emailId”, “password”)`) aren't valid Java string delimiters - a real, separate confirmed bug, but must be normalized here for the harness to compile anything beyond that one snippet. */
function normalizeSmartQuotes(code: string): string {
  return code.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/** Same brace/quote-depth-aware scan as runSnippet.ts's lastTopLevelConst, adapted for Java's `var name = ...;` declarations. */
function lastTopLevelVar(code: string): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let last: string | undefined;
  const varRe = /\bvar\s+([A-Za-z_$][\w$]*)\s*=/g;
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
      varRe.lastIndex = i;
      const m = varRe.exec(code);
      if (m && m.index === i) last = m[1];
    }
  }
  return last;
}

/** Rewrites every top-level `Type name = expr;` declaration to `var name = expr;` - see the module doc comment. Constructor calls (`new Foo(...)`) are already correctly typed but `var` is valid there too, so no need to distinguish - uniform rewrite is simplest and always safe. */
function rewriteDeclarationsToVar(code: string): string {
  return code.replace(
    /^(\s*)(?!var\b|return\b|if\b|for\b|while\b)[A-Za-z_$][\w.$]*(?:<[^;=]*>)?(?:\[\])?\s+([A-Za-z_$][\w$]*)\s*=(?!=)/gm,
    "$1var $2 ="
  );
}

/**
 * A handful of methods (e.g. `App > App`) bundle two alternative one-liners
 * in the same fenced block, glued together with doc prose in between
 * (`"...('installationId'); (or) App app = marketplace.app();"`) rather
 * than a clean second statement - the shared keepFirstVariant() (designed
 * for JS's `const`/`function` redeclaration) doesn't recognize this same
 * pattern in Java (`var` declarations, plus the bare "(or)" text isn't a
 * valid Java token at all). Strips from the first "(or)" onward, keeping
 * only the first documented variant - same "run just one alternative"
 * policy already applied to every other doc in this project.
 */
function keepFirstJavaVariant(code: string): string {
  const orIdx = code.search(/\(or\)/i);
  return orIdx === -1 ? code : code.slice(0, orIdx).trimEnd();
}

/**
 * Several snippets bare-reference `marketplace`/`auth`/`installation`/
 * `appRequest`/`ORG_UID` without declaring it, assuming an earlier example
 * on the same doc page (the Marketplace/Auth/Installation/Apprequest
 * section's own top-level example) stays in scope for every later snippet -
 * never true once each method runs standalone. Same "inject a preamble if
 * referenced but undeclared" approach as every other harness in this
 * project. Declared in dependency order - `auth`/`installation`/
 * `appRequest` are all reached via `marketplace`, so it must exist first if
 * any of them are needed.
 */
function injectMarketplacePreamble(code: string, orgUid: string, authtoken: string): string {
  const declares = (name: string) => new RegExp(`\\b(?:var|Marketplace|Auth|Installation|AppRequest)\\s+${name}\\b`).test(code);
  // Excludes `.name(` method calls (e.g. `marketplace.installation()`) -
  // a bare word-boundary match alone treats a METHOD NAME as a variable
  // reference too (confirmed live: `.installation()` falsely triggered
  // injecting `var installation = ...` even where only the `installation`
  // METHOD was being called, not a variable read).
  const references = (name: string) => new RegExp(`(?<!\\.)\\b${name}\\b`).test(code);
  const needsMarketplace = ["auth", "installation", "appRequest"].some((v) => references(v) && !declares(v));
  const lines: string[] = [];
  if (references("ORG_UID") && !declares("ORG_UID")) {
    lines.push(`String ORG_UID = ${JSON.stringify(orgUid)};`);
  }
  if ((references("marketplace") || needsMarketplace) && !declares("marketplace")) {
    lines.push(
      `var marketplace = new Marketplace.Builder(${JSON.stringify(orgUid)}).host("developerhub-api.contentstack.com").authtoken(${JSON.stringify(authtoken)}).build();`
    );
  }
  if (references("auth") && !declares("auth")) lines.push(`var auth = marketplace.authorizations();`);
  if (references("installation") && !declares("installation")) lines.push(`var installation = marketplace.installation();`);
  if (references("appRequest") && !declares("appRequest")) lines.push(`var appRequest = marketplace.request();`);
  return lines.length ? `${lines.join("\n")}\n${code}` : code;
}

/**
 * A few methods (e.g. `Installation > validateInstallationId`) document two
 * variants back-to-back with no separator at all - just the same variable
 * name declared twice with different arguments - rather than the `(or)`-
 * marked form `keepFirstJavaVariant` handles. Same brace/quote-depth-aware
 * scan as `lastTopLevelVar`, but truncating at the SECOND top-level
 * declaration of any name instead of just tracking the last one.
 */
function keepFirstVarDeclaration(code: string): string {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  const seen = new Set<string>();
  const varRe = /\bvar\s+([A-Za-z_$][\w$]*)\s*=/g;
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
      varRe.lastIndex = i;
      const m = varRe.exec(code);
      if (m && m.index === i) {
        if (seen.has(m[1])) return code.slice(0, i).trimEnd();
        seen.add(m[1]);
      }
    }
  }
  return code;
}

/** Ensures a real authtoken is present on any `new Marketplace.Builder(...)....build()` chain that doesn't already call `.authtoken(`. Most of the doc's examples show `.host(...).build()` with no auth at all, implicitly assuming it was configured elsewhere - never true when each method runs standalone. */
function injectAuthtoken(code: string, authtoken: string): string {
  if (code.includes(".authtoken(") || !code.includes("Marketplace.Builder")) return code;
  return code.replace(/\.build\(\)/, `.authtoken(${JSON.stringify(authtoken)}).build()`);
}

let cachedClasspath: string | undefined;
let nextFileId = 0;

export async function runJavaSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  overridePlaceholders: Record<string, string> = {}
): Promise<RunResult> {
  const map = { ...javaPlaceholderMap(), ...overridePlaceholders };
  const normalized = normalizeSmartQuotes(rawCode);
  const { code: substituted, substitutions } = substitute(normalized, map);
  const firstVariant = keepFirstJavaVariant(substituted);
  if (firstVariant.length !== substituted.length) substitutions["(truncated)"] = "kept first documented variant only - a second alternative was glued into the same block with doc prose ('(or) ...')";
  const withPreamble = injectMarketplacePreamble(firstVariant, process.env.JAVAMKT_ORG_UID ?? "", process.env.JAVAMKT_AUTHTOKEN ?? "");
  const withVar = rewriteDeclarationsToVar(withPreamble);
  const withAuth = injectAuthtoken(withVar, process.env.JAVAMKT_AUTHTOKEN ?? "");
  const dedupedVar = keepFirstVarDeclaration(withAuth);
  const code = keepFirstVariant(dedupedVar);
  if (withVar !== withPreamble) substitutions["(type rewrite)"] = "declared types rewritten to `var` - see runJavaSnippet.ts's doc comment on the doc-wide Call<ResponseBody>-vs-class-name mismatch";
  if (withPreamble !== firstVariant) substitutions["(preamble)"] = "injected a `marketplace`/`auth`/`installation`/`appRequest`/`ORG_UID` declaration - the snippet bare-referenced it assuming an earlier example on the page already declared it";
  if (dedupedVar !== withAuth) substitutions["(truncated 2)"] = "kept first documented variant only - a second variant redeclared the same variable name with no separator";

  const lastVar = lastTopLevelVar(code);
  // Cast to Object first - `instanceof retrofit2.Response<?>` against a
  // Marketplace/App/Auth/Installation/AppRequest-typed variable is a
  // compile error (javac can prove those unrelated concrete classes can
  // never BE a Response), confirmed live on nearly every method before this
  // fix - most snippets' last variable is one of those classes, not a Call
  // result, since `var`-typed locals still carry their real inferred type.
  const printLine = lastVar
    ? `\nObject __v = ${lastVar}; if (__v instanceof retrofit2.Response<?> __r) { System.out.println(${JSON.stringify("__RESULT__")} + __r.code() + " " + (__r.isSuccessful() ? __r.body() : __r.errorBody().string())); } else { System.out.println(${JSON.stringify("__RESULT__")} + String.valueOf(__v)); }`
    : "";

  const className = `Snippet${methodId}_${nextFileId++}`;
  const source = `import com.contentstack.sdk.marketplace.Marketplace;
import com.contentstack.sdk.marketplace.apps.App;
import com.contentstack.sdk.marketplace.auths.Auth;
import com.contentstack.sdk.marketplace.installations.Installation;
import com.contentstack.sdk.marketplace.request.AppRequest;
import com.contentstack.sdk.Region;
import retrofit2.Call;
import retrofit2.Response;
import okhttp3.ResponseBody;
import org.json.simple.JSONObject;
import java.util.HashMap;

public class ${className} {
    public static void main(String[] args) throws Exception {
${code}
${printLine}
    }
}
`;

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/${className}.java`;
  writeFileSync(file, source);

  try {
    if (!cachedClasspath) cachedClasspath = await resolveClasspath();
    await execFileAsync("javac", ["-cp", cachedClasspath, "-d", runDir, file], { cwd: runDir, env: javaEnv(), timeout: 30_000 });
    const { stdout } = await execFileAsync("java", ["-cp", `${cachedClasspath}:${runDir}`, className], {
      cwd: runDir,
      env: javaEnv(),
      timeout: 20_000,
    });
    const marker = "__RESULT__";
    const resultLine = stdout.split("\n").find((l) => l.includes(marker));
    return {
      methodId,
      navSection,
      method,
      outcome: "pass",
      resolvedOutput: (resultLine ? resultLine.split(marker)[1] : stdout.trim()).slice(0, 2000),
      substitutions,
    };
  } catch (e: any) {
    const stderr = (e.stderr ?? "").toString().trim();
    const stdout = (e.stdout ?? "").toString().trim();
    // Node's own execFile error.message repeats the full command line
    // (including the ~1500-char resolved classpath) before anything useful -
    // prefer real process output; only fall back to the bare exit-code
    // summary (still informative: signal/timeout vs a clean non-zero exit)
    // if the process genuinely produced nothing on either stream.
    const fallback = e.killed ? `Process killed (timeout after ${e.timedOut ? "20s" : "?"})` : `Exited with code ${e.code}, no output on stdout/stderr.`;
    return {
      methodId,
      navSection,
      method,
      outcome: "fail",
      error: (stderr || stdout || fallback).slice(0, 1200),
      substitutions,
    };
  }
}

/** Runs the doc's snippet COMPLETELY unmodified (only ORGANIZATION_UID/host/auth substituted at the string-literal level, no type/quote fixes) - used once to honestly confirm the type-mismatch compile failure is real, per the verbatim-execution contract, not for per-method results. */
export async function runJavaSnippetRaw(runDir: string, methodId: number, rawCode: string): Promise<{ compiled: boolean; error?: string }> {
  const map = javaPlaceholderMap();
  const { code } = substitute(rawCode, map);
  const className = `RawSnippet${methodId}`;
  const source = `import com.contentstack.sdk.marketplace.Marketplace;
import com.contentstack.sdk.marketplace.apps.App;
import com.contentstack.sdk.marketplace.auths.Auth;
import com.contentstack.sdk.marketplace.installations.Installation;
import com.contentstack.sdk.marketplace.request.AppRequest;
import com.contentstack.sdk.Region;
import retrofit2.Call;
import retrofit2.Response;
import okhttp3.ResponseBody;
import org.json.simple.JSONObject;
import java.util.HashMap;

public class ${className} {
    public static void main(String[] args) throws Exception {
${code}
    }
}
`;
  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/${className}.java`;
  writeFileSync(file, source);
  try {
    const cp = await resolveClasspath();
    await execFileAsync("javac", ["-cp", cp, "-d", runDir, file], { cwd: runDir, env: javaEnv(), timeout: 30_000 });
    return { compiled: true };
  } catch (e: any) {
    return { compiled: false, error: (e.stderr ?? e.message).toString().slice(0, 800) };
  }
}

/**
 * Harness for the Android Delivery SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/android/reference).
 *
 * Each snippet is compiled and run as a Robolectric-shadowed JUnit4 test
 * (see androidharness/pom.xml and src/setup/androidHarness.ts for why this
 * needs Robolectric rather than a plain `java` subprocess - the SDK's
 * `Contentstack.stack(Context, ...)` genuinely requires a real Android
 * `Context`, which Robolectric provides without an emulator).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";
import { substitute, keepFirstVariant } from "./runSnippet.js";
import { javaEnv, resolveAndroidClasspath } from "../setup/androidHarness.js";

const execFileAsync = promisify(execFile);
const ROOT = new URL("../../", import.meta.url).pathname;
const ANDROID_HARNESS_DIR = `${ROOT}androidharness`;

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

function androidPlaceholderMap(): Record<string, string> {
  return {
    apiKey: process.env.STACK_API_KEY ?? "",
    deliveryToken: process.env.DELIVERY_TOKEN ?? "",
    environment: process.env.ENVIRONMENT ?? "production",
    contentTypeUid: "blog_post",
    contenTypeUid: "blog_post",
    entryUid: process.env.SEED_ENTRY_UID ?? "",
    assetUid: process.env.SEED_ASSET_UID ?? "",
    globalFieldUid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
    referenceUid: process.env.SEED_ENTRY_UID ?? "",
  };
}

/** Strips leaked `<span>...</span>` tags - confirmed scraper/CMS rendering artifact, same class as the .NET/Dart docs. */
function stripLeakedHtml(code: string): string {
  return code.replace(/<\/?span>/g, "");
}

/** Under the doc's own `import com.contentstack.sdk.*;` wildcard, bare `Error` is ambiguous with `java.lang.Error` - same confirmed bug class as the Marketplace/Delivery Java docs. */
function qualifyErrorType(code: string): string {
  return code.replace(/\bError(\s+\w+\s*[,)])/g, "com.contentstack.sdk.Error$1");
}

/**
 * Java-specific "keep only the first documented variant" truncator -
 * `keepFirstVariant()` from runSnippet.ts only matches JS's `const/let/var`
 * forms, not Java's `Type name = expr;`, so a snippet that (like
 * Config > setProxy) redeclares the same variable name a second time with
 * a "real" example after an illustrative placeholder one would otherwise
 * hit "variable X is already defined".
 */
function keepFirstJavaDeclaration(code: string): string {
  const re = /(?:^|\n)\s*(?:final\s+)?[\w.<>\[\], ]+\s+(\w+)\s*=/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const name = m[1];
    if (seen.has(name)) return code.slice(0, m.index).trimEnd();
    seen.add(name);
  }
  return code;
}

/** Bare (unquoted) placeholder identifiers, plus `context`/`applicationContext` which need a real Robolectric-provided Context. */
const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  apiKey: process.env.STACK_API_KEY ?? "",
  deliveryToken: process.env.DELIVERY_TOKEN ?? "",
  environment: process.env.ENVIRONMENT ?? "production",
  contentTypeUid: "blog_post",
  entryUid: process.env.SEED_ENTRY_UID ?? "",
  assetUid: process.env.SEED_ASSET_UID ?? "",
  hostname: "cdn.contentstack.io",
  host: "cdn.contentstack.io",
  managementToken: "",
  proxyHost: "sl.theproxyvpn.io",
  proxyPort: "80",
};

function declares(code: string, name: string): boolean {
  return new RegExp(`\\b(?:\\w+\\s+)?${name}\\s*=`).test(code);
}
function references(code: string, name: string): boolean {
  return new RegExp(`(?<!["'.])\\b${name}\\b(?!["'])(?!\\s*\\()`).test(code);
}

function injectBareIdentifiers(code: string): { code: string; injected: Record<string, string> } {
  const injected: Record<string, string> = {};
  const lines: string[] = [];
  for (const name of ["context", "applicationContext"]) {
    if (declares(code, name) || !references(code, name)) continue;
    lines.push(`Context ${name} = RuntimeEnvironment.getApplication();`);
    injected[name] = "RuntimeEnvironment.getApplication()";
  }
  for (const [name, value] of Object.entries(BARE_IDENTIFIER_VALUES)) {
    if (!value || declares(code, name) || !references(code, name)) continue;
    lines.push(`String ${name} = ${JSON.stringify(value)};`);
    injected[name] = value;
  }
  return { code: lines.length ? `${lines.join("\n")}\n${code}` : code, injected };
}

/** Fills the doc's own empty callback bodies (`onCompletion(...) { }`) with a print of received parameters, mirroring the Java Delivery SDK harness. */
function instrumentEmptyCallbacks(code: string): string {
  return code.replace(/(public\s+void\s+\w+\s*\(([^)]*)\)\s*\{)(\s*)(\})/g, (_m, head, params, _ws, tail) => {
    const names = params
      .split(",")
      .map((p: string) => p.trim().split(/\s+/).pop())
      .filter(Boolean);
    if (names.length === 0) return `${head}${tail}`;
    const printArgs = names.map((n: string) => `"${n}=" + ${n}`).join(' + " " + ');
    return `${head}\n  System.out.println(${JSON.stringify("__CALLBACK__")} + ${printArgs});\n${tail}`;
  });
}

/**
 * Tracks running paren depth across lines and skips insertion while inside
 * an unclosed `(...)` - a multi-line method signature/parameter list (e.g.
 * `onCompletion(ResponseType responseType,\n\nList<Asset> assets,\n\nError\n\n error)`)
 * has lines ending in a bare identifier with no trailing punctuation that
 * look exactly like a "missing semicolon" statement, but inserting one
 * there breaks the parameter list instead of fixing anything - confirmed
 * by reading a real generated snippet where this happened.
 */
function fixMissingSemicolons(code: string): string {
  const lines = code.split("\n");
  let parenDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const depthAtLineStart = parenDepth;
    for (const ch of lines[i]) {
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
    }
    if (depthAtLineStart > 0 || parenDepth > 0) continue;
    if (!trimmed || /[;{}]$/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("@") || trimmed.startsWith("import ")) continue;
    if (!/[)\w"]$/.test(trimmed)) continue;
    let nextIdx = i + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++;
    const next = lines[nextIdx]?.trim() ?? "";
    if (next.startsWith(".") || next.startsWith(")") || next.startsWith("{")) continue;
    lines[i] = `${lines[i]};`;
  }
  return lines.join("\n");
}

/** Last top-level (brace/quote-depth-aware) `var name =` declaration, mirroring the pattern used in the other Java harnesses. */
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
  const html = stripLeakedHtml(withoutImports);
  const semicolonFixed = fixMissingSemicolons(html);
  const truncated = keepFirstJavaDeclaration(semicolonFixed);
  const errorQualified = qualifyErrorType(truncated);
  const { code: injected } = injectBareIdentifiers(errorQualified);
  const callbacksFixed = instrumentEmptyCallbacks(injected);
  const code = keepFirstVariant(callbacksFixed);
  const lastVar = lastTopLevelVar(code);

  // org.robolectric.annotation.Config is NOT imported by name - the doc's
  // own snippets do `new Config()` meaning the SDK's com.contentstack.sdk.Config,
  // but a single-type import always wins over the com.contentstack.sdk.*
  // wildcard, so importing Robolectric's Config here would silently make
  // every "new Config()" resolve to the (abstract, uninstantiable)
  // annotation type instead - confirmed via "Config is abstract; cannot be
  // instantiated" on every Config-section method. Referenced fully-qualified
  // in the class annotation instead.
  return `import com.contentstack.sdk.*;
import android.content.Context;
import java.net.Proxy;
import java.net.InetSocketAddress;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

@RunWith(RobolectricTestRunner.class)
@org.robolectric.annotation.Config(sdk = 33, manifest = org.robolectric.annotation.Config.NONE)
public class ${className} {
  @Test
  public void run() throws Exception {
${code
  .split("\n")
  .map((l) => (l.trim() ? `    ${l}` : ""))
  .join("\n")}
${lastVar ? `    Object __v = ${lastVar};\n    System.out.println(${JSON.stringify(RESULT_MARKER)} + (__v == null ? "null" : __v.toString()));` : ""}
  }
}
`;
}

export async function runAndroidSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string
): Promise<RunResult> {
  const { code: substituted, substitutions } = substitute(rawCode, androidPlaceholderMap());
  const className = `AndroidSnippet${methodId}_${nextFileId++}`;
  const harness = buildHarness(className, substituted);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/${className}.java`;
  writeFileSync(file, harness);

  const classpath = await resolveAndroidClasspath();
  const env = javaEnv();

  try {
    await execFileAsync("javac", ["-cp", classpath, "-d", runDir, file], { env, timeout: 60_000 });
    const { stdout } = await execFileAsync("java", ["-cp", `${classpath}:${runDir}`, "org.junit.runner.JUnitCore", className], {
      env,
      timeout: 60_000,
      cwd: ANDROID_HARNESS_DIR,
    });
    const errorLine = stdout.split("\n").find((l) => l.includes(ERROR_MARKER));
    if (errorLine || /FAILURES!!!/.test(stdout)) {
      return {
        methodId,
        navSection,
        method,
        outcome: "fail",
        error: errorLine ? errorLine.slice(errorLine.indexOf(ERROR_MARKER) + ERROR_MARKER.length) : stdout,
        substitutions,
      };
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

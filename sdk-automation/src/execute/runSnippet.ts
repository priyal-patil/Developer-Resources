/**
 * Wraps one documented code block in a runnable harness and executes it
 * with `tsx` in a per-run scratch file, capturing the resolved value or
 * thrown error.
 *
 * Snippets are not self-contained: most assume a `stack` variable already
 * exists (initialized by the doc's own "Stack" section) and use dummy
 * string-literal placeholders ("apiKey", "assetUid", ...) instead of real
 * values. Per the verbatim-execution contract, the snippet's own logic is
 * never rewritten - only placeholder string literals are substituted with
 * real seeded values, and every substitution is recorded on the result so
 * a report reader can see exactly what was changed to make the doc's own
 * code runnable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";

/** placeholder (as it appears quoted in doc snippets) -> real seeded value */
export function placeholderMap(): Record<string, string> {
  return {
    apiKey: process.env.STACK_API_KEY ?? "",
    deliveryToken: process.env.DELIVERY_TOKEN ?? "",
    environment: process.env.ENVIRONMENT ?? "production",
    assetUid: process.env.SEED_ASSET_UID ?? "",
    asset_uid: process.env.SEED_ASSET_UID ?? "",
    contentTypeUid: "blog_post",
    content_type_uid: "blog_post",
    contentType_uid: "blog_post", // Entry>includeMetadata uses this mixed camelCase+underscore spelling, distinct from the other two
    contenttype_uid: "blog_post",
    contentType1Uid: "blog_post",
    contentType2Uid: "blog_post",
    contentType3Uid: "blog_post",
    entryUid: process.env.SEED_ENTRY_UID ?? "",
    entry_uid: process.env.SEED_ENTRY_UID ?? "",
    global_field_uid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
  };
}

/**
 * Some sections (Entry, Query) use these same placeholder names as BARE
 * identifiers instead of quoted string literals (e.g. `.contentType(contentType_uid)`
 * rather than `.contentType("contentTypeUid")`), inconsistent with every
 * other section's convention - substitute() only touches quoted literals,
 * so these need a `const <name> = "<value>"` preamble line instead. Only
 * injected when the snippet references the identifier AND doesn't already
 * declare it itself.
 */
const BARE_IDENTIFIER_VALUES: Record<string, string> = {
  contentType_uid: "blog_post",
  contenttype_uid: "blog_post",
  contentType1Uid: "blog_post",
  contentType2Uid: "blog_post",
  contentType3Uid: "blog_post",
  entry_uid: process.env.SEED_ENTRY_UID ?? "",
  entryUid: process.env.SEED_ENTRY_UID ?? "",
  asset_uid: process.env.SEED_ASSET_UID ?? "",
  assetUid: process.env.SEED_ASSET_UID ?? "",
  // ImageTransform > overlay uses this as a bare, undeclared identifier for
  // an overlay image's relative URL - the doc expects the reader to supply
  // their own; any real asset path works for a runnability check.
  overlayImgURL: "/sdk-automation-fixture.txt",
};

/**
 * Replace quoted placeholder literals ('apiKey' / "apiKey") with real
 * values, recording each substitution actually made. The trailing
 * `(?!\s*:)` skips a match that's actually an object-literal KEY (e.g.
 * `{'environment': 'environment'}` - some docs, notably the legacy
 * `contentstack` npm package's snake_case config object, quote the key
 * name too, and it happens to equal the placeholder text). Without this,
 * substituting the environment placeholder corrupts the key itself into
 * `{'production': 'production'}` - confirmed on the JavaScript-browser
 * Delivery SDK doc.
 */
export function substitute(code: string, map: Record<string, string>): { code: string; substitutions: Record<string, string> } {
  let out = code;
  const substitutions: Record<string, string> = {};
  for (const [placeholder, real] of Object.entries(map)) {
    if (!real) continue;
    const re = new RegExp(`(['"])${placeholder}\\1(?!\\s*:)`, "g");
    if (re.test(out)) {
      out = out.replace(re, `$1${real}$1`);
      substitutions[placeholder] = real;
    }
  }
  return { code: out, substitutions };
}

/**
 * Several methods document 2+ alternative one-liners bundled into a single
 * fenced block (joined by a "// OR" comment, or in a few cases glued
 * together with no separator at all) - each redeclares the same `const`
 * name, which is a duplicate-declaration SyntaxError if run as one script.
 * Flagged separately as a lint finding (verify/lintBlocks.ts); here, keep
 * only the first variant so the method still gets a real pass/fail signal
 * instead of every such method reporting the same generic SyntaxError.
 * Same "run just one documented alternative" policy already applied at the
 * method level (index.ts only executes codeBlocks[0]).
 */
export function keepFirstVariant(code: string): string {
  // Matches both `const name =` and `[async] function name(` - some bundled
  // variants redeclare an identically-named function (e.g. two separate
  // `async function main() {...}` blocks) rather than a const, which is
  // just as much a duplicate-declaration SyntaxError at the same scope.
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=|\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const name = m[1] ?? m[2];
    if (seen.has(name)) {
      // The cut point often lands right after a glued-on "Example 2:"-style
      // label from the previous variant's trailing text (no line break
      // before the duplicate declaration) - strip that artifact too, or it
      // remains as a dangling, invalid bare statement.
      return code
        .slice(0, m.index)
        .trimEnd()
        .replace(/Example\s*\d*\s*:\s*$/, "")
        .trimEnd();
    }
    seen.add(name);
  }
  return code;
}

/**
 * Some doc examples wrap their real logic in a self-contained
 * `async function main() { const result = ...; } main();` and call it
 * immediately - a naive "find the last `const NAME =` anywhere in the
 * text" match (the old approach) grabs `result`, but it's scoped inside
 * `main()` and invisible where the harness appends its result-logging
 * line at the snippet's outer scope, throwing a harness-caused
 * "result is not defined" ReferenceError that has nothing to do with
 * whether the doc's own example is correct. Track brace depth (skipping
 * over string/template literal contents so their braces don't count) and
 * only consider `const` declarations at depth 0.
 */
export function lastTopLevelConst(code: string): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let last: string | undefined;
  const constRe = /\bconst\s+([A-Za-z_$][\w$]*)\s*=/g;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && ch === "c") {
      constRe.lastIndex = i;
      const m = constRe.exec(code);
      if (m && m.index === i) last = m[1];
    }
  }
  return last;
}

let imageTransformExportedCache: boolean | undefined;

/**
 * Whether `ImageTransform` is actually a value export of the currently
 * installed/linked `@contentstack/delivery-sdk` - checked at runtime
 * instead of hardcoded, so this harness works correctly both against the
 * published package (where it's a `.d.ts`/runtime packaging bug and this
 * is false) and against a locally patched build with the one-line
 * `src/index.ts` fix applied (where it's true). Cached for the process
 * lifetime since the installed package doesn't change mid-run.
 */
async function isImageTransformExported(): Promise<boolean> {
  if (imageTransformExportedCache !== undefined) return imageTransformExportedCache;
  try {
    const mod: any = await import("@contentstack/delivery-sdk");
    imageTransformExportedCache = typeof mod.ImageTransform === "function";
  } catch {
    imageTransformExportedCache = false;
  }
  return imageTransformExportedCache;
}

function buildHarness(body: string, imageTransformExported: boolean): { harness: string; injected: Record<string, string> } {
  // Strip the snippet's own import lines - we always supply a canonical one
  // (dedupes "import contentstack..." appearing both here and in the doc,
  // which would otherwise be a duplicate-declaration SyntaxError). Also
  // strip a leading "Example:" / "Example 1:" label line - the docs site's
  // .md export bakes that annotation into the fence itself rather than
  // keeping it outside as prose, and it isn't code in any language. Flagged
  // separately by verify/lintBlocks.ts as a doc-formatting finding rather
  // than treated as a real snippet failure.
  const withoutImports = body
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l))
    .filter((l) => !/^\s*Example\s*\d*\s*:\s*$/.test(l))
    .join("\n")
    // A few blocks glue "Example:" directly onto the start of the first
    // code line with no line break at all ("Example:const data = ...").
    // Left in place, `Example: const ...` parses as a labeled statement,
    // and JS forbids labeling a declaration - SyntaxError "Cannot use a
    // declaration in a single-statement context". The line-level filter
    // above only catches "Example:" on its own line, so this handles the
    // glued-on case too.
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

  const needsStackInit = !/contentstack\.stack\s*\(/i.test(body) && !declares("stack");
  if (needsStackInit) {
    injectedLines.push(
      `const stack = contentstack.stack({ apiKey: process.env.STACK_API_KEY, deliveryToken: process.env.DELIVERY_TOKEN, environment: process.env.ENVIRONMENT });`
    );
  }
  // Several Query/Pagination examples are documented as bare continuations
  // of a `query` variable built earlier in the same nav section rather than
  // being self-contained - inject a default so they're runnable in
  // isolation instead of failing on "query is not defined".
  if (references("query") && !declares("query")) {
    injectedLines.push(`const query = stack.contentType(${JSON.stringify("blog_post")}).entry().query();`);
    injected["query"] = "stack.contentType('blog_post').entry().query()";
  }

  const lastConst = lastTopLevelConst(withoutImports);

  // ImageTransform is only added to the import list when the currently
  // installed/linked package actually exports it as a value (see
  // isImageTransformExported) - the published package has a real bug
  // (`.d.ts` declares it, but `src/index.ts` re-exports it as type-only,
  // so it's absent at runtime); importing it unconditionally would turn
  // that into a harness-level SyntaxError ("does not provide an export
  // named 'ImageTransform'") instead of the snippet's own honest
  // "ImageTransform is not defined" - see the missing-method audit
  // finding for the packaging bug itself. When testing against a locally
  // patched build with the fix applied, this correctly includes it.
  const imports = ["BaseAsset", "BaseEntry", "BaseGlobalField", "QueryOperation", "QueryOperator", "TaxonomyQueryOperation", "Orientation"];
  if (imageTransformExported) imports.push("ImageTransform");
  const harness = `import contentstack, { ${imports.join(", ")} } from '@contentstack/delivery-sdk';
import 'dotenv/config';

${injectedLines.join("\n")}

async function __run() {
${withoutImports}
${lastConst ? `  console.log(${JSON.stringify(RESULT_MARKER)} + JSON.stringify(${lastConst}));` : ""}
}

__run().catch((e) => {
  console.error(${JSON.stringify(ERROR_MARKER)} + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
`;
  return { harness, injected };
}

export async function runSnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string
): Promise<RunResult> {
  const { code: substituted, substitutions } = substitute(rawCode, placeholderMap());
  const code = keepFirstVariant(substituted);
  if (code.length !== substituted.length) substitutions["(truncated)"] = "kept first documented variant only - duplicate const declaration detected";
  const { harness, injected } = buildHarness(code, await isImageTransformExported());
  Object.assign(substitutions, injected);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/snippet-${methodId}.ts`;
  writeFileSync(file, harness);

  try {
    const { stdout } = await execFileAsync("npx", ["tsx", file], { timeout: 30_000, cwd: process.cwd() });
    const resultLine = stdout.split("\n").find((l) => l.includes(RESULT_MARKER));
    return {
      methodId,
      navSection,
      method,
      outcome: "pass",
      resolvedOutput: resultLine ? resultLine.split(RESULT_MARKER)[1]?.slice(0, 2000) : undefined,
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

/**
 * App-SDK counterpart to runSnippet.ts/runManagementSnippet.ts/
 * runMarketplaceSnippet.ts - fundamentally different execution model from
 * all three: there is no Node subprocess. `ContentstackAppSDK.init()` only
 * does anything meaningful inside a real iframe embedded in the real
 * Contentstack UI (postMessage handshake via `post-robot` - see
 * testapp/src/init.ts). So instead of spawning `tsx` on a generated file,
 * this evaluates the doc's own snippet body directly inside an already-live
 * Playwright `Frame` (the real iframe, already past SDK initialization) via
 * `frame.evaluate()` - genuinely running the doc's verbatim code against
 * the real UI, not a simulation.
 *
 * The doc's own examples assume earlier-declared variables carry over
 * within a section (e.g. CustomField's methods reference `customField`,
 * assumed declared once from `sdk.location.CustomField` in the Quickstart) -
 * same "inject a preamble if referenced-but-undeclared" approach as
 * runSnippet.ts's BARE_IDENTIFIER_VALUES / needsStackInit, scoped to this
 * doc's actual variable names per section.
 */
import type { Frame } from "playwright";
import type { RunResult } from "../types.js";
import { substitute, keepFirstVariant, lastTopLevelConst } from "./runSnippet.js";

/**
 * Preamble line to inject if a snippet BARE-REFERENCES the variable but
 * never declares it. Keyed by variable name, not nav section - the
 * scraper's `navSection` for every Stack/Entry/Field/Frame/Store method is
 * uniformly "App SDK Core Objects" (that whole page is one nav section;
 * the doc has no per-object sub-sections in the scraped data), so there's
 * no way to know "this method belongs to Stack" from navSection alone.
 * Detecting by which bare identifier the snippet itself references works
 * regardless of section, and matches how the doc's own examples are
 * written (each Core Object method assumes its own object variable was
 * already declared earlier on the same page, exactly like `stack`/`entry`/
 * etc. are introduced once in CustomField's own example).
 */
const VAR_PREAMBLE: Record<string, string> = {
  customField: "const customField = sdk.location.CustomField;",
  stack: "const stack = customField.stack;",
  entry: "const entry = customField.entry;",
  field: "const field = customField.field;",
  frame: "const frame = customField.frame;",
  store: "const store = sdk.store;",
  // Some Frame Object examples (on the "App SDK Core Objects" page) use
  // `dashboard.frame`/`fieldModifier.frame` instead of `customField.frame` -
  // assuming DashboardWidget's/FieldModifierLocation's own earlier examples
  // already declared these on the same page read top-to-bottom. Real
  // `sdk.location.X` values are only populated in the iframe the real UI
  // actually embedded for that location - from the CustomField iframe these
  // resolve to `undefined`, so `frame.enableResizing()` fails with a
  // meaningful "Cannot read properties of undefined", not a ReferenceError.
  dashboard: "const dashboard = sdk.location.DashboardWidget;",
  fieldModifier: "const fieldModifier = sdk.location.FieldModifierLocation;",
  sidebar: "const sidebar = sdk.location.SidebarWidget;",
};
// Injection order matters - `stack`/`entry`/`field`/`frame` are all reached
// via `customField`, so it must be declared first if any of them are used.
const VAR_ORDER = ["customField", "stack", "entry", "field", "frame", "store", "dashboard", "fieldModifier", "sidebar"];

function buildHarnessBody(code: string): string {
  const withoutImports = code
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l))
    .filter((l) => !/^\s*Example\s*\d*\s*:\s*$/.test(l))
    .join("\n")
    .replace(/^\s*Example\s*\d*\s*:\s*/, "");

  const declares = (name: string) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(withoutImports);
  const references = (name: string) => new RegExp(`\\b${name}\\b`).test(withoutImports);
  const injected: string[] = [];
  const needsCustomField = VAR_ORDER.some((v) => v !== "customField" && v !== "store" && references(v) && !declares(v));
  for (const name of VAR_ORDER) {
    if (declares(name)) continue;
    if (name === "customField" && !(needsCustomField || references("customField"))) continue;
    if (name !== "customField" && !references(name)) continue;
    injected.push(VAR_PREAMBLE[name]);
  }

  const lastConst = lastTopLevelConst(withoutImports);
  // Stringify INSIDE the browser, not after frame.evaluate() returns - SDK
  // objects (dashboard/customField/field/...) contain circular references
  // (confirmed live: Playwright's own cross-boundary result serialization
  // throws "Converting circular structure to JSON" on several methods that
  // actually ran successfully) - returning a plain string sidesteps
  // Playwright ever trying to structured-clone the live object at all. A
  // custom replacer drops anything circular/non-plain instead of throwing.
  const returnLine = lastConst
    ? `\nreturn (() => { try { const seen = new WeakSet(); return JSON.stringify(${lastConst}, (k, v) => { if (typeof v === "object" && v !== null) { if (seen.has(v)) return "[circular]"; seen.add(v); } if (typeof v === "function") return "[function]"; return v; }); } catch (e) { return "[unserializable: " + (e && e.message) + "]"; } })();`
    : "";
  return `${injected.join("\n")}\n${withoutImports}${returnLine}`;
}

export async function runAppSdkSnippet(
  frame: Frame,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string,
  overridePlaceholders: Record<string, string> = {}
): Promise<RunResult> {
  const { code: substituted, substitutions } = substitute(rawCode, overridePlaceholders);
  const code = keepFirstVariant(substituted);
  if (code.length !== substituted.length) substitutions["(truncated)"] = "kept first documented variant only - duplicate const declaration detected";
  const body = buildHarnessBody(code);

  try {
    // Wrapped in an async IIFE evaluated inside the live iframe - `sdk` is
    // already on `window` from testapp/src/init.ts's earlier initialization.
    // Callback-registration methods (onSave/onChange/...) resolve
    // immediately once the registration call itself doesn't throw - this
    // harness can't wait for a real user edit/save/publish action to fire
    // the callback, so it only verifies the registration call succeeds, not
    // that the callback itself later runs correctly (a genuine, documented
    // limitation - see the report).
    const result = await frame.evaluate(
      new Function(
        "return (async () => {\n" +
          body +
          "\n})()"
      ) as unknown as () => Promise<any>
    );
    return {
      methodId,
      navSection,
      method,
      outcome: "pass",
      resolvedOutput: typeof result === "string" ? result.slice(0, 2000) : undefined,
      substitutions,
    };
  } catch (e: any) {
    return {
      methodId,
      navSection,
      method,
      outcome: "fail",
      error: (e?.message ?? String(e)).slice(0, 1000),
      substitutions,
    };
  }
}

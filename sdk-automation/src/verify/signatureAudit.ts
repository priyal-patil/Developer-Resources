/**
 * v1-lite signature audit: rather than diffing each documented method's full
 * parameter list against the SDK's real .d.ts declarations (a much larger
 * undertaking - would need per-class AST matching), this checks the cheaper
 * but still useful thing: does the SDK's installed type declarations mention
 * this method/property name AT ALL. A documented method that doesn't appear
 * anywhere in the package's public .d.ts surface is a strong signal the doc
 * is stale (renamed/removed method) - worth flagging even without a full
 * parameter-level diff.
 *
 * Extend this to real signature comparison once the first live run confirms
 * the execution/report pipeline end-to-end.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AuditFinding, MethodEntry } from "../types.js";

function collectDtsText(pkgDir: string): string {
  let out = "";
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".d.ts")) out += readFileSync(full, "utf8") + "\n";
    }
  };
  walk(pkgDir);
  return out;
}

// Method names that are structural/generic and too common to be a useful
// existence check (would always "pass" against any .d.ts) - skip auditing
// these rather than produce noise.
const SKIP_NAMES = new Set(["Overview", "Contentstack", "Stack", "Example"]);

export async function signatureAudit(methods: MethodEntry[], sdkPackage: string): Promise<AuditFinding[]> {
  let dts: string;
  try {
    dts = collectDtsText(new URL(`../../node_modules/${sdkPackage}`, import.meta.url).pathname);
  } catch (e: any) {
    return [
      {
        methodId: -1,
        navSection: "-",
        method: "-",
        kind: "missing-method",
        detail: `Could not read ${sdkPackage}'s .d.ts files to audit against: ${e.message}`,
      },
    ];
  }

  const findings: AuditFinding[] = [];
  for (const m of methods) {
    // The DOM scraper captures every heading including the section's own
    // top-level H2 (e.g. "Asset Collection" heading under navSection
    // "Asset Collection") - that's a container heading, not a real API
    // method name, so auditing it against the SDK's method list is a
    // guaranteed-useless "not found" every time.
    if (m.navSection === "Overview" || SKIP_NAMES.has(m.method) || m.method === m.navSection) continue;
    const re = new RegExp(`\\b${m.method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (!re.test(dts)) {
      findings.push({
        methodId: m.id,
        navSection: m.navSection,
        method: m.method,
        kind: "missing-method",
        detail: `"${m.method}" does not appear anywhere in ${sdkPackage}'s installed .d.ts files - documented method may be renamed or removed.`,
      });
    }
  }

  findings.push(...(await runtimeExportAudit(dts, methods, sdkPackage)));
  return findings;
}

/**
 * A .d.ts can declare a value export (a class/const re-exported from a
 * submodule) that the package's actual compiled JS doesn't provide - a
 * types/runtime packaging mismatch invisible to signatureAudit's text
 * search above, since the name genuinely IS in the .d.ts. Caught this on
 * the TypeScript Delivery SDK itself: `export { I as ImageTransform } from
 * './lib/string-extensions.js'` is declared, but
 * `Object.keys(await import(sdkPackage))` never includes it - every
 * ImageTransform doc snippet's `new ImageTransform()` throws
 * ReferenceError against the real installed package.
 */
async function runtimeExportAudit(dts: string, methods: MethodEntry[], sdkPackage: string): Promise<AuditFinding[]> {
  const declaredValueExports = new Set<string>();
  for (const m of dts.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const asMatch = part.match(/(?:\w+\s+as\s+)?(\w+)\s*$/);
      if (asMatch) declaredValueExports.add(asMatch[1]);
    }
  }
  for (const m of dts.matchAll(/export\s+declare\s+class\s+(\w+)/g)) declaredValueExports.add(m[1]);

  let runtimeKeys: Set<string>;
  try {
    const mod: any = await import(sdkPackage);
    runtimeKeys = new Set(Object.keys(mod));
  } catch {
    return []; // can't confirm either way - don't guess
  }

  const findings: AuditFinding[] = [];
  for (const name of declaredValueExports) {
    if (runtimeKeys.has(name)) continue;
    const usedByMethods = methods.filter((m) => m.codeBlocks.some((b) => new RegExp(`\\bnew\\s+${name}\\s*\\(`).test(b)));
    for (const m of usedByMethods) {
      findings.push({
        methodId: m.id,
        navSection: m.navSection,
        method: m.method,
        kind: "missing-method",
        detail: `"${name}" is declared as a value export in ${sdkPackage}'s .d.ts but is absent from the installed package's actual runtime exports (types/runtime packaging mismatch) - "new ${name}()" throws ReferenceError.`,
      });
    }
  }
  return findings;
}

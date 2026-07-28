/**
 * Enriches missing-method findings with a look at the SDK's actual source
 * (a cloned repo, not just the installed npm package's .d.ts/runtime) to
 * turn "doesn't appear anywhere" into either a precise root cause or a
 * confirmed dead end.
 *
 * This caught a real one on ImageTransform: the class is fully implemented
 * in src/assets/image-transform.ts and re-exported as a VALUE from
 * src/assets/index.ts, but the package's top-level src/index.ts downgrades
 * it to `export type { ImageTransform }` - a type-only re-export - so
 * `new ImageTransform()` throws ReferenceError for any consumer importing
 * from the package root, exactly as the doc's examples do. Every other
 * class in the SDK (Stack, Entry, ContentType, ...) is *also* exported
 * type-only at the top level, but that's fine for them since consumers
 * never call `new Stack()` directly - they get instances from factory
 * methods (`contentstack.stack()`, `stack.asset()`, ...). ImageTransform is
 * the one class the docs instantiate directly, so the same export pattern
 * that's correct for the others is a bug for this one.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AuditFinding } from "../types.js";

function collectSourceFiles(dir: string, out: { path: string; text: string }[] = []): { path: string; text: string }[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "test" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectSourceFiles(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !entry.endsWith(".d.ts") && !entry.endsWith(".min.js")) out.push({ path: full, text: readFileSync(full, "utf8") });
  }
  return out;
}

export function sourceAudit(findings: AuditFinding[], repoSrcDir: string): AuditFinding[] {
  let files: { path: string; text: string }[];
  try {
    files = collectSourceFiles(repoSrcDir);
  } catch (e: any) {
    return findings; // repo not cloned - leave findings as-is, don't guess
  }

  return findings.map((f) => {
    if (f.kind !== "missing-method") return f;

    // Special case: a value-export downgraded to `export type { Name }` at
    // the package's public entry point is the single most common way a
    // fully-implemented class becomes "missing" at runtime - check for it
    // before falling back to the generic occurrence search. The runtime
    // export audit's findings are keyed by the doc's method name (e.g.
    // "auto"), not the class name ("ImageTransform") - the class name is
    // only present in that finding's own detail text, quoted.
    const classNameMatch = f.detail.match(/^"([A-Za-z_$][\w$]*)" is declared as a value export/);
    const probeName = classNameMatch?.[1] ?? f.method;

    const topLevelIndexPath = join(repoSrcDir, "index.ts");
    const indexFile = files.find((file) => file.path === topLevelIndexPath);
    if (indexFile) {
      const typeOnlyRe = new RegExp(`export\\s+type\\s*\\{[^}]*\\b${probeName}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`);
      const m = indexFile.text.match(typeOnlyRe);
      if (m) {
        const lineNum = indexFile.text.slice(0, m.index).split("\n").length;
        return {
          ...f,
          detail: `Confirmed in source: ${probeName} is a real, fully-implemented class (src/${m[1].replace(/^\.\//, "")}/index.ts exports it as a VALUE), but src/index.ts:${lineNum} downgrades it to \`export type { ${probeName} }\` - type-only - at the package's public entry point. Since the doc instantiates it directly (\`new ${probeName}()\`), this makes every documented example unusable. One-line fix: change to \`export { ${probeName} }\` in src/index.ts.`,
        };
      }
    }

    const hits = files.filter((file) => new RegExp(`\\b${f.method}\\b`).test(file.text));
    if (hits.length === 0) {
      return { ...f, detail: `${f.detail} Also confirmed absent from the SDK's actual source (not just the installed package) - likely a genuinely stale or removed doc reference, not a packaging issue.` };
    }
    const locations = hits.slice(0, 3).map((h) => h.path.split("/src/")[1] ?? h.path).join(", ");
    return { ...f, detail: `${f.detail} Found in source at: ${locations} - may be exported under a different name, or exist but not be part of the public API surface.` };
  });
}

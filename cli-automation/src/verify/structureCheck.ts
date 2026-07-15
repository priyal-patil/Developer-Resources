/**
 * Verifies the doc's "Export Directory Structure" tree against what a
 * full export actually wrote to disk — missing entries and extra entries
 * are both reported, mirroring the kickstart Project Structure check.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DocBlock, StructureFinding } from "../types.js";

/** Top-level entries of a doc tree block (depth-0 ├──/└── items + root files). */
export function parseTreeTopLevel(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    // Depth 0 means the connector starts at column 0 (no │ or spaces before it).
    const m = line.match(/^(?:├──|└──)\s+(.+?)\/?\s*$/);
    if (m && !m[1].startsWith("[")) out.push(m[1].replace(/\/$/, ""));
  }
  return out;
}

export function checkStructure(
  treeBlocks: DocBlock[],
  exportDir: string
): StructureFinding[] {
  const findings: StructureFinding[] = [];
  // The unbranched tree under "Export Directory Structure" is the verifiable one.
  const main = treeBlocks.find((b) => /Export Directory Structure/.test(b.section) && !/branch/i.test(b.label));
  if (!main) return [{ kind: "note", entry: "-", detail: "Doc has no Export Directory Structure tree to verify" }];

  if (!existsSync(exportDir)) {
    return [{ kind: "note", entry: exportDir, detail: "Export dir missing — full export never succeeded, structure not verifiable" }];
  }

  let actual = readdirSync(exportDir).filter((e) => !e.startsWith("."));
  // The CLI writes `branches.json` + a `<branch>/` folder holding the modules;
  // the doc's tree shows modules at the top level. Descend, and report the drift.
  const dirs = actual.filter((e) => {
    try {
      return readdirSync(path.join(exportDir, e)).length >= 0;
    } catch {
      return false;
    }
  });
  if (dirs.length === 1 && actual.length <= 3) {
    const inner = readdirSync(path.join(exportDir, dirs[0])).filter((e) => !e.startsWith("."));
    if (inner.length > 1) {
      findings.push({
        kind: "missing-on-disk",
        entry: "(top-level layout)",
        detail: `Doc tree shows modules directly under ./export/, but the export actually wrote ${actual.join(", ")} with the modules nested inside "${dirs[0]}/"`,
      });
      actual = inner;
    }
  }

  const promised = parseTreeTopLevel(main.raw);
  // Doc trees use hyphens (content-types/); exports write underscores — compare normalized,
  // but report the naming drift once if it exists.
  const norm = (s: string) => s.replace(/[-_]/g, "_");
  const actualSet = new Set(actual.map(norm));
  const promisedSet = new Set(promised.map(norm));

  for (const p of promised) {
    if (!actualSet.has(norm(p))) findings.push({ kind: "missing-on-disk", entry: p, detail: "Promised in doc tree, absent after full export" });
  }
  for (const a of actual) {
    if (!promisedSet.has(norm(a))) findings.push({ kind: "extra-on-disk", entry: a, detail: "Written by export, absent from doc tree" });
  }
  const hyphenDrift = promised.filter((p) => p.includes("-") && actual.includes(p.replace(/-/g, "_")));
  for (const p of hyphenDrift) {
    findings.push({ kind: "note", entry: p, detail: `Doc tree says "${p}/" but export writes "${p.replace(/-/g, "_")}/"` });
  }
  return findings;
}

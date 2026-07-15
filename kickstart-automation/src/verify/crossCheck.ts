/**
 * Cross-checks the doc's *claims* against the cloned repo:
 *   - Project Structure — every file/dir the doc lists should exist in the repo
 *   - Code snippets — each "File name: X" block should match the repo's file
 *
 * These are pure comparisons (no network/browser) and report gaps, never fix them.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { DocSnippet } from "../parse/parseDoc.js";
import type { DocStep, StepResult } from "../types.js";

const IGNORE = new Set(["node_modules", ".git", ".nuxt", ".output", "dist", ".DS_Store"]);

const pseudoStep = (index: number, title: string): DocStep => ({ index, title, kind: "unknown", commands: [], raw: "" });

/** Recursively collect files+dirs under root, as {basenames, relPaths}. */
function walkRepo(root: string): { basenames: Set<string>; relPaths: string[] } {
  const basenames = new Set<string>();
  const relPaths: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (IGNORE.has(entry)) continue;
      const abs = join(dir, entry);
      const isDir = statSync(abs).isDirectory();
      basenames.add(isDir ? `${entry}/` : entry);
      basenames.add(entry);
      relPaths.push(relative(root, abs) + (isDir ? "/" : ""));
      if (isDir) walk(abs);
    }
  };
  walk(root);
  return { basenames, relPaths };
}

/** Compare the doc's Project Structure listing to the repo. */
export function checkProjectStructure(repoDir: string, docNames: string[]): StepResult {
  const step = pseudoStep(101, "Project Structure — doc vs repo");
  if (!docNames.length) return { step, status: "skipped", detail: "no Project Structure block found in the doc" };
  if (!existsSync(repoDir)) return { step, status: "skipped", detail: "repo not cloned" };

  // Skip entries that legitimately won't exist right after a clone: dependencies
  // and framework-generated files. Their absence is not a doc gap.
  const GENERATED = /^(node_modules|\.nuxt|\.output|dist|build|next-env\.d\.ts|env\.d\.ts|\.env|\.next)\/?$/;
  const checkable = docNames.filter((n) => !GENERATED.test(n));

  const { basenames } = walkRepo(repoDir);
  const missing = checkable.filter((n) => !basenames.has(n) && !basenames.has(n.replace(/\/$/, "")));

  if (missing.length) {
    return {
      step,
      status: "failed",
      detail: `GAP: ${missing.length}/${checkable.length} items in the doc's Project Structure are NOT in the repo:\n  ${missing.join(", ")}`,
    };
  }
  return { step, status: "passed", detail: `all ${checkable.length} listed items exist in the repo` };
}

/** Normalize code for comparison: drop blank lines, trim each line. */
function normLines(code: string): string[] {
  return code
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Locate a repo file by its doc-stated path, else by basename. */
function findRepoFile(repoDir: string, relPaths: string[], docPath: string): string | null {
  const direct = join(repoDir, docPath);
  if (existsSync(direct)) return direct;
  const base = docPath.split("/").pop()!;
  const hit = relPaths.find((p) => p.endsWith(`/${base}`) || p === base);
  return hit ? join(repoDir, hit) : null;
}

/** Compare each doc code snippet to the corresponding repo file. */
export function checkCodeSnippets(repoDir: string, snippets: DocSnippet[]): StepResult[] {
  if (!snippets.length) return [];
  if (!existsSync(repoDir)) return [];
  const { relPaths } = walkRepo(repoDir);

  return snippets.map((snip, i) => {
    const step = pseudoStep(110 + i, `Code snippet — ${snip.file}`);
    const filePath = findRepoFile(repoDir, relPaths, snip.file);
    if (!filePath) {
      return { step, status: "failed" as const, detail: `GAP: doc shows "${snip.file}" but no such file exists in the repo` };
    }
    const repoLines = new Set(normLines(readFileSync(filePath, "utf8")));
    const docLines = normLines(snip.code);
    const missing = docLines.filter((l) => !repoLines.has(l));
    const ratio = docLines.length ? (docLines.length - missing.length) / docLines.length : 1;

    if (ratio >= 0.85) {
      return { step, status: "passed" as const, detail: `snippet matches ${relative(repoDir, filePath)} (${Math.round(ratio * 100)}% of lines present)` };
    }
    return {
      step,
      status: "failed" as const,
      detail: `GAP: doc snippet for "${snip.file}" differs from ${relative(repoDir, filePath)} — only ${Math.round(ratio * 100)}% of doc lines present. Examples missing:\n  ${missing.slice(0, 4).join("\n  ")}`,
    };
  });
}

/**
 * Static text checks over every raw code block, independent of whether the
 * snippet actually executes. Catches doc-formatting issues that a runtime
 * pass wouldn't surface on its own (a snippet can still run correctly with
 * a smart quote inside a string literal, for instance).
 */
import type { AuditFinding, MethodEntry } from "../types.js";

const SMART_QUOTES = /[‘’“”]/;
const INVISIBLE_CHARS = /[​‌‍﻿]/;

export function lintBlocks(methods: MethodEntry[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const m of methods) {
    for (const block of m.codeBlocks) {
      if (/^\s*Example\s*\d*\s*:\s*$/m.test(block)) {
        findings.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          kind: "lint",
          detail: "Fenced code block includes a leading 'Example:' label baked into the code itself (not stripped by the .md export) - not valid code on its own.",
        });
      }
      if (SMART_QUOTES.test(block)) {
        findings.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          kind: "lint",
          detail: "Code block contains a smart/curly quote character instead of a straight quote.",
        });
      }
      if (INVISIBLE_CHARS.test(block)) {
        findings.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          kind: "lint",
          detail: "Code block contains an invisible/zero-width character.",
        });
      }
      const constNames = [...block.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)].map((mm) => mm[1]);
      const dupe = constNames.find((n, i) => constNames.indexOf(n) !== i);
      if (dupe) {
        findings.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          kind: "lint",
          detail: `Code block declares "const ${dupe}" more than once - likely two alternative one-liners joined by "// OR" that were never meant to run together, not a real duplicate-declaration bug.`,
        });
      }

      const opens = (block.match(/\{/g) ?? []).length;
      const closes = (block.match(/\}/g) ?? []).length;
      if (opens !== closes) {
        findings.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          kind: "lint",
          detail: `Unbalanced braces in code block (${opens} "{" vs ${closes} "}").`,
        });
      }
    }
  }
  return findings;
}

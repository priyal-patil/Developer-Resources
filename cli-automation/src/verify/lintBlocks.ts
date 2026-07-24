/**
 * Static lint of the doc's code blocks for authoring bugs that execution
 * alone can't diagnose (or can't reach, in non-executed blocks):
 *
 *  - smart/curly quotes where straight quotes belong
 *  - mismatched opening/closing quote styles or unbalanced quotes
 *  - malformed csdx command paths (double colon, trailing colon)
 *  - invisible characters (non-breaking space, zero-width) that break
 *    copy-paste
 *  - en/em dash used where a flag's hyphen belongs
 *
 * Runs over ALL block kinds, including sample output and trees, since a
 * reader copies from any of them.
 */
import type { DocBlock, LintFinding, ProseSegment } from "../types.js";

const SMART_QUOTES = /[“”‘’«»]/; // curly double/single quotes, guillemets
const INVISIBLES = /[ ​‌‍﻿]/; // nbsp, zero-width space/joiners, BOM
const DASH_FLAG = /(^|\s)[–—][–—]?[a-zA-Z]/; // en/em dash before a flag name

function snippetAround(line: string, index: number): string {
  return line.slice(Math.max(0, index - 30), index + 30).trim();
}

export function lintBlocks(blocks: DocBlock[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const b of blocks) {
    const add = (issue: string, snippet: string) =>
      findings.push({ blockId: b.id, section: b.section, label: b.label, issue, snippet: snippet.slice(0, 80) });

    for (const line of b.raw.split("\n")) {
      const sq = line.match(SMART_QUOTES);
      if (sq?.index !== undefined) {
        add(`Smart/curly quote (${sq[0]}) instead of a straight quote — breaks copy-paste`, snippetAround(line, sq.index));
      }
      const inv = line.match(INVISIBLES);
      if (inv?.index !== undefined) {
        const name = inv[0] === " " ? "non-breaking space" : "zero-width character";
        add(
          `Invisible ${name} (U+${inv[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}) — breaks copy-paste`,
          snippetAround(line, inv.index)
        );
      }
      const dash = line.match(DASH_FLAG);
      if (dash?.index !== undefined && b.kind !== "output" && b.kind !== "tree") {
        add("En/em dash used where a flag's hyphen belongs (– or — instead of -)", snippetAround(line, dash.index));
      }

      // Command-shaped lines get stricter checks.
      const cmdLine = line.trim();
      if (cmdLine.startsWith("csdx ")) {
        const token = cmdLine.split(/\s+/)[1] ?? "";
        if (token.includes("::")) add(`Double colon in command path "${token}"`, cmdLine);
        if (/:$/.test(token)) add(`Trailing colon in command path "${token}"`, cmdLine);
        if (token && !/^[a-z0-9:-]+$/.test(token)) add(`Unexpected characters in command path "${token}"`, cmdLine);

        // Unbalanced straight quotes on a single command line.
        const dq = (cmdLine.match(/"/g) ?? []).length;
        const sq2 = (cmdLine.match(/'/g) ?? []).length;
        if (dq % 2 !== 0) add(`Unbalanced double quotes (${dq} found)`, cmdLine);
        if (sq2 % 2 !== 0) add(`Unbalanced single quotes (${sq2} found)`, cmdLine);
      }

      // A bare "cm:namespace:command ..." with no leading "csdx " is not
      // runnable as printed — bash would look for a binary literally named
      // "cm:stacks:import-setup" and fail with "command not found".
      const bareCmd = cmdLine.match(/^(cm:[\w:-]+)\b/);
      if (bareCmd && !/^csdx\s/.test(cmdLine)) {
        add(`Missing "csdx" prefix — "${bareCmd[1]}" as printed is not a runnable command`, cmdLine);
      }
    }
  }
  return findings;
}

/**
 * Prose lint — deliberately tighter than the code-block lint, because curly
 * quotes and em dashes are legitimate typography in running text. Flags only
 * what's unambiguously wrong:
 *
 *  - invisible characters anywhere
 *  - malformed csdx command mentions (double/trailing colon)
 *  - en/em dash attached to a KNOWN flag name (– data-dir etc. — a
 *    copy-from-Word bug readers will copy back out)
 *  - mismatched curly-quote pairs / odd number of straight double quotes
 *  - doubled words ("the the")
 */
export function lintProse(prose: ProseSegment[], flagNames: string[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const flagAlt = flagNames
    .map((f) => f.replace(/^--/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const dashFlag = flagAlt ? new RegExp(`[–—]-?(${flagAlt})\\b`) : null;

  for (const p of prose) {
    const add = (issue: string, index: number) =>
      findings.push({
        blockId: -1,
        section: p.section,
        label: "(prose)",
        issue,
        snippet: snippetAround(p.text, index).slice(0, 80),
      });

    const inv = p.text.match(INVISIBLES);
    if (inv?.index !== undefined) {
      add(`Invisible character (U+${inv[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}) in prose — breaks copy-paste`, inv.index);
    }

    // An Options-list bullet whose flag starts with an en/em dash instead of
    // a hyphen — unconditional, unlike the dashFlag check below, because
    // this exact bug is what stops the flag from ever becoming "known" in
    // the first place (the Options parser requires ASCII hyphens). Two
    // shapes seen in practice: a bare leading en-dash ("–y, --yes: ...",
    // one dash total) and a hyphen immediately followed by an en-dash
    // ("-–org=org: ...", likely an editor auto-converting a typed "--org"
    // into hyphen+en-dash) — the second still breaks a --long flag even
    // though a literal "-" opens the line.
    const leadingDash = p.text.match(/^-?[–—](\w[\w-]*)\b/);
    if (leadingDash) {
      const isDoubleDashAttempt = p.text.startsWith("-");
      add(
        isDoubleDashAttempt
          ? `Hyphen + en/em dash instead of "--" on flag "--${leadingDash[1]}" — breaks copy-paste and the flag never parses as documented`
          : `En/em dash instead of a hyphen on short flag "-${leadingDash[1]}" — breaks copy-paste and the flag never parses as documented`,
        0
      );
    }

    // csdx command mentions with malformed paths. (No trailing-colon check in
    // prose — a sentence-final colon after a command name is normal punctuation.)
    for (const m of p.text.matchAll(/\bcm:[\w:-]*|\bcsdx\s+([\w:-]+)/g)) {
      const token = m[1] ?? m[0];
      if (token.includes("::")) add(`Double colon in command mention "${token}"`, m.index ?? 0);
    }

    if (dashFlag) {
      const d = p.text.match(dashFlag);
      if (d?.index !== undefined) add(`En/em dash on flag "${d[0]}" — should be a hyphen (-)`, d.index);
    }

    const open = (p.text.match(/“/g) ?? []).length;
    const close = (p.text.match(/”/g) ?? []).length;
    if (open !== close) add(`Mismatched curly quotes (${open} opening vs ${close} closing)`, 0);
    const straight = (p.text.match(/"/g) ?? []).length;
    if (straight % 2 !== 0) add(`Odd number of double quotes (${straight}) — likely missing opening/closing quote`, 0);

    const dup = p.text.match(/\b([A-Za-z]{2,})\s+\1\b/i);
    if (dup?.index !== undefined && !/^(had|that|is)$/i.test(dup[1])) {
      add(`Doubled word "${dup[1]} ${dup[1]}"`, dup.index);
    }
  }
  return findings;
}

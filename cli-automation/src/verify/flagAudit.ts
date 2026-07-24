/**
 * Flag audit: run `csdx <command> --help`, parse the FLAGS section, and
 * diff it against the doc's Options table in both directions —
 * missing-in-doc, extra-in-doc, short-flag mismatches, and description
 * drift (token-overlap similarity so paraphrasing doesn't false-positive,
 * but real meaning changes do get reported).
 */
import type { CliFlag, DocOption, FlagFinding } from "../types.js";
import { run } from "../setup/csdx.js";

export async function getCliFlags(command: string): Promise<CliFlag[]> {
  const r = await run(`csdx ${command} --help`, { timeoutMs: 60_000 });
  if (r.exitCode !== 0) throw new Error(`--help failed for ${command}: ${r.output.slice(-300)}`);
  return parseHelpFlags(r.output);
}

/** Parse oclif help output. Handles both same-line and wrapped-description layouts. */
export function parseHelpFlags(help: string): CliFlag[] {
  const lines = help.split("\n");
  const flags: CliFlag[] = [];
  let cur: CliFlag | null = null;
  // oclif help output can split flags across MULTIPLE labeled sections —
  // "FLAGS", "COMMON FLAGS", "TABLE FLAGS", "GLOBAL FLAGS" — not just one.
  // Stopping at the first section header that isn't exactly "FLAGS"/"TABLE
  // FLAGS" (the old behavior) silently discarded every later section,
  // undercounting real flags against docs that document all of them.
  let inFlagsSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedFull = line.trim();
    if (/^[A-Z ]*FLAGS$/.test(trimmedFull)) {
      if (cur) flags.push(cur);
      cur = null;
      inFlagsSection = true;
      continue;
    }
    if (/^[A-Z][A-Z ]+$/.test(trimmedFull) && trimmedFull.length > 3) {
      // A different all-caps section header (DESCRIPTION, EXAMPLES, USAGE,
      // ALIASES…) — leave the flags-accumulating mode until another *FLAGS
      // header is seen.
      if (cur) flags.push(cur);
      cur = null;
      inFlagsSection = false;
      continue;
    }
    if (!inFlagsSection) continue;
    // Long-only flags (no short form) are right-padded with extra indentation
    // to align their `=<value>` column under short-flag rows — don't bound
    // the leading whitespace, just require the trimmed line to start with a
    // flag token so it's distinguished from a wrapped description line.
    const trimmed = line.replace(/^\s+/, "");
    const m = trimmed.match(/^(?:(-\w),\s+)?(--\[?n?o?-?\]?[\w-]+)(?:=<[^>]+>(?:\.\.\.)?)?\s*(.*)$/);
    if (m && /^\s+\S/.test(line)) {
      if (cur) flags.push(cur);
      // --[no-]show-console-logs documents both forms; normalize to the positive one.
      const flag = m[2].replace(/^--\[no-\]/, "--");
      cur = { short: m[1], flag, description: m[3].trim() };
    } else if (cur && line.trim()) {
      cur.description = `${cur.description} ${line.trim()}`.trim();
    }
  }
  if (cur) flags.push(cur);
  return flags;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[optional\]|\[default:[^\]]*\]|\[env:[^\]]*\]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-overlap similarity (Jaccard). */
function similarity(a: string, b: string): number {
  const ta = new Set(normalize(a).split(" ").filter(Boolean));
  const tb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function auditFlags(docOptions: DocOption[], cliFlags: CliFlag[]): FlagFinding[] {
  const findings: FlagFinding[] = [];
  const docByFlag = new Map(docOptions.map((o) => [o.flag, o]));
  const cliByFlag = new Map(cliFlags.map((f) => [f.flag, f]));

  for (const f of cliFlags) {
    if (!docByFlag.has(f.flag)) {
      findings.push({ kind: "missing-in-doc", flag: f.flag, cli: `${f.short ? f.short + ", " : ""}${f.flag} — ${f.description}` });
    }
  }
  for (const o of docOptions) {
    const cli = cliByFlag.get(o.flag);
    if (!cli) {
      findings.push({ kind: "extra-in-doc", flag: o.flag, doc: `${o.short ? o.short + ", " : ""}${o.flag} — ${o.description}` });
      continue;
    }
    if ((o.short ?? "") !== (cli.short ?? "")) {
      findings.push({
        kind: "short-flag-mismatch",
        flag: o.flag,
        doc: o.short ?? "(no short flag documented)",
        cli: cli.short ?? "(no short flag in CLI)",
      });
    }
    if (similarity(o.description, cli.description) < 0.35) {
      findings.push({ kind: "description-mismatch", flag: o.flag, doc: o.description, cli: cli.description });
    }
  }
  return findings;
}

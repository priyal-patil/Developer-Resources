/**
 * Fetches a CLI doc as markdown (<url>.md) and extracts everything the
 * pipeline needs: code blocks (classified), the Options table, the
 * Configuration File Options table, and prerequisites.
 *
 * The docs site's .md export flattens HTML tables into loose paragraphs
 * ("Option", "Description", "Required", then rows as consecutive
 * paragraphs), so the table parsers work on paragraph grouping rather
 * than pipe-table syntax.
 */
import "dotenv/config";
import type { BlockKind, DocBlock, DocConfigOption, DocOption, ParsedDoc, ProseSegment } from "../types.js";

export async function fetchDocMarkdown(url: string): Promise<string> {
  const res = await fetch(`${url}.md`);
  if (!res.ok) throw new Error(`Failed to fetch ${url}.md: HTTP ${res.status}`);
  return res.text();
}

/** Strip the backslash-escaping the .md export adds (\- \_ \\ etc). */
function unescape(s: string): string {
  return s.replace(/\\([\\_\-*.<>[\]#`])/g, "$1");
}

interface Segment {
  heading: string[];
  text: string;
}

/** Split the doc into (heading-breadcrumb, body) segments, code blocks kept inline. */
function splitFrontmatter(md: string): { front: Record<string, string>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  const front: Record<string, string> = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w[\w_]*):\s*"?(.*?)"?\s*$/);
      if (kv) front[kv[1]] = kv[2];
    }
    return { front, body: md.slice(m[0].length) };
  }
  return { front, body: md };
}

export function parseDoc(name: string, md: string): ParsedDoc {
  const { front, body } = splitFrontmatter(md);
  const lines = body.split("\n");

  const blocks: DocBlock[] = [];
  const prerequisites: string[] = [];
  const prose: ProseSegment[] = [];
  let options: DocOption[] = [];
  let configOptions: DocConfigOption[] = [];

  // Walk lines tracking heading breadcrumb; collect fenced blocks and section texts.
  const crumb: string[] = [];
  let inFence = false;
  let fenceBuf: string[] = [];
  let lastLabel = "";
  let sectionText: string[] = []; // non-code lines of the current innermost section
  let sectionName = "";

  const flushSection = () => {
    const text = sectionText.join("\n");
    if (/^prerequisites$/i.test(sectionName.trim())) {
      for (const l of text.split("\n")) {
        if (/^\*\s*\*\s*\*\s*$/.test(l.trim())) continue; // "* * *" horizontal rule, not a bullet
        const item = l.match(/^\*\s+(.*)/);
        if (item) {
          prerequisites.push(
            unescape(item[1])
              .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
              .replace(/\*\*/g, "")
              .trim()
          );
        }
      }
    }
    if (/^options$/i.test(sectionName.trim())) options = parseOptionsTable(text);
    if (/^configuration file options$/i.test(sectionName.trim())) configOptions = parseConfigOptionsTable(text);
    // Keep every prose paragraph (cleaned of markdown syntax) for the text lint.
    // List items become their own entries — merging "* cm" with the next
    // line "* cm:assets:publish" into one blob produced a false "doubled
    // word: cm cm" finding, since adjacent list items often start with the
    // same token (a namespace name followed by its member commands).
    const section = crumb.slice(1).join(" > ") || crumb.join(" > ");
    for (const para of text.split(/\n\s*\n/)) {
      const chunks: string[] = [];
      for (const line of para.split("\n")) {
        if (/^\s*[-*]\s+/.test(line) || !chunks.length) chunks.push(line);
        else chunks[chunks.length - 1] += " " + line;
      }
      for (const chunk of chunks) {
        const clean = unescape(chunk)
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
          .replace(/\*\*|\*\s+|^#+\s*/g, " ") // bold markers, bullet stars
          .replace(/\s+/g, " ")
          .trim();
        if (clean) prose.push({ section, text: clean });
      }
    }
    sectionText = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        fenceBuf = [];
      } else {
        inFence = false;
        const raw = fenceBuf.join("\n");
        blocks.push({
          id: blocks.length,
          section: crumb.slice(1).join(" > ") || crumb.join(" > "),
          label: lastLabel,
          raw,
          kind: classifyBlock(raw),
        });
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushSection();
      const depth = h[1].length;
      crumb.splice(depth - 1);
      crumb[depth - 1] = unescape(h[2]).trim();
      sectionName = crumb[crumb.length - 1];
      lastLabel = "";
      continue;
    }
    const label = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (label) lastLabel = unescape(label[1]).replace(/:$/, "").trim();
    sectionText.push(line);
  }
  flushSection();

  return {
    name,
    title: front.title ?? name,
    url: front.url ?? "",
    lastUpdated: front.last_updated,
    prerequisites,
    blocks,
    options,
    configOptions,
    prose,
    commandOptions: extractInlineCommandOptions(body),
  };
}

/** Bullet-list parser for "* -x, --long=<value>: description" style Options. */
function parseOptionsBulletList(text: string): DocOption[] {
  const out: DocOption[] = [];
  for (const raw of text.split("\n")) {
    const line = unescape(raw).trim();
    const m = line.match(/^\*\s+(?:(-\w),\s*)?(--[\w-]+)(?:=\S*)?:\s*(.*)$/);
    if (m) {
      out.push({
        short: m[1],
        flag: m[2],
        description: m[3].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim(),
        required: "",
      });
    }
  }
  return out;
}

/**
 * Scans the whole doc body for inline "**Options:**" bold labels (as opposed
 * to a heading literally named "Options") and associates each Options block
 * with the nearest preceding `csdx <command>` mention — either an explicit
 * "**Command:** csdx X" label or the first token after `csdx` in a fenced
 * Usage example. A namespaced command (contains ":") wins over a bare alias
 * (e.g. "auth:login" over "login") so later "**OR** `csdx login`" examples
 * don't clobber the canonical name.
 */
function extractInlineCommandOptions(body: string): Record<string, DocOption[]> {
  const result: Record<string, DocOption[]> = {};
  const lines = body.split("\n");
  let currentCommand: string | undefined;
  let i = 0;

  const setCommand = (cand: string) => {
    if (cand.includes(":") || !currentCommand) currentCommand = cand;
  };

  while (i < lines.length) {
    const line = lines[i];

    const cmdLabel = line.match(/^\*\*Command:?\*\*:?\s*csdx\s+([\w:-]+)/);
    if (cmdLabel) {
      setCommand(cmdLabel[1]);
      i++;
      continue;
    }

    if (line.trim() === "```") {
      let j = i + 1;
      const buf: string[] = [];
      while (j < lines.length && lines[j].trim() !== "```") {
        buf.push(lines[j]);
        j++;
      }
      const raw = buf.join("\n").trim();
      const cmdMatch = raw.match(/^csdx\s+([\w:-]+)/);
      if (cmdMatch) setCommand(cmdMatch[1]);
      i = j + 1;
      continue;
    }

    if (/^\*\*Options:?\*\*:?\s*$/.test(line.trim())) {
      let j = i + 1;
      const buf: string[] = [];
      let sawContent = false;
      while (j < lines.length) {
        const l = lines[j];
        if (/^#{1,6}\s/.test(l)) break;
        if (sawContent && /^\*\*[A-Za-z].*\*\*:?\s*$/.test(l.trim())) break;
        if (l.trim()) sawContent = true;
        buf.push(l);
        j++;
      }
      const optionsText = buf.join("\n");
      const opts = /(^|\n)\s*\*\s+\\?-/.test(optionsText)
        ? parseOptionsBulletList(optionsText)
        : parseOptionsTable(optionsText);
      if (currentCommand && opts.length) {
        const existing = result[currentCommand] ?? [];
        const seen = new Set(existing.map((o) => o.flag));
        result[currentCommand] = [...existing, ...opts.filter((o) => !seen.has(o.flag))];
      }
      i = j;
      continue;
    }

    i++;
  }
  return result;
}

function classifyBlock(raw: string): BlockKind {
  const t = raw.trim();
  if (/\[OPTIONS\]/.test(t)) return "syntax";
  // A bare `<placeholder>` token (e.g. `csdx config:set:region <region>`, or
  // `--cda <custom_cda_host_url>`) marks a Usage synopsis line, not a literal
  // runnable example — treat it like `[OPTIONS]`: verified for existence via
  // --help, never executed. Actual runnable examples quote real values.
  // `<alias>` is excluded: it's a KNOWN, substitutable placeholder (see
  // substitute.ts) used in genuine runnable Quick Start examples across
  // several docs (e.g. `csdx cm:stacks:export -a <alias> --data-dir ./export`).
  if (/csdx\s/.test(t) && /<[\w-]+>/.test(t.replace(/<alias>/g, ""))) return "syntax";
  if (/^\s*\{/.test(t)) return "json";
  if (/(^|\n)\s*(\[\d{4}-|INFO:|SUCCESS:|C:\\Users\\[^ ]*>)/.test(t) || /█/.test(t)) return "output";
  if (/[├└│]/.test(t)) return "tree";
  if (/\$\{\{|^\s*-\s+name:|^\w[\w-]*:\s*$|^\s*script:/m.test(t) && /csdx/.test(t)) return "ci";
  if (/(^|\n)\s*(#.*\n\s*)?csdx\s/.test(t)) return "command";
  // Global npm install/update commands the CLI docs ask readers to run.
  if (/(^|\n)\s*npm\s+(install|update)\s+-g\s+@contentstack\/cli\b/.test(t)) return "command";
  return "unknown";
}

/**
 * Paragraph-grouping parser for the flattened Options table. Handles two
 * layouts: 3-column (short+flag combined in one cell, e.g. export doc's
 * "-k, --stack-api-key=<value>") and 4-column (short flag in its own cell,
 * e.g. configure-regions doc's Option/Short/Description/Required table).
 */
function parseOptionsTable(text: string): DocOption[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean)
    // stop at the trailing "**Note:** ..." paragraph
    .filter((p) => !/^\*\*Note/.test(p));

  // Drop the header words
  const rows = paras.filter((p) => !/^(Option|Short|Description|Required)$/i.test(p));

  const out: DocOption[] = [];
  const isFlagStart = (p: string) => /^\\?-{1,2}/.test(p);
  const isBareShort = (p: string) => /^\\?-\w$/.test(unescape(p).trim());

  let i = 0;
  while (i < rows.length) {
    if (!isFlagStart(rows[i])) {
      i++;
      continue;
    }
    const flagCell = unescape(rows[i]);
    let j = i + 1;
    let short: string | undefined;
    if (rows[j] && isBareShort(rows[j])) {
      short = unescape(rows[j]).trim();
      j++;
    }
    const description = rows[j] ?? "";
    const required = rows[j + 1] ?? "";
    const m = flagCell.match(/^(?:(-\w),\s*)?(--[\w-]+)/);
    if (m) {
      out.push({
        short: short ?? m[1],
        flag: m[2],
        description: unescape(description).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"),
        required: unescape(required),
      });
    }
    i = j + 2;
  }
  return out;
}

/** Paragraph-grouping parser for the Configuration File Options table (4 columns). */
function parseConfigOptionsTable(text: string): DocConfigOption[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .filter((p) => !/^(Option|Description|Type|Default)$/i.test(p));

  const out: DocConfigOption[] = [];
  // Rows are strict 4-tuples: key, description, type, default.
  const TYPES = new Set(["number", "string", "boolean", "object", "array"]);
  let i = 0;
  while (i + 2 < paras.length) {
    const [key, desc, type, def] = [paras[i], paras[i + 1], paras[i + 2], paras[i + 3] ?? ""];
    if (TYPES.has(type)) {
      out.push({
        key: unescape(key),
        description: unescape(desc).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"),
        type,
        default: unescape(def),
      });
      i += 4;
    } else {
      i += 1; // resync if a stray paragraph slips in
    }
  }
  return out;
}

// CLI entry: `npm run parse -- <name> <url>` prints the parse result.
if (process.argv[1]?.endsWith("parseDoc.ts")) {
  const [name = "export-content", url = "https://www.contentstack.com/docs/headless-cms/export-content-using-the-cli"] =
    process.argv.slice(2);
  const md = await fetchDocMarkdown(url);
  const doc = parseDoc(name, md);
  console.log(JSON.stringify(doc, null, 2));
}

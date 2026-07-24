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
  // Staging sites (e.g. stag-www.contentstack.com) sit behind HTTP Basic
  // Auth — creds are passed in per-run via env vars, never hardcoded or
  // persisted, since they're only relevant to whichever staging doc is
  // being validated against a not-yet-published update.
  const headers: Record<string, string> = {};
  if (process.env.STAGING_BASIC_AUTH_USER && process.env.STAGING_BASIC_AUTH_PASS) {
    const creds = Buffer.from(`${process.env.STAGING_BASIC_AUTH_USER}:${process.env.STAGING_BASIC_AUTH_PASS}`).toString("base64");
    headers.Authorization = `Basic ${creds}`;
  }
  const res = await fetch(`${url}.md`, { headers });
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
        // A bold-label-only line (e.g. "**Important Notes:**") marks the end
        // of the prerequisites bullet list — later bullets under it (like
        // "Only the latest version...") are notes, not prerequisites, even
        // though they share the same heading-level section.
        if (/^\*\*[A-Za-z].*\*\*:?\s*$/.test(l.trim())) break;
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
    if (/^options$/i.test(sectionName.trim())) {
      // Some docs put a bullet list ("* -n, --stack-name=x: description")
      // under an actual "## Options" heading rather than the flattened
      // table format — detect which shape this is and parse accordingly.
      options = isPipeTable(text)
        ? parsePipeTable(text)
        : /(^|\n)\s*[*-]\s+\\?`?-/.test(text)
          ? parseOptionsBulletList(text)
          : parseOptionsTable(text);
    }
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
    // Fences nested under numbered/bulleted list items are indented, and
    // sometimes the fence marker shares a line with the list marker itself
    // (e.g. "    1.  ```" — the ordinal and opening fence on one line, no
    // fence-only line at all). Match either shape so open/close toggling
    // can't desync. Content lines keep whatever indentation they have;
    // downstream consumers (classifyBlock, csdxLines) already trim per-line.
    if (/^\s*(?:\d+\.|[-*])?\s*```/.test(line)) {
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
          kind: classifyBlock(raw, lastLabel),
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
    // import-content-using-the-seed-command uses "-" bullets with the
    // flag names backtick-wrapped ("- `-r`, `--repo=repo`: ...") — every
    // other bullet-list doc so far uses a bare "*" bullet with no
    // backticks, which is why backticks weren't stripped before.
    const line = unescape(raw).trim().replace(/`/g, "");
    // migrate-content-from-html-rte-to-json-rte inserts "(optional)" between
    // the flag and the colon ("--yes (optional): ...") — every other doc's
    // bullet list puts the colon immediately after the flag/value.
    const m = line.match(/^[*-]\s+(?:(-\w),\s*)?(--[\w-]+)(?:=\S*)?\s*(?:\(optional\))?\s*:\s*(.*)$/);
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
  // A "Usage" section commonly shows the primary command, then a bare "or"
  // line, then a short-alias form ("csdx config:set:ea-header" for
  // "csdx config:set:early-access-header") — both run the same command, but
  // without this, the alias fence would win as currentCommand (last one
  // wins) and the Options that follow would get filed under the alias name
  // instead of the primary name used elsewhere (e.g. in docs.json/the flag
  // audit), making them invisible to the audit.
  let prevLineWasBareOr = false;

  while (i < lines.length) {
    const line = lines[i];

    const cmdLabel = line.match(/^\*\*Command:?\*\*:?\s*csdx\s+([\w:-]+)/);
    if (cmdLabel) {
      setCommand(cmdLabel[1]);
      i++;
      continue;
    }

    // Same fence-boundary shape as the main parse loop: indented, and
    // sometimes sharing a line with a list marker (e.g. "    1.  ```").
    if (/^\s*(?:\d+\.|[-*])?\s*```/.test(line)) {
      let j = i + 1;
      const buf: string[] = [];
      while (j < lines.length && !/^\s*(?:\d+\.|[-*])?\s*```/.test(lines[j])) {
        buf.push(lines[j]);
        j++;
      }
      const raw = buf.join("\n").trim();
      // Accept "csdx cm:xxx", a bare "cm:xxx" (a doc bug — missing the csdx
      // prefix — but still the command the Options table describes), and a
      // bare single-word command with no namespace colon at all (e.g.
      // `csdx launch`). setCommand() prefers a namespaced match over a bare
      // one, so this last alternative never overrides an already-tracked
      // "cm:xxx"/"auth:xxx"-style command.
      const cmdMatch = raw.match(/^(?:csdx\s+)?(cm:[\w:-]+|[\w-]+:[\w:-]+|[a-z][\w-]*)/);
      if (cmdMatch && !prevLineWasBareOr) setCommand(cmdMatch[1]);
      prevLineWasBareOr = false;
      i = j + 1;
      continue;
    }

    if (line.trim().toLowerCase() === "or") {
      prevLineWasBareOr = true;
      i++;
      continue;
    }
    if (line.trim()) prevLineWasBareOr = false;

    // Most docs bold this label ("**Options**"/"**Option:**"); at least one
    // (query-based-export) uses a completely unadorned "Options" line with
    // no bold markers and no markdown heading either. Some (bulk-operations)
    // split one command's flags across several headed sub-tables
    // ("#### Required Options", "#### Entry-Specific Options", "#### General
    // Options") instead of a single "Options" section — allow an optional
    // "#" heading marker and an optional word prefix before "Options" too,
    // so every sub-table gets merged under the same currentCommand instead
    // of only the first (or none) being recognized.
    if (/^#{0,6}\s*\*{0,2}(?:[A-Za-z][\w-]*\s+)*Options?:?\*{0,2}:?\s*$/.test(line.trim())) {
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
      const opts = isPipeTable(optionsText)
        ? parsePipeTable(optionsText)
        : /(^|\n)\s*[*-]\s+\\?`?-/.test(optionsText)
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

    // migrate-content-from-html-rte-to-json-rte's flagged-command Options
    // list has no introducing label at all — the flag bullets start right
    // after the code fence with nothing announcing them as "Options". If
    // this line itself already looks like a flag bullet (checked the same
    // way isPipeTable's sibling check does above) and we already have a
    // currentCommand, treat this as an implicit, unlabeled Options block.
    if (currentCommand && /^[*-]\s+\\?`?-/.test(line.trim())) {
      let j = i;
      const buf: string[] = [];
      while (j < lines.length && /^[*-]\s+/.test(lines[j].trim())) {
        buf.push(lines[j]);
        j++;
      }
      const opts = parseOptionsBulletList(buf.join("\n"));
      if (opts.length) {
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

/**
 * Placeholders substitute.ts knows how to replace with real values — a
 * block containing ONLY these (plus optionally `<alias>`) is a genuine
 * runnable example once substituted, not a bare Usage synopsis. Stored as
 * the complete bracketed token (not just the inner name), since docs use
 * inconsistent bracket styles — single `<x>`, double `<<x>>` — and
 * stripping only one layer would leave a residual `<>` that still looks
 * like an unhandled placeholder.
 */
const KNOWN_PLACEHOLDERS = [
  "<alias>",
  "<backup-dir-path-generated-by-import-setup>",
  "<content-dir-path>",
  "<exported-content-dir>",
  "<target-stack-api-key>",
  "<branch>",
  "<value>",
  "<<management token alias for source>>",
  "<<management token alias for destination>>",
  "<content_type_uid>",
  "<locale_code>",
  "<environment_name>",
  "<destination_environment_name>",
  "<source_environment_name>",
  "<stack_api_key>",
  "<api_key>",
  "<source_stack_api_key>",
  "<stack-api-key>",
  "<delivery_token>",
  "<base_entry_uid>",
  "<path/of/current/working/dir>",
  "<path/to/launch/config/file>",
  "<deployment UID>",
  "<org UID>",
  "<Project UID>",
  "<target-locale>",
  "<path-to-the-exported-data>",
  "<path-to-the-config-file>",
  "<app_name>",
  "<organization uid>",
  "<UID>",
  "<app_uid>",
  "<org_uid>",
  "<APP-UID-1>",
  "<INSTALLATION-UID-1>",
  "<file_path>",
  "<https://localhost:3000>",
  // apps-cli-plugin oddly wraps some LITERAL, already-valid option values in
  // angle brackets too ("--hosting-type <custom-hosting>") — not real
  // placeholders needing substitution, just stripped in substitute.ts.
  "<custom-hosting>",
  "<hosting-with-launch>",
  "<existing>",
  "<new>",
  "<stack_ApiKey>",
  "<path-to-examples>",
  "<target_stack_api_key>",
  "<region-name>",
  "<plugin-local-path>",
  "<plugin_name>",
  "<starter_app_name>",
  "<path_or_the_location_of_the_folder_to_clone_the_app>",
  "<The path or the location to clone the app>",
  "<organization_uid>",
  "<stack_name>",
  "<<starter-app-name>>",
];

function classifyBlock(raw: string, label = ""): BlockKind {
  const t = raw.trim();
  // Illustrative TS/JS source (a Command class, a test file) — checked
  // FIRST, before the "syntax" heuristic below: create-custom-cli-plugins'
  // "Complete Example" class has error-message strings that literally
  // contain "csdx login" / "csdx config:set:region <region>" (just
  // user-facing text, not real commands) — if the "syntax" check below ran
  // first, it'd see "csdx" + an unresolved "<region>" placeholder and
  // misclassify the whole TypeScript file as a csdx usage line to
  // existence-check, rather than the source code it actually is.
  if (/(^|\n)\s*(import\s.+from\s+['"]|export\s+(default\s+)?(class|function|const)|describe\(|module\.exports\s*=)/.test(t)) return "code";
  if (/\[OPTIONS\]/.test(t)) return "syntax";
  // A block is "syntax" (existence-check only, never executed) exactly
  // when it still has an unrecognized `<...>` placeholder after stripping
  // every KNOWN, substitutable one — no label-based special-casing needed:
  // every doc tested so far, the label alone was never what distinguished
  // a runnable example from an illustration; the placeholder set was.
  // The angle-bracket check itself is deliberately loose (`<[^>]*>` — any
  // content, including empty `<>` or space-containing `<<foo bar>>`) since
  // docs use inconsistent placeholder bracket styles.
  // Checked per LINE (after joining backslash continuations, so a single
  // logical command split across several lines is still treated as one),
  // not block-wide: create-custom-cli-plugins' "cd <plugin-directory>
  // \n csdx plugins:link" block has an unresolved placeholder on the "cd"
  // line but NOT on the real "csdx plugins:link" line — a block-wide check
  // misclassified the whole thing as an existence-check-only "syntax"
  // block, so "csdx plugins:link" was never actually run, only --help'd,
  // and the plugin was never really linked when later steps needed it.
  const merged = t.replace(/\\\n\s*/g, " ");
  const hasUnresolvedCsdxLine = merged.split("\n").some((line) => {
    if (!/csdx\s/.test(line)) return false;
    const strippedLine = KNOWN_PLACEHOLDERS.reduce((s, p) => s.split(p).join(""), line);
    return /<[^>]*>/.test(strippedLine);
  });
  if (hasUnresolvedCsdxLine) return "syntax";
  if (/^\s*\{/.test(t)) return "json";
  if (/(^|\n)\s*(\[\d{4}-|INFO:|SUCCESS:|C:\\Users\\[^ ]*>)/.test(t) || /█/.test(t)) return "output";
  if (/[├└│]/.test(t)) return "tree";
  if (/\$\{\{|^\s*-\s+name:|^\w[\w-]*:\s*$|^\s*script:/m.test(t) && /csdx/.test(t)) return "ci";
  if (/(^|\n)\s*(#.*\n\s*)?csdx\s/.test(t)) return "command";
  // Global npm install/update commands the CLI docs ask readers to run.
  if (/(^|\n)\s*npm\s+(install|update)\s+-g\s+@contentstack\/cli\b/.test(t)) return "command";
  // create-custom-cli-plugins' own plugin-development tooling — scaffolding
  // (oclif generate), building, linking, and navigating between the two.
  // Scoped to these specific, recognizable prefixes rather than any bare
  // npm/npx/node/cd line, to avoid reclassifying unrelated blocks in docs
  // that were never meant to run non-csdx shell commands.
  if (/(^|\n)\s*(npx\s+oclif\b|npm\s+(run|install|test|publish|start)\b|node\s+bin\/|cd\s+\S+|ls\s+\S+|cp\s+\S+)/.test(t)) return "command";
  return "unknown";
}

/** True when the text is a genuine pipe-delimited markdown table (`| a | b |`), not the flattened-paragraph layout `parseOptionsTable` expects. */
function isPipeTable(text: string): boolean {
  return /^\s*\|.*\|\s*$/m.test(text);
}

/**
 * Real `| Option | Description |` markdown table parser — export-content-
 * to-csv-file's doc renders its Options as an actual pipe table rather than
 * the flattened-paragraph-per-cell layout every other doc uses, which
 * `parseOptionsTable` can't parse at all (no blank lines to split rows on),
 * silently producing zero options and flagging every real CLI flag as
 * "missing-in-doc".
 */
function parsePipeTable(text: string): DocOption[] {
  // Descriptions like "[options: entries\|users\|teams]" escape their own
  // literal pipes — splitting the row on every "|" without excluding those
  // would fragment the description at the first escaped pipe.
  const PIPE_PLACEHOLDER = " ";
  const rows = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\|.*\|$/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .replace(/\\\|/g, PIPE_PLACEHOLDER)
        .split("|")
        .map((c) => c.trim().replace(new RegExp(PIPE_PLACEHOLDER, "g"), "|"))
    )
    .filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c))); // drop the "|---|---|" separator row

  const out: DocOption[] = [];
  for (const cells of rows) {
    const flagCell = unescape(cells[0] ?? "").replace(/`/g, "");
    if (!/^\\?-{1,2}\w/.test(flagCell)) continue; // header row ("Option | Description") or non-flag row
    // Cell can hold one flag ("--action=action") or both forms comma-separated ("-a`,`--alias=alias").
    const short = flagCell.match(/(?:^|,\s*)(-\w)\b/)?.[1];
    const flag = flagCell.match(/(--[\w-]+)/)?.[1];
    if (!flag) continue;
    out.push({
      short,
      flag,
      description: unescape(cells[1] ?? "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"),
      required: "",
    });
  }
  return out;
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

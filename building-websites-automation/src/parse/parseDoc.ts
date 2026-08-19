/**
 * STAGE 1 — PARSE
 *
 * Read a Kickstart doc and turn it into an ordered, classified list of DocSteps.
 *
 * We fetch the doc's own markdown (the "View as Markdown" / "Copy for LLM" output,
 * served at `<url>.md`) rather than scraping rendered HTML — it's clean and stable.
 *
 * The markdown shape (verified against the Nuxt kickstart):
 *   ---            YAML frontmatter (title, url, doc_type, last_updated)
 *   # Title
 *   ## Prerequisites          ← captured as a pseudo-step
 *   ## Project Setup          ← grouping header (skipped)
 *   ### 1. Clone the Repo      ← a numbered step
 *   ```                        ← code fence → commands
 *   ...
 */
import type { DocStep, KickstartConfig, StepKind } from "../types.js";

/**
 * Heuristic classifier — decides how a step must be executed.
 *
 * `raw` (the step's full original prose+code, before line-by-line command
 * filtering) matters here: a step can be all curl/TS source with no lines
 * that look like a *shell* command by themselves (e.g. `API_KEY="..."`, or a
 * bare `export default nextConfig;`), so `commands` alone under-detects it.
 */
export function classify(title: string, commands: string[], raw = ""): StepKind {
  const t = title.toLowerCase();
  const body = commands.join("\n").toLowerCase();
  const full = `${t} ${body} ${raw.toLowerCase()}`;

  if (/prerequisite/.test(t)) return "unknown";
  if (/settings|dashboard|token|live preview|org admin|toggle|create a new stack|create a stack\b|create environments?\b|import content types|create entries|create.*content type|create and publish an entry|deploy.*launch/.test(t)) return "dashboard";
  if (/\.env|environment variable|configure contentstack/.test(t)) return "env";
  if (/csdx\b/.test(body)) return "cli";
  if (/run your|run the app|npm run dev|npm start|localhost|open http/.test(t + " " + body)) return "verify";
  if (/git clone|npm install|cd |npx /.test(body)) return "shell";
  // A fenced shell/curl script whose individual lines don't each look like a
  // standalone shell command (var assignments feeding a multi-line curl call).
  // Curl must be INSIDE a fence — a fence earlier in the section followed by
  // unrelated prose that merely mentions "curl" must not match (e.g. this doc's
  // architecture-diagram section says "A working curl call confirms...").
  if (hasCurlInFence(raw)) return "shell";
  // The doc's "open/create <file> and add this code" pattern (fetch helper,
  // page component, config file) — verbatim file-write, not a command to run.
  // Checked against `raw`, not just the title/commands: the identifying prose
  // ("Open next.config.ts... and add") is often outside any fenced command.
  if (/(?:open|create(?:\s+a)?)\s+[\w./-]+\.(?:ts|tsx|js|jsx|json)\b/i.test(full)) return "file";
  return "unknown";
}

/** Fetch clean markdown for a doc by appending `.md` to its URL. */
export async function fetchDocMarkdown(docUrl: string): Promise<string> {
  const mdUrl = docUrl.replace(/\/+$/, "") + ".md";
  const res = await fetch(mdUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${mdUrl}: HTTP ${res.status}`);
  return res.text();
}

/** Strip YAML frontmatter, returning the body only. */
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n/);
  return m ? md.slice(m[0].length) : md;
}

/**
 * Split glued shell commands the doc's markdown export sometimes produces.
 * e.g. "...kickstart-nuxt.gitcd kickstart-nuxt" → ["git clone ...", "cd kickstart-nuxt"]
 */
function normalizeCommandLine(line: string): string[] {
  return line
    .split(/(?<=\S)(?=cd\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Env steps arrive as one concatenated blob (a markdown-export artifact), so we
 * can't split reliably by value. Instead extract the KEY *names* — that's what we
 * validate against config.envKeys and what the executor writes into `.env`.
 */
function extractEnvKeys(raw: string): string[] {
  const keys = raw.match(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?==)/g) ?? [];
  return [...new Set(keys)].map((k) => `${k}=`);
}

/** True when a fenced block (not merely surrounding prose) contains a curl call. */
function hasCurlInFence(raw: string): boolean {
  for (const m of raw.matchAll(/```[a-z]*\n([\s\S]*?)```/gi)) {
    if (/\bcurl\b/i.test(m[1])) return true;
  }
  return false;
}

/** True for fenced lines that are actual shell commands (not JS/TS source). */
function shellLike(line: string): boolean {
  // `export` only counts as shell-like in its bash form (`export NAME=value`)
  // — bare `export default ...` / `export function ...` is TS/JS source and
  // must NOT be swallowed into `commands` (a doc's file-write steps rely on
  // that prose staying out of the shell-command list).
  if (/^\s*export\s+[A-Z_][A-Z0-9_]*=/.test(line)) return true;
  return /^\s*(git|npm|npx|yarn|pnpm|cd|node|cp|mkdir|touch|mv|rm|csdx|nvm|code)\b/.test(line);
}

/**
 * True for a command appearing as bare list-item text OUTSIDE a fence — the doc
 * markdown export sometimes drops fences (e.g. sveltekit's `csdx auth:login`).
 * Must be the whole line (a pure command, not prose mentioning a command).
 */
function bareCommand(line: string): boolean {
  const t = line.trim();
  return /^(csdx|git clone|npm (install|run|ci|start)|npx|yarn|pnpm)\b/.test(t) && !/[.!?]$/.test(t) && t.split(/\s+/).length <= 12;
}

/**
 * Extract UI navigation labels the doc names as click-paths, e.g.
 * "go to **Settings** > **Tokens**" → ["Settings", "Tokens"], or
 * "Go to Org Admin > Info" → ["Org Admin", "Info"].
 * Only `>`-chained path segments count — bold words alone are prose, not paths.
 */
export function extractUiPathLabels(raw: string): string[] {
  const text = raw.replace(/\*\*/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const labels = new Set<string>();
  // Segments: 1–3 words, each starting with a capital, chained by ">".
  const SEG = "[A-Z][\\w-]*(?:\\s+[A-Z&][\\w-]*){0,2}";
  const re = new RegExp(`(${SEG})(?:\\s*>\\s*(${SEG}))+`, "g");
  for (const m of text.matchAll(re)) {
    // Re-split the full match on ">" to catch chains longer than two.
    for (const part of m[0].split(">")) {
      const s = part.trim();
      if (s && new RegExp(`^${SEG}$`).test(s)) labels.add(s);
    }
  }
  return [...labels];
}

/**
 * Split a doc into steps. Kickstart docs come in two templates:
 *  - numbered  — `### 1. Clone the Repository` (nuxt, next)
 *  - sections  — prose `## Clone the Project…` headings (react, angular, sveltekit, astro)
 * We detect which and parse accordingly.
 */
export function splitIntoSteps(body: string): DocStep[] {
  return /^###\s+\d+\.\s/m.test(body) ? splitNumbered(body) : splitSections(body);
}

/** Build a DocStep from an accumulated section. */
function makeStep(index: number, title: string, raw: string[], cmds: string[]): DocStep {
  const rawText = raw.join("\n").trim();
  const kind = classify(title, cmds, rawText);
  let commands = kind === "env" ? extractEnvKeys(rawText) : cmds.flatMap(normalizeCommandLine);
  // A fenced block that sets shell variables and then uses them (the curl
  // validation step's `NAME="value" ... curl ...` script) can't be split into
  // independent commands — each would run in its own subprocess and lose the
  // others' variables. Keep it as ONE multi-line command instead.
  if (kind === "shell" && hasCurlInFence(rawText) && !commands.some((c) => /^curl\b/.test(c))) {
    const fence = [...rawText.matchAll(/```[a-z]*\n([\s\S]*?)```/gi)].map((m) => m[1]).find((f) => /\bcurl\b/i.test(f));
    if (fence) commands = [fence.trim()];
  }
  return { index, title, kind, commands, raw: rawText };
}

/** Numbered template: a step opens on `### N.` or `## Prerequisites`; any heading closes it. */
function splitNumbered(body: string): DocStep[] {
  const steps: DocStep[] = [];
  let current: { title: string; raw: string[]; commands: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (current) steps.push(makeStep(steps.length, current.title, current.raw, current.commands));
    current = null;
  };

  for (const line of body.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      // Keep the fence delimiter itself in `raw` — downstream code (the file-
      // write step handler, the curl multi-line-script detector) needs to find
      // ```-fenced code inside a step's raw text, not just its filtered commands.
      current?.raw.push(line);
      continue;
    }
    if (!inFence && /^#{2,6}\s/.test(line)) {
      const numbered = line.match(/^###\s+\d+\.\s+(.*)/);
      const prereq = line.match(/^##\s+Prerequisites\b/i);
      flush();
      if (numbered || prereq) current = { title: numbered ? numbered[1].trim() : "Prerequisites", raw: [], commands: [] };
      continue;
    }
    if (!current) continue;
    current.raw.push(line);
    if ((inFence && shellLike(line)) || (!inFence && bareCommand(line))) current.commands.push(line.trim());
  }
  flush();
  return steps;
}

/**
 * Sections template: each level-2 `##` heading is a section. Keep only actionable
 * ones (has shell commands, a non-"unknown" kind, or is Prerequisites) — this drops
 * prose sections like "Introduction" / "Understand the Codebase".
 */
function splitSections(body: string): DocStep[] {
  const steps: DocStep[] = [];
  let current: { title: string; raw: string[]; commands: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    const step = makeStep(steps.length, current.title, current.raw, current.commands);
    const isQuestion = /\?\s*$/.test(step.title);
    const actionable = !isQuestion && (step.commands.length > 0 || step.kind !== "unknown" || /prerequisite/i.test(step.title));
    if (actionable) steps.push(step);
    current = null;
  };

  for (const line of body.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      // Keep the fence delimiter in `raw` — see the matching comment in splitNumbered.
      current?.raw.push(line);
      continue;
    }
    // Building-Websites docs use both ## sections and ### sub-steps as actionable units.
    if (!inFence && /^#{2,3}\s/.test(line)) {
      flush();
      current = { title: line.replace(/^#{2,3}\s+/, "").trim(), raw: [], commands: [] };
      continue;
    }
    if (!current) continue;
    current.raw.push(line);
    if ((inFence && shellLike(line)) || (!inFence && bareCommand(line))) current.commands.push(line.trim());
  }
  flush();
  return steps;
}

export async function parseDoc(docUrl: string): Promise<DocStep[]> {
  const md = await fetchDocMarkdown(docUrl);
  return splitIntoSteps(stripFrontmatter(md));
}

/** A code block the doc presents as the contents of a specific project file. */
export interface DocSnippet {
  file: string;
  code: string;
}

/** Everything we cross-check a doc against, parsed in one fetch. */
export interface ParsedDoc {
  steps: DocStep[];
  /** File/dir names listed under a "Project Structure" block. */
  structure: string[];
  /** Code snippets labelled "File name: <path>". */
  snippets: DocSnippet[];
}

export async function parseDocFull(docUrl: string): Promise<ParsedDoc> {
  const md = await fetchDocMarkdown(docUrl);
  return {
    steps: splitIntoSteps(stripFrontmatter(md)),
    structure: extractProjectStructure(md),
    snippets: extractCodeSnippets(md),
  };
}

/** Pull the file/dir names from a "Project Structure" fenced block. */
export function extractProjectStructure(md: string): string[] {
  const start = md.search(/project structure/i);
  if (start < 0) return [];
  const fence = md.slice(start).match(/```[\s\S]*?```/);
  if (!fence) return [];
  const names = new Set<string>();
  for (const rawLine of fence[0].split("\n")) {
    // Trees may carry inline comments ("├── .github/   # CI and repository
    // metadata") — strip them so we match the filename, not the comment's tail.
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    // Two tree formats appear: bullets ("- 📁 composables/") and box-drawing
    // ("├── src/", "│   └── contentstack.ts"). Require a leading marker so the
    // unmarked root label (e.g. "kickstart-react/") is skipped, then take the
    // trailing filename token.
    const hasMarker = /^\s*(?:[│├└─]|[-*]|📁|📄)/.test(line);
    // `+` included for SvelteKit route files (+page.svelte, +layout.svelte).
    const m = line.match(/([+\w.\-]+\/?)\s*$/);
    if (hasMarker && m && /[.\w]/.test(m[1]) && m[1] !== "-") names.add(m[1].trim());
  }
  return [...names];
}

/** Pull code snippets the doc labels with "File name: <path>". */
export function extractCodeSnippets(md: string): DocSnippet[] {
  const out: DocSnippet[] = [];
  // Filename may be wrapped in markdown bold/backticks: "File name: **plugins/x.ts**".
  const labelRe = /File name:\s*[*`]*\s*([\w./-]+)\s*[*`]*/gi;
  const labels = [...md.matchAll(labelRe)];

  for (let i = 0; i < labels.length; i++) {
    const start = labels[i].index! + labels[i][0].length;
    const rest = md.slice(start);
    // Bound the search to this snippet's own section: stop at the next "File name:"
    // or the next heading. A label with no fence in its section = no code shown.
    const stops = [rest.search(/File name:/i), rest.search(/\n#{2,3}\s/)].filter((x) => x >= 0);
    const end = stops.length ? Math.min(...stops) : rest.length;
    const fence = rest.slice(0, end).match(/```[a-z]*\n([\s\S]*?)```/);
    if (fence) out.push({ file: labels[i][1].trim(), code: fence[1].trim() });
  }
  return out;
}

/**
 * Fill missing config fields from what the doc itself contains — repo (from the
 * `git clone` command), env var names (from the env step), port (from a
 * `localhost:PORT` mention), and a default stack name. Explicit config wins.
 */
export function deriveFromDoc(steps: DocStep[], cfg: KickstartConfig): KickstartConfig {
  const allCmds = steps.flatMap((s) => s.commands);
  const allText = steps.map((s) => `${s.raw}\n${s.commands.join("\n")}`).join("\n");

  const repo =
    cfg.repo ?? allCmds.map((c) => c.match(/git clone\s+(\S+)/)?.[1]).find(Boolean);
  const envKeys =
    cfg.envKeys ??
    steps.find((s) => s.kind === "env")?.commands.map((c) => c.replace(/=$/, "")) ??
    [];
  const port = cfg.port ?? Number(allText.match(/localhost:(\d{2,5})/)?.[1] ?? 3000);
  const stackName = cfg.stackName ?? `CS Kickstart ${cfg.name}`;

  // The command that starts the dev server (frameworks differ: dev / start / serve).
  const runCommand =
    cfg.runCommand ??
    [...allCmds].reverse().find((c) => /^(npm (run )?(dev|start|develop|serve)|ng serve|yarn (dev|start)|pnpm (dev|start))\b/.test(c)) ??
    "npm run dev";

  return { ...cfg, repo, envKeys, port, stackName, runCommand };
}

// Allow `npm run parse -- <docUrl>` for quick inspection.
const invokedDirectly = process.argv[1]?.endsWith("parseDoc.ts");
if (invokedDirectly) {
  const url = process.argv[2] ?? "https://www.contentstack.com/docs/headless-cms/nuxt";
  parseDoc(url).then((steps) => {
    for (const s of steps) {
      console.log(`\n#${s.index} [${s.kind}] ${s.title}`);
      for (const c of s.commands) console.log(`    $ ${c}`);
    }
    console.log(`\n${steps.length} steps parsed from ${url}`);
  });
}

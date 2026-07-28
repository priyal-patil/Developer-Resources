/**
 * Fetches an SDK reference doc as markdown (`<url>.md`) and extracts every
 * documented method/property with its description and code block(s).
 *
 * The page's heading structure doesn't nest depth-wise (everything is a
 * flat run of "## " headings), so section boundaries have to be inferred:
 * every real left-nav module (Stack, Asset, Entry, ...) is introduced by a
 * plain "## <Name>" heading that comes IMMEDIATELY after a divider heading
 * of the form "<PrevName> | ... | Contentstack" (which itself just closes
 * the previous module and carries no methods of its own). A plain heading
 * that repeats a module name *mid-section* (e.g. "## Asset" appears once as
 * a one-line teaser inside "Stack" pointing at `stack.asset()`, well before
 * the real "Asset" module starts) is NOT immediately after a divider, so it
 * stays filed as an ordinary method of the enclosing section instead of
 * incorrectly starting a new one.
 *
 * One doc-specific exception: the "Asset" and "Asset Collection" modules
 * share a single trailing divider (the .md export doesn't insert one
 * between them), so a plain heading ending in " Collection" is treated as
 * a secondary split point even when it's mid-section.
 */
import "dotenv/config";
import type { MethodEntry, ParsedDoc } from "../types.js";

export async function fetchDocMarkdown(url: string): Promise<string> {
  const res = await fetch(`${url}.md`);
  if (!res.ok) throw new Error(`Failed to fetch ${url}.md: HTTP ${res.status}`);
  return res.text();
}

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

interface RawHeading {
  text: string;
  isDivider: boolean;
  body: string[]; // non-fence lines
  codeBlocks: string[];
}

const DIVIDER_RE = /^(.+?)\s*\|\s*.+\s*\|\s*Contentstack$/;

function collectHeadings(body: string): RawHeading[] {
  const lines = body.split("\n");
  const headings: RawHeading[] = [];
  let current: RawHeading | null = null;
  let inFence = false;
  let fenceBuf: string[] = [];

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (!inFence) {
        inFence = true;
        fenceBuf = [];
      } else {
        inFence = false;
        current?.codeBlocks.push(fenceBuf.join("\n").trim());
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }
    const h = line.match(/^##\s+(.*)/);
    if (h) {
      const text = h[1].trim();
      const divider = text.match(DIVIDER_RE);
      current = { text: divider ? divider[1].trim() : text, isDivider: !!divider, body: [], codeBlocks: [] };
      headings.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return headings;
}

export function parseDoc(name: string, md: string): ParsedDoc {
  const { front, body } = splitFrontmatter(md);
  const headings = collectHeadings(body);

  const navSections: string[] = [];
  const methods: MethodEntry[] = [];

  // The page's outermost heading repeats the doc title, then "Overview" -
  // both belong to the "Overview" nav item, not a section named after the
  // title.
  let currentSection = "Overview";
  navSections.push(currentSection);
  let prevWasDivider = false;

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h.isDivider) {
      prevWasDivider = true;
      continue;
    }
    const startsNewSection =
      i > 1 && (prevWasDivider || (h.text.endsWith(" Collection") && h.text !== currentSection));
    prevWasDivider = false;

    if (startsNewSection) {
      currentSection = h.text;
      if (!navSections.includes(currentSection)) navSections.push(currentSection);
      continue; // the module heading itself names the section; it isn't a method
    }

    methods.push({
      id: methods.length,
      navSection: currentSection,
      method: h.text,
      description: h.body.join(" ").replace(/\s+/g, " ").trim(),
      codeBlocks: h.codeBlocks,
    });
  }

  return {
    name,
    title: front.title ?? name,
    url: front.url ?? "",
    lastUpdated: front.last_updated,
    navSections,
    methods,
  };
}

// CLI entry: `npm run parse -- <name> <url>` prints the parse result.
if (process.argv[1]?.endsWith("parseDoc.ts")) {
  const [
    name = "content-delivery-sdk-typescript-reference",
    url = "https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/typescript/reference",
  ] = process.argv.slice(2);
  const md = await fetchDocMarkdown(url);
  const doc = parseDoc(name, md);
  console.log(JSON.stringify(doc, null, 2));
}

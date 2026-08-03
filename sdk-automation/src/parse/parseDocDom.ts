/**
 * Scrapes the SDK reference doc from the RENDERED page via a headless
 * browser, instead of the `<url>.md` export parseDoc.ts used.
 *
 * The `.md`/LLM-export endpoint flattens the page's separate per-example
 * code-tab widgets into one text blob per section, losing every line break
 * between them - confirmed by checking the live page directly: `sync`,
 * `ImageTransform`'s multi-example methods, `assetFields`, etc. are all
 * cleanly formatted there, with each example in its own widget and all
 * prose properly outside the code. That's a bug in Contentstack's
 * docs-site markdown export generator, not something worth working around
 * with more parsing heuristics - scraping the real DOM sidesteps it
 * entirely and is architecturally simpler besides: each left-nav item
 * turns out to be its own dedicated page (e.g. `/reference/stack`), so
 * there's no need to guess section boundaries the way parseDoc.ts had to
 * for the single flattened `.md` file.
 *
 * Each widget defaults to showing the TypeScript variant already (the
 * page is scoped via "Language: TypeScript" in the breadcrumb), confirmed
 * by the Asset page's default-rendered code containing TS-only syntax
 * (`interface BlogAsset extends BaseAsset`) - no need to interact with the
 * per-widget language dropdown.
 *
 * Only the FIRST code widget under each heading is kept (same "run just
 * one documented variant" policy as the old parser's codeBlocks[0] usage) -
 * except here every variant is already a separate clean widget, so this
 * never risks grabbing a corrupted multi-variant blob.
 */
import { chromium, type Page } from "playwright";
import type { MethodEntry, ParsedDoc } from "../types.js";

/**
 * "networkidle" occasionally hangs past Playwright's 30s default (some
 * background request - analytics, a chat widget poll - never fully
 * settles), even though the actual article content is ready almost
 * immediately. Wait for the article container itself instead, with one
 * retry on timeout rather than failing the whole scrape over a page that
 * did load.
 */
async function gotoAndWaitForArticle(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForSelector(".docs-redesign-article", { timeout: 15_000 });
      return;
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
}

/**
 * Extracts every method entry (per h2/h3 heading, in document order) from
 * whatever page is currently loaded. Used both for each nav-link's own
 * sub-page (the normal case for Delivery/Management/Marketplace and most of
 * the App SDK doc's sections) and as a fallback: the App SDK doc's
 * "ContentstackAppSDK" nav link 404s (confirmed live - it redirects to a
 * broken URL missing the `/docs` prefix, a real bug in the docs site's own
 * nav, unrelated to the SDK/doc content) - that section's content is
 * instead recovered from the ROOT page, which happens to already include it
 * (the root `/reference` page's own body covers the Overview/Quickstart/
 * ContentstackAppSDK-class content directly, unlike Delivery/Management/
 * Marketplace's root pages which are just an intro with no code).
 */
const GROUP_LABELS = new Set(["Properties", "Methods", "Events"]);

/**
 * Single linear document-order walk (TreeWalker) of the whole article,
 * bucketing text/code content by "most recent heading seen" - replaces an
 * earlier per-heading `wrapper.nextElementSibling` chain-walk that assumed
 * each heading's own content sat in flat sibling elements immediately after
 * it. That assumption broke on the App SDK doc's "App SDK Core Objects"
 * page: at h4/h5 depth, `heading.closest(".group")` matches a much higher
 * ancestor container (shared with several OTHER headings, since the actual
 * per-method wrapper markup doesn't repeat that class at every depth), so
 * `.nextElementSibling` from there skips over/misses the method's own code
 * widget entirely - confirmed live (every h4/h5 heading returned an empty
 * code block under the old approach). A single flat walk sidesteps
 * needing to reason about wrapper/sibling structure at all: whichever
 * heading was most recently encountered owns everything until the next
 * heading, regardless of nesting depth.
 */
async function extractMethodsFromCurrentPage(page: Page): Promise<{ method: string; description: string; code: string; tag: string }[]> {
  return page.evaluate(() => {
    const article = document.querySelector(".docs-redesign-article");
    if (!article) return [];

    const HEADING_TAGS = new Set(["H2", "H3", "H4", "H5"]);
    const results: { method: string; description: string; code: string; tag: string }[] = [];
    let current: { method: string; tag: string; parts: string[]; firstCode: string; exampleCode: string; sawExampleLabel: boolean } | null = null;

    // Inlined at both call sites rather than a nested `function flush()` -
    // esbuild instruments nested function declarations inside
    // page.evaluate() with a `__name()` helper call that doesn't exist in
    // the browser sandbox, throwing ReferenceError (same issue documented
    // elsewhere in this file re: recursive DOM walks).
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.currentNode;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (HEADING_TAGS.has(el.tagName)) {
          if (current) {
            results.push({
              method: current.method,
              description: current.parts.filter(Boolean).join(" "),
              code: current.exampleCode || current.firstCode,
              tag: current.tag,
            });
          }
          current = { method: el.textContent?.trim() ?? "", tag: el.tagName, parts: [], firstCode: "", exampleCode: "", sawExampleLabel: false };
        } else if (el.tagName === "PRE" && current) {
          const code = (el.textContent ?? "").trim();
          if (!current.firstCode) current.firstCode = code;
          if (current.sawExampleLabel && !current.exampleCode) current.exampleCode = code;
        }
      } else if (node.nodeType === Node.TEXT_NODE && current) {
        // Skip text inside a PRE (already captured whole above) and inside
        // any heading itself (already captured as `method` above).
        const parentTag = node.parentElement?.tagName;
        if (parentTag !== "PRE" && !HEADING_TAGS.has(parentTag ?? "")) {
          const t = node.textContent?.trim();
          if (t) {
            current.parts.push(t);
            if (/^Example\s*\d*:?$/i.test(t)) current.sawExampleLabel = true;
          }
        }
      }
      node = walker.nextNode();
    }
    if (current) {
      results.push({
        method: current.method,
        description: current.parts.filter(Boolean).join(" "),
        code: current.exampleCode || current.firstCode,
        tag: current.tag,
      });
    }
    return results;
  });
}

/**
 * Pulls just one H2 section's own entries (itself + nested H3s, stopping at
 * the next H2) out of a full-page heading list already extracted via
 * `extractMethodsFromCurrentPage` - used for the root-page fallback when a
 * section's own sub-page link is broken.
 */
function sliceSection(scraped: { method: string; description: string; code: string; tag: string }[], sectionName: string) {
  const startIdx = scraped.findIndex((m) => m.tag === "H2" && m.method === sectionName);
  if (startIdx === -1) return [];
  const rest = scraped.slice(startIdx + 1);
  const nextH2Idx = rest.findIndex((m) => m.tag === "H2");
  const body = nextH2Idx === -1 ? rest : rest.slice(0, nextH2Idx);
  return [scraped[startIdx], ...body];
}

export async function scrapeDoc(name: string, rootUrl: string): Promise<ParsedDoc> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await gotoAndWaitForArticle(page, rootUrl);

    const basePath = new URL(rootUrl).pathname;
    // The sidebar nav hydrates client-side separately from the article
    // body - waitForSelector(article) above doesn't guarantee its links
    // exist yet, so wait for at least one directly before collecting them.
    await page.waitForSelector(`a[href^="${basePath}/"]`, { timeout: 15_000 });
    const sectionLinks: { name: string; url: string }[] = await page.evaluate((basePath) => {
      const seen = new Set<string>();
      const out: { name: string; url: string }[] = [];
      for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[href^="${basePath}"]`)) {
        const href = a.getAttribute("href") ?? "";
        // Only real sub-pages (e.g. `${basePath}/stack`), not the ".md"
        // "View as Markdown" button whose href is `${basePath}.md` - a
        // prefix match on basePath alone would wrongly include it since
        // there's no "/" separator before ".md".
        if (seen.has(href) || !href.startsWith(`${basePath}/`)) continue;
        seen.add(href);
        const text = a.textContent?.trim();
        if (text) out.push({ name: text, url: href });
      }
      return out;
    }, basePath);

    const navSections: string[] = ["Overview"];
    const methods: MethodEntry[] = [];
    let rootPageScraped: Awaited<ReturnType<typeof extractMethodsFromCurrentPage>> | undefined;

    for (const { name: sectionName, url: sectionPath } of sectionLinks) {
      navSections.push(sectionName);

      let scraped: Awaited<ReturnType<typeof extractMethodsFromCurrentPage>>;
      try {
        await gotoAndWaitForArticle(page, new URL(sectionPath, rootUrl).toString());
        scraped = await extractMethodsFromCurrentPage(page);
      } catch {
        // A broken nav link (confirmed on the App SDK doc's
        // "ContentstackAppSDK" section - it 404s via a site-routing bug) -
        // recover from the root page's own content instead of losing the
        // section entirely. Re-navigate back to root if we'd wandered off
        // it trying the broken link.
        if (!rootPageScraped) {
          await gotoAndWaitForArticle(page, rootUrl);
          rootPageScraped = await extractMethodsFromCurrentPage(page);
        }
        scraped = sliceSection(rootPageScraped, sectionName);
      }

      for (const m of scraped) {
        // Pure grouping labels ("Properties"/"Methods"/"Events" - the App
        // SDK doc's h3/h4 subheadings used purely to visually group members,
        // confirmed to carry no code of their own) aren't real methods.
        if (!m.method || GROUP_LABELS.has(m.method)) continue;
        methods.push({
          id: methods.length,
          navSection: sectionName,
          method: m.method,
          description: m.description,
          codeBlocks: m.code ? [m.code] : [],
        });
      }
    }

    return { name, title: name, url: rootUrl, navSections, methods };
  } finally {
    await browser.close();
  }
}

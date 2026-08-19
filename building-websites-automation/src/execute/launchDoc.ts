/**
 * Doc-specific execution for "Build and Deploy a Website with Contentstack and
 * Launch" — the pieces that don't fit the first doc's UI-import/generic-shell
 * flows: the Homepage content type (Group + Modular Blocks), its entry, and
 * writing the doc's labelled code blocks (next.config.ts, lib/contentstack.ts,
 * app/page.tsx) verbatim into the scaffolded Next.js app.
 *
 * Content type + entry go through the Management API (like entries.ts for the
 * first doc) — the doc's own steps are dashboard clicks, but the values are
 * exact regardless of mechanism, and this avoids hand-rolling a content-type
 * builder in Playwright.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocStep, ExecContext } from "../types.js";
import { createContentType, createEntry, publishEntry } from "../api/contentstack.js";

const HOMEPAGE_SCHEMA = {
  title: "Homepage",
  uid: "homepage",
  schema: [
    { display_name: "Title", uid: "title", data_type: "text", mandatory: true, unique: false, field_metadata: { _default: true } },
    {
      display_name: "SEO", uid: "seo", data_type: "group", field_metadata: {},
      schema: [
        { display_name: "Meta Title", uid: "meta_title", data_type: "text", field_metadata: { _default: true } },
        { display_name: "Meta Description", uid: "meta_description", data_type: "text", field_metadata: { multiline: true, _default: true } },
        { display_name: "OG Title", uid: "og_title", data_type: "text", field_metadata: { _default: true } },
        { display_name: "OG Description", uid: "og_description", data_type: "text", field_metadata: { multiline: true, _default: true } },
        { display_name: "OG Image", uid: "og_image", data_type: "file" },
      ],
    },
    {
      display_name: "Sections", uid: "sections", data_type: "blocks", field_metadata: {}, multiple: true,
      blocks: [
        {
          title: "Hero", uid: "hero",
          schema: [
            { display_name: "Headline", uid: "headline", data_type: "text", field_metadata: { _default: true } },
            { display_name: "Description", uid: "description", data_type: "text", field_metadata: { multiline: true, _default: true } },
            { display_name: "Primary CTA Text", uid: "primary_cta_text", data_type: "text", field_metadata: { _default: true } },
            { display_name: "Primary CTA URL", uid: "primary_cta_url", data_type: "text", field_metadata: { _default: true } },
          ],
        },
        {
          title: "Features", uid: "features",
          schema: [
            {
              display_name: "Features", uid: "features", data_type: "group", multiple: true,
              schema: [
                { display_name: "Title", uid: "title", data_type: "text", field_metadata: { _default: true } },
                { display_name: "Description", uid: "description", data_type: "text", field_metadata: { multiline: true, _default: true } },
                { display_name: "Icon", uid: "icon", data_type: "file" },
              ],
            },
          ],
        },
      ],
    },
  ],
  // NOT is_page/singleton: an earlier manual run found `is_page: true` requires a
  // `url` field the doc never asks for (CMA error 115) — singleton alone matches
  // the doc's "Type: Single" instruction without that side effect.
  options: { is_page: false, singleton: true },
};

/** "2.4 Create the Homepage Content Type" — doc's exact schema, via Management API. */
export async function createHomepageContentType(ctx: ExecContext): Promise<{ ok: boolean; detail: string }> {
  if (!ctx.stackApiKey) return { ok: false, detail: "no stack to create the content type in" };
  try {
    const uid = await createContentType(ctx.stackApiKey, HOMEPAGE_SCHEMA);
    ctx.contentTypeUid = uid;
    return { ok: true, detail: `[api] content type "${uid}" created (title, seo group, sections modular blocks) per the doc's exact field list` };
  } catch (err) {
    return { ok: false, detail: `[api] content type creation failed: ${(err as Error).message}` };
  }
}

/** "2.5 Create and Publish an Entry" — a representative Homepage entry, published. */
export async function createHomepageEntry(ctx: ExecContext): Promise<{ ok: boolean; detail: string }> {
  const apiKey = ctx.stackApiKey;
  const contentTypeUid = ctx.contentTypeUid ?? "homepage";
  const env = ctx.environment ?? "staging";
  if (!apiKey) return { ok: false, detail: "no stack to create the entry in" };
  try {
    const uid = await createEntry(apiKey, contentTypeUid, {
      title: "My Company Website",
      seo: {
        meta_title: "My Company Website",
        meta_description: "A homepage seeded by building-websites-automation.",
        og_title: "My Company Website",
        og_description: "A homepage seeded by building-websites-automation.",
      },
      sections: [
        { hero: { headline: "Welcome to My Company", description: "Building great things.", primary_cta_text: "Learn More", primary_cta_url: "/about" } },
      ],
    });
    await publishEntry(apiKey, contentTypeUid, uid, env);
    ctx.entryUid = uid;
    return { ok: true, detail: `[api] entry "${uid}" created ("My Company Website") and published to ${env}` };
  } catch (err) {
    return { ok: false, detail: `[api] entry creation failed: ${(err as Error).message}` };
  }
}

/** Pull the fenced code block out of a step's raw markdown (first fence found). */
function extractFence(raw: string): string | null {
  const m = raw.match(/```[a-z]*\n([\s\S]*?)```/i);
  return m ? m[1].trimEnd() + "\n" : null;
}

/**
 * "file" steps: the doc says "Open <path> and add the following" / "Create a
 * <path> file...", followed by one fenced code block — write it verbatim.
 * Verbatim by design: if the doc's snippet doesn't compile, that's a doc gap
 * to report, not something to silently correct.
 */
export function writeDocFile(step: DocStep, ctx: ExecContext): { ok: boolean; detail: string } {
  const path = step.raw.match(/(?:Open|Create(?:\s+a)?)\s+([\w./-]+\.[\w]+)\b/i)?.[1]
    ?? step.title.match(/([\w./-]+\.[\w]+)\b/)?.[1];
  if (!path) return { ok: false, detail: "GAP: could not find a target file path in this step's prose" };
  const code = extractFence(step.raw);
  if (!code) return { ok: false, detail: `GAP: no fenced code block found for ${path}` };
  const full = join(ctx.cwd, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, code);
  return { ok: true, detail: `wrote the doc's exact code block to ${path} (${code.length} bytes)` };
}

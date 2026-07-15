/**
 * "Create Entries" — performs the doc's entry-creation step with the doc's EXACT
 * content values (titles, links, copy, asset files), publishing each to the
 * doc's "development" environment with references.
 *
 * Method note (reported transparently): entries are created via the Management
 * API rather than the entry-editor UI — the values are verbatim from the doc;
 * only the mechanics differ. Includes the doc's own workaround for its
 * acknowledged bug: "The URL for the Home page will be empty after publishing.
 * So you need to update the URL with '/' and publish again."
 */
import { join } from "node:path";
import type { ExecContext } from "../types.js";
import {
  uploadAsset, publishAsset, createEntry, getEntry, updateEntry, publishEntry,
} from "../api/contentstack.js";

const NAV_LINKS = [
  { title: "Home", href: "/" },
  { title: "Menu", href: "/menu" },
  { title: "About us", href: "/about-us" },
  { title: "Contact", href: "/contact" },
];

export async function createDocEntries(
  ctx: ExecContext
): Promise<{ ok: boolean; detail: string }> {
  const apiKey = ctx.stackApiKey;
  const env = ctx.environment ?? "development";
  if (!apiKey) return { ok: false, detail: "no stack to create entries in" };

  const assetsDir = join(ctx.cwd, "Stack Data", "Assets");
  const log: string[] = [];
  try {
    // --- Assets the doc instructs uploading (published so references resolve) ---
    const headerLogo = await uploadAsset(apiKey, join(assetsDir, "Header", "Header Logo.png"), "Header Logo");
    const footerLogo = await uploadAsset(apiKey, join(assetsDir, "Footer", "Footer Logo.png"), "Footer Logo");
    const banner = await uploadAsset(apiKey, join(assetsDir, "Page - Home", "Banner.jpeg"), "Banner");
    for (const a of [headerLogo, footerLogo, banner]) await publishAsset(apiKey, a, env);
    log.push("uploaded + published 3 assets (Header Logo, Footer Logo, Banner) as the doc instructs");

    // --- Header entry (doc's exact values) ---
    const headerUid = await createEntry(apiKey, "header", {
      title: "Header",
      logo: headerLogo,
      navigation_links: { link: NAV_LINKS },
    });
    await publishEntry(apiKey, "header", headerUid, env);
    log.push('entry "Header" created + published to development');

    // --- Footer entry (doc's exact values; note the schema's "descrption" typo) ---
    const footerUid = await createEntry(apiKey, "footer", {
      title: "Footer",
      navigation_links: { title: "Links", link: NAV_LINKS },
      information_section: {
        logo: footerLogo,
        descrption: "At PlateStack, we’ve got great food and a better experience.",
        timings: "Tue - Sun ( 16:00 - 22:00 )",
        holiday: "Closed on Monday",
      },
      copyright: "Copyright © PlateStack 2024. All rights reserved.",
    });
    await publishEntry(apiKey, "footer", footerUid, env);
    log.push('entry "Footer" created + published to development');

    // --- Page "Home" entry (doc's exact values) ---
    const pageUid = await createEntry(apiKey, "page", {
      title: "Home",
      url: "/",
      sections: [
        {
          home: {
            hero_section: {
              banner,
              heading: "Journey into flavor",
              description:
                "Indulge in a gastronomic journey where every dish is a culinary masterpiece, crafted with ultra precision.",
              primary_cta: "/menu",
            },
          },
        },
      ],
    });
    await publishEntry(apiKey, "page", pageUid, env);
    log.push('entry "Home" (Page) created + published to development');

    // --- The doc's own bug workaround: verify the URL survived publishing ---
    const after = await getEntry(apiKey, "page", pageUid);
    if (!after.url) {
      await updateEntry(apiKey, "page", pageUid, { url: "/" });
      await publishEntry(apiKey, "page", pageUid, env);
      log.push('doc-acknowledged bug reproduced: Page URL was empty after publish — re-set to "/" and republished (the doc’s stated workaround)');
    } else {
      log.push(`doc’s "URL empty after publishing" bug did NOT reproduce (url="${after.url}") — the workaround note in the doc may be stale`);
    }

    return { ok: true, detail: log.join("\n") };
  } catch (err) {
    log.push(`FAILED: ${(err as Error).message}`);
    return { ok: false, detail: log.join("\n") };
  }
}

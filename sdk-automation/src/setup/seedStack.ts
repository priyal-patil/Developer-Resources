/**
 * Creates (or reuses) a persistent stack for sdk-automation and seeds just
 * enough real content to exercise the TypeScript Delivery SDK reference doc:
 * a content type with entries (Stack/ContentType/ContentType Collection/
 * Entry/Query/Pagination sections), an asset (Asset/Asset Collection), a
 * taxonomy + term (Taxonomy), an environment + delivery token.
 *
 * Unlike cli-automation's seed (torn down every run), this stack is meant to
 * persist across runs — these are read-heavy SDK calls, not disposable
 * export/import operations. Re-running this script is idempotent: it finds
 * the existing stack by name and skips content-type/entry/environment
 * creation that already exists (relying on 409s from the API).
 *
 * The taxonomy/term UIDs are seeded to literally match the doc's own dummy
 * values ("taxonomies.one" / "term_one") rather than a project-specific
 * name — same "make real values equal the doc's dummy values" trick
 * cli-automation uses, so Taxonomy section snippets run unmodified. The
 * taxonomy is also wired into blog_post's schema as a taxonomy field and
 * both entries are tagged with the term (confirmed present via the
 * Management API's GET /taxonomies/one/terms).
 *
 * Even with all of that in place, `Taxonomy > equalAndBelow` still 404s
 * with "errors.term.not_found" from the real Delivery API - reproduced with
 * a raw fetch to /v3/taxonomies/entries using the exact query shape the
 * SDK's own where() builds ({"taxonomies.one": {"$eq_below": "term_one",
 * levels: 1}}), so this isn't a harness or seeding bug. Left unresolved
 * pending a look from someone who knows whether the doc's "taxonomies.one"
 * field-key convention is still correct against the current Delivery API.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  findStackByName,
  createStack,
  createContentType,
  createEntry,
  listEntries,
  publishEntry,
  createEnvironment,
  createDeliveryToken,
  uploadAsset,
  publishAsset,
  createTaxonomy,
  createGlobalField,
  addTaxonomyField,
  tagEntryTaxonomy,
} from "./contentstack.js";

const STACK_NAME = "SDK Automation - TypeScript Delivery";
const CONTENT_TYPE_UID = "blog_post";
const ENVIRONMENT = process.env.ENVIRONMENT || "production";
const ENV_PATH = new URL("../../.env", import.meta.url).pathname;

function updateEnvFile(updates: Record<string, string>) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text += `${text.endsWith("\n") || text === "" ? "" : "\n"}${key}=${value}\n`;
  }
  writeFileSync(ENV_PATH, text);
}

async function main() {
  console.log(`[seed] Looking for existing stack "${STACK_NAME}"...`);
  let stack = await findStackByName(STACK_NAME);
  if (!stack) {
    console.log("[seed] Not found - creating a new stack.");
    stack = await createStack(STACK_NAME);
  }
  const apiKey = stack.apiKey;
  // Runs land in a public repo's logs — mask the key so Actions redacts it here
  // and in anything logged downstream.
  if (process.env.CI) console.log(`::add-mask::${apiKey}`);
  console.log(`[seed] Stack API key: ${apiKey}`);

  console.log(`[seed] Ensuring content type "${CONTENT_TYPE_UID}"...`);
  await createContentType(apiKey, CONTENT_TYPE_UID, "Blog Post");

  // Taxonomy must exist before it can be referenced as a schema field below,
  // and the schema field must exist before an entry can be tagged with it -
  // so this runs ahead of entry creation despite being conceptually a
  // "Taxonomy section" fixture.
  console.log("[seed] Ensuring taxonomy...");
  const taxonomyOk = await createTaxonomy(apiKey, "one", "SDK Automation Taxonomy", "term_one")
    .then(() => true)
    .catch((e) => {
      console.log(`[seed]   taxonomy skipped: ${e.message}`);
      return false;
    });

  if (taxonomyOk) {
    console.log(`[seed] Ensuring "${CONTENT_TYPE_UID}" has a taxonomy field...`);
    const { status, data } = await addTaxonomyField(apiKey, CONTENT_TYPE_UID, "one");
    if (status !== 200 && status !== 201) console.log(`[seed]   taxonomy field skipped: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  }

  console.log("[seed] Ensuring 2 entries...");
  let existingEntries = await listEntries(apiKey, CONTENT_TYPE_UID);
  let entryUid1: string | undefined = existingEntries[0];
  let entryUid2: string | undefined = existingEntries[1];
  if (!entryUid1) entryUid1 = await createEntry(apiKey, CONTENT_TYPE_UID, "SDK Automation Entry One").catch(() => undefined);
  if (!entryUid2) entryUid2 = await createEntry(apiKey, CONTENT_TYPE_UID, "SDK Automation Entry Two").catch(() => undefined);

  if (taxonomyOk && entryUid1) {
    console.log("[seed] Tagging entries with the taxonomy term...");
    const tag1 = await tagEntryTaxonomy(apiKey, CONTENT_TYPE_UID, entryUid1, "one", "term_one");
    if (tag1.status !== 200 && tag1.status !== 201) console.log(`[seed]   tag entryUid1 skipped: ${tag1.status} ${JSON.stringify(tag1.data).slice(0, 200)}`);
    if (entryUid2) {
      const tag2 = await tagEntryTaxonomy(apiKey, CONTENT_TYPE_UID, entryUid2, "one", "term_one");
      if (tag2.status !== 200 && tag2.status !== 201) console.log(`[seed]   tag entryUid2 skipped: ${tag2.status} ${JSON.stringify(tag2.data).slice(0, 200)}`);
    }
  }

  console.log(`[seed] Ensuring environment "${ENVIRONMENT}"...`);
  await createEnvironment(apiKey, ENVIRONMENT);

  // Publish so the Delivery SDK (which only ever reads published content)
  // can actually see this fixture data - entries/assets are draft-only by
  // default and won't resolve from stack.contentType().entry().fetch() etc.
  // until published to the environment the delivery token is scoped to.
  console.log("[seed] Publishing entries to the environment...");
  if (entryUid1) await publishEntry(apiKey, CONTENT_TYPE_UID, entryUid1, ENVIRONMENT).catch((e) => console.log(`[seed]   publish entryUid1 skipped: ${e.message}`));
  if (entryUid2) await publishEntry(apiKey, CONTENT_TYPE_UID, entryUid2, ENVIRONMENT).catch((e) => console.log(`[seed]   publish entryUid2 skipped: ${e.message}`));

  console.log("[seed] Ensuring an asset...");
  const existingAssetUid = process.env.SEED_ASSET_UID;
  const assetUid = existingAssetUid || (await uploadAsset(apiKey, "sdk-automation-fixture.txt", "Seeded fixture asset for sdk-automation.").catch(() => undefined));
  if (assetUid && !existingAssetUid) {
    console.log("[seed] Publishing asset...");
    await publishAsset(apiKey, assetUid, ENVIRONMENT).catch((e) => console.log(`[seed]   publish asset skipped: ${e.message}`));
  }

  console.log("[seed] Ensuring global field...");
  const existingGlobalFieldUid = process.env.SEED_GLOBAL_FIELD_UID;
  const globalFieldUid = existingGlobalFieldUid || "sdk_automation_global_field";
  if (!existingGlobalFieldUid) {
    await createGlobalField(apiKey, globalFieldUid, "SDK Automation Global Field").catch((e) => console.log(`[seed]   global field skipped: ${e.message}`));
  }

  let deliveryToken = process.env.DELIVERY_TOKEN;
  if (!deliveryToken) {
    console.log("[seed] Creating delivery token...");
    deliveryToken = await createDeliveryToken(apiKey, ENVIRONMENT);
  } else {
    console.log("[seed] Reusing existing DELIVERY_TOKEN from .env.");
  }

  updateEnvFile({
    STACK_API_KEY: apiKey,
    DELIVERY_TOKEN: deliveryToken,
    ENVIRONMENT,
    ...(assetUid ? { SEED_ASSET_UID: assetUid } : {}),
    ...(entryUid1 ? { SEED_ENTRY_UID: entryUid1 } : {}),
    SEED_GLOBAL_FIELD_UID: globalFieldUid,
  });

  console.log("\n[seed] Done. Seeded fixture UIDs (for reference, not required in .env):");
  console.log(`  content type: ${CONTENT_TYPE_UID}`);
  console.log(`  entries: ${entryUid1 ?? "(already existed)"}  ${entryUid2 ?? "(already existed)"}`);
  console.log(`  asset: ${assetUid ?? "(upload failed - check logs)"}`);
}

if (process.argv[1]?.endsWith("seedStack.ts")) {
  main().catch((e) => {
    console.error(`[seed] FAILED: ${e.message}`);
    process.exit(1);
  });
}

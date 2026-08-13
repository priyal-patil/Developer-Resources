/**
 * Creates (or reuses) a DEDICATED, DISPOSABLE stack for the Management SDK
 * doc - deliberately separate from the Delivery SDK's "SDK Automation -
 * TypeScript Delivery" stack, since Management API snippets create,
 * update, and delete real resources. Keeping the two isolated means a
 * destructive Management snippet (or a bug in one) can never corrupt the
 * Delivery doc's fixtures.
 *
 * The Management SDK authenticates via `contentstack.client({ authtoken })`
 * (a user-session token, not a stack-scoped delivery/management token),
 * then scopes to a stack via `.stack({ api_key })` per-call - matches
 * every example on the live doc. Persists MGMT_AUTHTOKEN + MGMT_STACK_API_KEY
 * plus a few disposable fixture UIDs (content type, entry, asset) used by
 * ContentType/Entry/Asset section snippets that read/update existing
 * resources rather than creating their own.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  getAuthtoken,
  findStackByName,
  createStack,
  createContentType,
  listEntries,
  createEntry,
  uploadAsset,
} from "./contentstack.js";

const STACK_NAME = "SDK Automation - Management JS";
const CONTENT_TYPE_UID = "blog_post";
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
  console.log("[seed-mgmt] Logging in for an authtoken...");
  const authtoken = await getAuthtoken();

  console.log(`[seed-mgmt] Looking for existing stack "${STACK_NAME}"...`);
  let stack = await findStackByName(STACK_NAME);
  if (!stack) {
    console.log("[seed-mgmt] Not found - creating a new dedicated stack.");
    stack = await createStack(STACK_NAME);
  }
  const apiKey = stack.apiKey;
  // Runs land in a public repo's logs — mask the key so Actions redacts it here
  // and in anything logged downstream.
  if (process.env.CI) console.log(`::add-mask::${apiKey}`);
  console.log(`[seed-mgmt] Stack API key: ${apiKey}`);

  console.log(`[seed-mgmt] Ensuring content type "${CONTENT_TYPE_UID}"...`);
  await createContentType(apiKey, CONTENT_TYPE_UID, "Blog Post");

  console.log("[seed-mgmt] Ensuring an entry...");
  const existingEntries = await listEntries(apiKey, CONTENT_TYPE_UID);
  const entryUid = existingEntries[0] ?? (await createEntry(apiKey, CONTENT_TYPE_UID, "Management SDK Automation Entry").catch(() => undefined));

  console.log("[seed-mgmt] Ensuring an asset...");
  // Checking truthiness of the persisted MGMT_ASSET_UID alone isn't enough -
  // if the stack itself got recreated (e.g. deleted by unrelated churn in
  // the shared QA org and re-seeded under a new api_key), that UID is stale
  // and belongs to a stack that no longer exists. Confirm it still resolves
  // under the CURRENT api_key before reusing it.
  const existingAssetUid = process.env.MGMT_ASSET_UID;
  const existingAssetStillValid =
    existingAssetUid &&
    (await fetch(`https://api.contentstack.io/v3/assets/${existingAssetUid}`, { headers: { authtoken, api_key: apiKey } }).then((r) => r.ok, () => false));
  const assetUid = existingAssetStillValid ? existingAssetUid : await uploadAsset(apiKey, "mgmt-automation-fixture.txt", "Seeded fixture asset for the management SDK doc automation.").catch(() => undefined);

  updateEnvFile({
    MGMT_AUTHTOKEN: authtoken,
    MGMT_STACK_API_KEY: apiKey,
    MGMT_CONTENT_TYPE_UID: CONTENT_TYPE_UID,
    ...(entryUid ? { MGMT_ENTRY_UID: entryUid } : {}),
    ...(assetUid ? { MGMT_ASSET_UID: assetUid } : {}),
  });

  console.log("\n[seed-mgmt] Done.");
  console.log(`  stack: ${apiKey}`);
  console.log(`  content type: ${CONTENT_TYPE_UID}`);
  console.log(`  entry: ${entryUid ?? "(unavailable)"}`);
  console.log(`  asset: ${assetUid ?? "(unavailable)"}`);
  console.log('\n  Note: MGMT_AUTHTOKEN is a session token and can expire - rerun "npm run seed:management" if runs start failing with 401s.');
}

if (process.argv[1]?.endsWith("seedManagementStack.ts")) {
  main().catch((e) => {
    console.error(`[seed-mgmt] FAILED: ${e.message}`);
    process.exit(1);
  });
}

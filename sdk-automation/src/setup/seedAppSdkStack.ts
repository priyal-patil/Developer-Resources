/**
 * Sets up everything the App SDK doc automation needs: a dedicated stack +
 * content type (with a custom field bound to our installed app) + entry
 * (persistent, reused across runs - same as the other 3 docs' seed
 * scripts), plus the test-harness app itself (testapp/), which is NOT
 * persistent - it needs a live tunnel URL, so `setupAppSdk()` is called
 * fresh at the start of every run (from index.ts's "app" sdkKind branch),
 * not once ahead of time. Running this file directly (`npm run seed:app`)
 * is for manual setup/testing - it keeps the tunnel alive until Ctrl+C.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getAuthtoken, findStackByName, createStack, createContentType, getContentTypeSchema, listEntries, createEntry, deleteStack } from "./contentstack.js";
import { findAppByName, createApp, configureAppLocations, installApp, getInstallationExtensionUids, uninstallApp, deleteApp } from "./appSdkManifest.js";
import { startAppSdkTunnel, type AppSdkTunnel } from "./appSdkTunnel.js";

const STACK_NAME = "SDK Automation - App SDK";
const APP_NAME = "SDK Auto App SDK"; // <= 20 chars, same undocumented limit found for the Marketplace SDK doc
const CONTENT_TYPE_UID = "app_sdk_test_ct";
const CUSTOM_FIELD_UID = "app_field";
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

export interface AppSdkSetup {
  tunnel: AppSdkTunnel;
  orgUid: string;
  stackApiKey: string;
  contentTypeUid: string;
  entryUid: string;
  appUid: string;
  installationUid: string;
}

/**
 * Full live setup: starts the tunnel, ensures the stack/content-type/entry
 * exist, ensures ONE persistent app exists (apps are a scarce, org-wide
 * quota-limited resource - same caution as the Marketplace SDK doc, reuse
 * by name rather than creating fresh), points its hosting+ui_location at
 * THIS run's tunnel URL (must be redone every run - the URL changes), and
 * wires the CustomField location's real extension_uid into the content
 * type's schema (only added once - checked by field uid).
 */
export async function setupAppSdk(): Promise<AppSdkSetup> {
  const orgUid = process.env.CONTENTSTACK_ORG_ID ?? "";

  console.log("[seed-app] Starting tunnel...");
  const tunnel = await startAppSdkTunnel();
  console.log(`[seed-app] Tunnel: ${tunnel.url}`);
  // The API's URL-reachability check needs the tunnel to have finished
  // establishing before it'll accept the URL - a few seconds' margin.
  await new Promise((r) => setTimeout(r, 4000));

  console.log(`[seed-app] Looking for existing stack "${STACK_NAME}"...`);
  let stack = await findStackByName(STACK_NAME);
  if (!stack) {
    console.log("[seed-app] Not found - creating a new dedicated stack.");
    stack = await createStack(STACK_NAME);
  }
  const stackApiKey = stack.apiKey;
  console.log(`[seed-app] Stack: ${stackApiKey}`);

  console.log(`[seed-app] Looking for existing app "${APP_NAME}"...`);
  let app = await findAppByName(orgUid, APP_NAME);
  if (!app) {
    console.log("[seed-app] Not found - creating one (org has a low max-apps quota, so this should only happen once).");
    app = await createApp(orgUid, APP_NAME);
  }
  console.log(`[seed-app] App: ${app.uid}`);

  console.log("[seed-app] Pointing the app's hosting + ui_location at this run's tunnel URL...");
  await configureAppLocations(orgUid, app.uid, tunnel.url);

  // Always a fresh uninstall+reinstall (see appSdkManifest.ts's installApp
  // doc comment) - the Extension record's `src` is pinned at install time
  // and won't follow a later ui_location update on an already-installed app.
  console.log("[seed-app] Reinstalling the app onto the stack (fresh, to pick up this run's tunnel URL)...");
  const installation = await installApp(orgUid, app.uid, stackApiKey);
  console.log(`[seed-app] Installation: ${installation.uid}`);

  console.log("[seed-app] Ensuring content type, refreshing its app-bound custom field...");
  await createContentType(stackApiKey, CONTENT_TYPE_UID, "App SDK Test CT");
  const extensionUids = await getInstallationExtensionUids(orgUid, installation.uid);
  const customFieldExtensionUid = extensionUids["cs.cm.stack.custom_field"];
  if (!customFieldExtensionUid) throw new Error("Installation has no cs.cm.stack.custom_field extension_uid - install may be stale.");
  // Since the reinstall above generated a brand-new extension_uid, the field
  // must be removed and re-added every run (a plain field-value update
  // wouldn't pick up the new extension_uid) - not just added once.
  let schema = (await getContentTypeSchema(stackApiKey, CONTENT_TYPE_UID)).filter((f: any) => f.uid !== CUSTOM_FIELD_UID);
  schema.push({ display_name: "App Field", uid: CUSTOM_FIELD_UID, data_type: "json", extension_uid: customFieldExtensionUid });
  const authtoken = await getAuthtoken();
  const res = await fetch(`https://api.contentstack.io/v3/content_types/${CONTENT_TYPE_UID}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", authtoken, api_key: stackApiKey },
    body: JSON.stringify({ content_type: { schema } }),
  });
  if (!res.ok) throw new Error(`Refreshing app custom field on content type failed: ${res.status} ${await res.text()}`);

  console.log("[seed-app] Ensuring an entry...");
  const existingEntries = await listEntries(stackApiKey, CONTENT_TYPE_UID);
  const entryUid = existingEntries[0] ?? (await createEntry(stackApiKey, CONTENT_TYPE_UID, "App SDK Automation Entry"));

  updateEnvFile({
    APPSDK_ORG_UID: orgUid,
    APPSDK_STACK_API_KEY: stackApiKey,
    APPSDK_CONTENT_TYPE_UID: CONTENT_TYPE_UID,
    APPSDK_ENTRY_UID: entryUid,
    APPSDK_APP_UID: app.uid,
    APPSDK_INSTALLATION_UID: installation.uid,
  });

  return { tunnel, orgUid, stackApiKey, contentTypeUid: CONTENT_TYPE_UID, entryUid, appUid: app.uid, installationUid: installation.uid };
}

export async function teardownAppSdk(setup: Pick<AppSdkSetup, "orgUid" | "appUid" | "installationUid" | "stackApiKey">): Promise<void> {
  await uninstallApp(setup.orgUid, setup.installationUid);
  await deleteApp(setup.orgUid, setup.appUid);
  await deleteStack(setup.stackApiKey);
}

if (process.argv[1]?.endsWith("seedAppSdkStack.ts")) {
  setupAppSdk()
    .then((setup) => {
      console.log("\n[seed-app] Done. Tunnel stays open for manual testing - Ctrl+C to stop.");
      console.log(`  stack: ${setup.stackApiKey}`);
      console.log(`  content type: ${setup.contentTypeUid} (field "${CUSTOM_FIELD_UID}")`);
      console.log(`  entry: ${setup.entryUid}`);
      console.log(`  app: ${setup.appUid}`);
      console.log(`  tunnel: ${setup.tunnel.url}`);
    })
    .catch((e) => {
      console.error(`[seed-app] FAILED: ${e.message}`);
      process.exit(1);
    });
}

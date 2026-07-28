/**
 * Seeds fixtures for the Java Marketplace SDK doc automation. This SDK is
 * org-level only (App/Auth/Installation/AppRequest, no stack-scoped
 * resources at all) - reuses the same DeveloperHub API plumbing already
 * built for the JavaScript Marketplace SDK doc (marketplaceDisposable.ts),
 * since both SDKs are clients of the exact same backend API, just in
 * different languages.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getAuthtoken } from "./contentstack.js";
import { findAppByName, createDisposableApp, installApp } from "./marketplaceDisposable.js";

const APP_NAME = "SDK Java Mkt App"; // <= 20 chars, same undocumented limit found for the JS Marketplace SDK doc
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
  console.log("[seed-java-mkt] Logging in for an authtoken...");
  const authtoken = await getAuthtoken();
  const orgUid = process.env.CONTENTSTACK_ORG_ID ?? "";

  console.log(`[seed-java-mkt] Looking for existing app "${APP_NAME}"...`);
  let app = await findAppByName(orgUid, APP_NAME);
  if (!app) {
    console.log("[seed-java-mkt] Not found - creating one (org has a low max-apps quota, so this should only happen once).");
    app = await createDisposableApp(orgUid, APP_NAME);
  }
  console.log(`[seed-java-mkt] App: ${app.uid}`);

  updateEnvFile({
    JAVAMKT_ORG_UID: orgUid,
    JAVAMKT_AUTHTOKEN: authtoken,
    JAVAMKT_APP_UID: app.uid,
  });

  console.log("\n[seed-java-mkt] Done.");
  console.log(`  org: ${orgUid}`);
  console.log(`  app: ${app.uid}`);
  console.log('\n  Note: JAVAMKT_AUTHTOKEN is a session token and can expire - rerun "npm run seed:java-marketplace" if runs start failing with 401s.');
}

if (process.argv[1]?.endsWith("seedJavaMarketplaceStack.ts")) {
  main().catch((e) => {
    console.error(`[seed-java-mkt] FAILED: ${e.message}`);
    process.exit(1);
  });
}

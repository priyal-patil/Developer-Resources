/**
 * Seeds fixtures for the Marketplace SDK doc automation. Unlike the
 * Delivery/Management docs, Marketplace apps ("manifests") are
 * ORGANIZATION-scoped (see marketplaceDisposable.ts), so there's no
 * separate "dedicated stack" to isolate app data from - CONTENTSTACK_ORG_ID
 * (the same shared QA org every sibling automation uses) is the natural
 * scope. A dedicated, disposable STACK is still created here, purely as an
 * install TARGET for App.install()/upgrade() - so those methods have
 * somewhere real to install onto without touching the Delivery/Management
 * docs' own stacks.
 *
 * Persists MKT_AUTHTOKEN, MKT_ORG_UID, MKT_STACK_API_KEY (install target),
 * MKT_APP_UID + MKT_INSTALLATION_UID (long-lived fixtures the doc's
 * fetch/update/oauth/hosting/installation-lookup snippets read against -
 * recreated fresh each seed run since apps are cheap and this project
 * cleans up its own data when asked, same as the Delivery/Management docs).
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getAuthtoken, findStackByName, createStack } from "./contentstack.js";
import { createDisposableApp, findAppByName, installApp } from "./marketplaceDisposable.js";

const STACK_NAME = "SDK Automation - Marketplace JS";
// The org enforces a low max-apps quota (confirmed via a real "you have
// reached the maximum number of allowed apps" 400 the first time this
// script created a fresh app on every run) - find-and-reuse by name here,
// same as the stack above, rather than creating a new one each seed run.
// Kept to <= 20 chars, another undocumented real constraint discovered via
// a 400 ("name must be shorter than or equal to 20 characters").
const APP_NAME = "SDK Auto App";
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
  console.log("[seed-mkt] Logging in for an authtoken...");
  const authtoken = await getAuthtoken();
  const orgUid = process.env.CONTENTSTACK_ORG_ID ?? "";

  console.log(`[seed-mkt] Looking for existing install-target stack "${STACK_NAME}"...`);
  let stack = await findStackByName(STACK_NAME);
  if (!stack) {
    console.log("[seed-mkt] Not found - creating a new dedicated stack.");
    stack = await createStack(STACK_NAME);
  }
  const stackApiKey = stack.apiKey;
  // Runs land in a public repo's logs — mask the key so Actions redacts it here
  // and in anything logged downstream.
  if (process.env.CI) console.log(`::add-mask::${stackApiKey}`);
  console.log(`[seed-mkt] Stack API key: ${stackApiKey}`);

  console.log(`[seed-mkt] Looking for existing app "${APP_NAME}"...`);
  let app = await findAppByName(orgUid, APP_NAME);
  if (!app) {
    console.log("[seed-mkt] Not found - creating one (org has a low max-apps quota, so this should only happen once).");
    app = await createDisposableApp(orgUid, APP_NAME);
  }
  console.log(`[seed-mkt] App uid: ${app.uid}`);

  console.log("[seed-mkt] Installing the app onto the install-target stack...");
  const installation = await installApp(orgUid, app.uid, stackApiKey);
  console.log(installation ? `[seed-mkt] Installation uid: ${installation.uid}` : "[seed-mkt] Install failed - Installation section will 404 on unseeded lookups.");

  updateEnvFile({
    MKT_AUTHTOKEN: authtoken,
    MKT_ORG_UID: orgUid,
    MKT_STACK_API_KEY: stackApiKey,
    MKT_APP_UID: app.uid,
    ...(installation ? { MKT_INSTALLATION_UID: installation.uid } : {}),
  });

  console.log("\n[seed-mkt] Done.");
  console.log(`  org: ${orgUid}`);
  console.log(`  install-target stack: ${stackApiKey}`);
  console.log(`  app: ${app.uid}`);
  console.log(`  installation: ${installation?.uid ?? "(unavailable)"}`);
  console.log('\n  Note: MKT_AUTHTOKEN is a session token and can expire - rerun "npm run seed:marketplace" if runs start failing with 401s.');
}

if (process.argv[1]?.endsWith("seedMarketplaceStack.ts")) {
  main().catch((e) => {
    console.error(`[seed-mkt] FAILED: ${e.message}`);
    process.exit(1);
  });
}

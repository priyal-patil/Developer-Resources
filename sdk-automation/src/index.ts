/**
 * Orchestrator: parse -> execute -> verify -> report.
 * Usage: npm run run-one -- <docName> [--only-failures]
 *
 * --only-failures re-executes just the methods that failed in the last run
 * (reads reports/latest.json for that doc) instead of all of them - useful
 * for fast iteration on a harness fix or after an upstream doc/SDK fix,
 * without waiting on everything that already passes. Previously-passing/
 * no-example results are carried over unchanged into the new report so it
 * still reflects the full doc, not just the retried subset.
 *
 * No teardown phase - see README ("Why this stack isn't torn down").
 * Per the verbatim-execution contract, a failing/missing-in-doc snippet is
 * recorded and the run continues; one pass produces the full gap report.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { fetchDocMarkdown, parseDoc } from "./parse/parseDoc.js";
import { scrapeDoc } from "./parse/parseDocDom.js";
import { runSnippet } from "./execute/runSnippet.js";
import { runManagementSnippet } from "./execute/runManagementSnippet.js";
import { runMarketplaceSnippet } from "./execute/runMarketplaceSnippet.js";
import { runAppSdkSnippet } from "./execute/runAppSdkSnippet.js";
import { runJavaSnippet } from "./execute/runJavaSnippet.js";
import { runJavaDeliverySnippet } from "./execute/runJavaDeliverySnippet.js";
import { runDeliveryLegacyJsSnippet } from "./execute/runDeliveryLegacyJsSnippet.js";
import { runPythonSnippet } from "./execute/runPythonSnippet.js";
import { ensurePythonVenv } from "./setup/pythonHarness.js";
import { runDotnetSnippet } from "./execute/runDotnetSnippet.js";
import { ensureDotnetProject } from "./setup/dotnetHarness.js";
import { runPhpSnippet } from "./execute/runPhpSnippet.js";
import { runRubySnippet } from "./execute/runRubySnippet.js";
import { runDartSnippet } from "./execute/runDartSnippet.js";
import { runAndroidSnippet } from "./execute/runAndroidSnippet.js";
import { runManagementPythonSnippet } from "./execute/runManagementPythonSnippet.js";
import { runManagementJavaSnippet } from "./execute/runManagementJavaSnippet.js";
import { runManagementDotnetSnippet } from "./execute/runManagementDotnetSnippet.js";
import { ensureDotnetManagementProject } from "./setup/dotnetManagementHarness.js";
import { hasDisposableSupport, prepareDisposable, translateDisposableOverrides, hasTranslatableDisposableSupport } from "./setup/disposableResource.js";
import { hasMarketplaceDisposableSupport, prepareMarketplaceDisposable, prepareAuthorizationDisposable } from "./setup/marketplaceDisposable.js";
import { setupAppSdk, teardownAppSdk } from "./setup/seedAppSdkStack.js";
import { loginAppSdkSession, gotoEntryEditPage, gotoDashboard, findLocationFrame } from "./execute/appSdkSession.js";
import type { Frame } from "playwright";
import { signatureAudit } from "./verify/signatureAudit.js";
import { sourceAudit } from "./verify/sourceAudit.js";
import { outputCheck } from "./verify/outputCheck.js";
import { lintBlocks } from "./verify/lintBlocks.js";
import { writeReport } from "./report/generateReport.js";
import type { DocConfig, RunReport, RunResult } from "./types.js";

const ROOT = new URL("..", import.meta.url).pathname;

/**
 * Org-level/account-level sections can affect things beyond a single
 * stack (organization membership, teams, roles shared with other users in
 * the QA org) - per an explicit decision, these are scraped and
 * signature-audited (confirm the methods exist) but never executed.
 */
const ORG_LEVEL_SKIP_SECTIONS = new Set(["Organization", "User", "Teams", "Teamusers", "Role", "Auditlog", "Stackrolemappings"]);
const MGMT_PYTHON_ORG_LEVEL_SKIP_SECTIONS = new Set(["Organization", "User", "User Session", "Roles", "Audit Log", "Bulk Operations"]);
const MGMT_JAVA_ORG_LEVEL_SKIP_SECTIONS = new Set(["User", "Organization", "Auditlog", "Role", "Bulkoperation"]);
const MGMT_DOTNET_ORG_LEVEL_SKIP_SECTIONS = new Set(["User", "Organization", "Auditlog", "Role", "BulkOperations"]);

/**
 * Every genuinely destructive method in the Management SDK doc is named
 * "delete"/"remove"/"Delete ..." (confirmed by scanning all 261 method
 * names - no false positives like a hypothetical "removeParam" utility).
 */
function isDestructiveMethod(method: string): boolean {
  return /delete|remove|destroy/i.test(method);
}

/**
 * Org-level sections were originally skipped wholesale, but most of their
 * methods are actually plain reads (fetch/find/get/query/logs/roles/...)
 * that can't affect other users/automations sharing the QA org - only the
 * genuinely mutating ones (create/update/add/invite/transfer/share/assign/
 * enable/disable/set/login/logout/activate/reset/resend) need to stay
 * skipped. Splitting this out turns a large fraction of the previous
 * blanket org-level skips into real, safe executions.
 */
const MUTATING_METHOD_RE = /add|remove|update|create|delete|invite|transfer|share|unshare|assign|enable|disable|^set|login|logout|activate|deactivate|reset|resend|clone|deploy|apply|revoke/i;
function isMutatingMethod(method: string): boolean {
  return isDestructiveMethod(method) || MUTATING_METHOD_RE.test(method);
}

/**
 * App SDK doc - first-increment scope (see the approved plan). In scope:
 * the sections reachable from a single entry-edit page load
 * (CustomField/SidebarWidget/FieldModifierLocation all render as separate
 * iframes on the SAME page - see appSdkSession.ts's findLocationFrame),
 * DashboardWidget (its own stack-dashboard page), the SDK class itself, and
 * the bulk of the real API surface (App SDK Core Objects: Stack/Entry/
 * Field/Frame/Store), exercised via the CustomField iframe since it's the
 * one location exposing all four pass-through objects at once.
 *
 * Deferred to a follow-up pass (skipped, documented as known-incomplete,
 * same precedent as the Management/Marketplace docs' org-level/destructive
 * skip lists): GlobalFullPageLocation (org-level install, separate setup),
 * AppConfigWidget (different nav flow - app config modal, not a content
 * page), AssetSidebarWidget (needs a real asset + binary file upload),
 * RTEPlugin/RTELocation (needs live RTE toolbar interaction to verify
 * anything), and FullPage (its dedicated full-page app route couldn't be
 * reliably discovered in this pass - deferred rather than guessed).
 */
const APP_SDK_IN_SCOPE_SECTIONS = new Set(["ContentstackAppSDK", "CustomField", "SidebarWidget", "FieldModifierLocation", "DashboardWidget", "App SDK Core Objects"]);

async function main() {
  const docName = process.argv[2];
  const onlyFailures = process.argv.includes("--only-failures");
  if (!docName) {
    console.error("Usage: npm run run-one -- <docName> [--only-failures]");
    process.exit(1);
  }

  const configs: DocConfig[] = JSON.parse(readFileSync(`${ROOT}config/docs.json`, "utf8"));
  const config = configs.find((c) => c.name === docName);
  if (!config) throw new Error(`No config entry named "${docName}" in config/docs.json`);

  let carriedOverResults: RunResult[] = [];
  let retryMethodIds: Set<number> | undefined;
  if (onlyFailures) {
    const latestPath = `${ROOT}reports/${docName}-latest.json`;
    const fallbackPath = `${ROOT}reports/latest.json`;
    const prevPath = existsSync(latestPath) ? latestPath : fallbackPath;
    if (!existsSync(prevPath)) throw new Error(`--only-failures needs a previous run - no ${prevPath} found. Run without the flag first.`);
    const prev: RunReport = JSON.parse(readFileSync(prevPath, "utf8"));
    const failedIds = new Set(prev.results.filter((r) => r.outcome === "fail").map((r) => r.methodId));
    if (failedIds.size === 0) {
      console.log("No failures in the previous run - nothing to retry.");
      return;
    }
    retryMethodIds = failedIds;
    carriedOverResults = prev.results.filter((r) => !failedIds.has(r.methodId));
    console.log(`[0/4] --only-failures: retrying ${failedIds.size} previously-failed method(s), carrying over ${carriedOverResults.length} unchanged result(s).`);
  }

  const useDomScrape = config.scrapeMode === "dom";
  console.log(`[1/4] Parsing ${config.url} ${useDomScrape ? "(DOM scrape)" : "(.md fetch)"} ...`);
  const doc = useDomScrape
    ? await scrapeDoc(config.name, config.url)
    : parseDoc(config.name, await fetchDocMarkdown(config.url));
  console.log(`      ${doc.navSections.length} nav sections, ${doc.methods.length} documented methods.`);

  if (
    config.sdkKind === "management" ||
    config.sdkKind === "management-python" ||
    config.sdkKind === "management-java" ||
    config.sdkKind === "management-dotnet"
  ) {
    if (!process.env.MGMT_STACK_API_KEY || !process.env.MGMT_AUTHTOKEN) {
      console.error('      No MGMT_STACK_API_KEY/MGMT_AUTHTOKEN in .env - run "npm run seed:management" first.');
      process.exit(1);
    }
  } else if (config.sdkKind === "marketplace") {
    if (!process.env.MKT_ORG_UID || !process.env.MKT_AUTHTOKEN) {
      console.error('      No MKT_ORG_UID/MKT_AUTHTOKEN in .env - run "npm run seed:marketplace" first.');
      process.exit(1);
    }
  } else if (config.sdkKind === "app") {
    // Live setup (tunnel + app reinstall) happens per-run below, not via a
    // one-time "npm run seed" step - see setupAppSdk()'s doc comment.
  } else if (config.sdkKind === "marketplace-java") {
    if (!process.env.JAVAMKT_ORG_UID || !process.env.JAVAMKT_AUTHTOKEN) {
      console.error('      No JAVAMKT_ORG_UID/JAVAMKT_AUTHTOKEN in .env - run "npm run seed:java-marketplace" first.');
      process.exit(1);
    }
  } else if (!process.env.STACK_API_KEY || !process.env.DELIVERY_TOKEN) {
    console.error('      No STACK_API_KEY/DELIVERY_TOKEN in .env - run "npm run seed" first.');
    process.exit(1);
  }

  if (config.sdkKind === "delivery-python") {
    await ensurePythonVenv();
  }
  if (config.sdkKind === "management-python") {
    await ensurePythonVenv(["contentstack-management", "pyotp"]);
  }
  if (config.sdkKind === "management-dotnet") {
    await ensureDotnetManagementProject();
  }
  if (config.sdkKind === "delivery-dotnet") {
    await ensureDotnetProject();
  }

  let methodsToRun = retryMethodIds ? doc.methods.filter((m) => retryMethodIds!.has(m.id)) : doc.methods;
  if (config.sdkKind === "marketplace") {
    // App > delete reuses the ONE persistent seeded app rather than a
    // fresh disposable one (apps are a scarce, org-wide quota - see
    // marketplaceDisposable.ts) - it must run LAST so every other
    // App-section snippet that depends on the app still existing runs first.
    const isAppDelete = (m: typeof doc.methods[number]) => m.navSection === "App" && m.method === "delete";
    methodsToRun = [...methodsToRun.filter((m) => !isAppDelete(m)), ...methodsToRun.filter(isAppDelete)];
  }
  console.log(`[2/4] Executing ${methodsToRun.length} method example snippet(s) verbatim ...`);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = `${ROOT}workdir/run-${runId}`;
  const results: RunResult[] = [...carriedOverResults];

  // App SDK doc: one live browser session for the whole run, not a fresh
  // Node subprocess per snippet (see runAppSdkSnippet.ts) - set up once
  // here: start the tunnel, (re)install the test app, log into the real
  // Contentstack UI, and open the two navigation contexts this pass needs.
  let appSdk: Awaited<ReturnType<typeof setupAppSdk>> | undefined;
  let appSession: Awaited<ReturnType<typeof loginAppSdkSession>> | undefined;
  let customFieldFrame: Frame | undefined;
  let dashboardFrame: Frame | undefined;
  if (config.sdkKind === "app") {
    appSdk = await setupAppSdk();
    appSession = await loginAppSdkSession();
    // Two separate tabs, not one page navigated twice - navigating a page
    // away detaches every iframe reference taken on it (confirmed live:
    // the first attempt looked up customFieldFrame, then navigated the
    // SAME page to the dashboard for dashboardFrame, which silently killed
    // customFieldFrame - every method against it then failed with "Frame
    // was detached", not a real doc/SDK issue).
    await gotoEntryEditPage(appSession.page, appSdk.stackApiKey, appSdk.contentTypeUid, appSdk.entryUid);
    customFieldFrame = await findLocationFrame(appSession.page, "CustomField");
    if (!customFieldFrame) console.error("      WARNING: could not find a ready CustomField iframe - Core Objects/CustomField/SidebarWidget/FieldModifierLocation methods will fail.");

    const dashboardPage = await appSession.context.newPage();
    await gotoDashboard(dashboardPage, appSdk.stackApiKey);
    dashboardFrame = await findLocationFrame(dashboardPage, "DashboardWidget");
    if (!dashboardFrame) console.error("      WARNING: could not find a ready DashboardWidget iframe - DashboardWidget methods will fail.");
  }

  for (const m of methodsToRun) {
    if (m.codeBlocks.length === 0) {
      results.push({ methodId: m.id, navSection: m.navSection, method: m.method, outcome: "no-example", substitutions: {} });
      continue;
    }

    if (config.sdkKind === "management") {
      if (ORG_LEVEL_SKIP_SECTIONS.has(m.navSection) && isMutatingMethod(m.method)) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Org/account-level section - can affect other users/automations sharing the QA org, not executed by design (still signature-audited).",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (org-level, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method) && !hasDisposableSupport(m.navSection, m.method)) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Destructive method - no disposable-resource (create-then-delete) support implemented for this resource type yet. ContentType/Entry/Asset/Webhook/Label/GlobalField have it so far.",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (destructive, no fixture support, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method) && hasDisposableSupport(m.navSection, m.method)) {
        try {
          const disposable = await prepareDisposable(m.navSection, m.method, process.env.MGMT_STACK_API_KEY!);
          const result = await runManagementSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], disposable.overrides);
          if (result.outcome === "pass") {
            const actuallyDeleted = await disposable.verifyDeleted();
            result.resolvedOutput = `${result.resolvedOutput ?? ""} [verified deleted: ${actuallyDeleted}]`;
            if (!actuallyDeleted) result.outcome = "fail";
          }
          results.push(result);
          console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method} (create-then-delete)`);
        } catch (e: any) {
          results.push({ methodId: m.id, navSection: m.navSection, method: m.method, outcome: "fail", error: `disposable-resource setup failed: ${e.message}`, substitutions: {} });
          console.log(`      ✗ ${m.navSection} > ${m.method} (disposable setup failed)`);
        }
        continue;
      }
      // `uid` means a different resource in nearly every section, so it's
      // never in the global placeholder map - but for the sections we DO
      // have a real seeded fixture for, substituting it here (rather than
      // leaving it as the literal string "uid", which 404s/422s against
      // the real API) turns a harness gap into a real read/update check.
      const sectionOverrides: Record<string, Record<string, string>> = {
        Entry: { uid: process.env.MGMT_ENTRY_UID ?? "", content_type_uid: process.env.MGMT_CONTENT_TYPE_UID ?? "" },
        Asset: { uid: process.env.MGMT_ASSET_UID ?? "" },
        Contenttype: { uid: process.env.MGMT_CONTENT_TYPE_UID ?? "" },
      };
      const result = await runManagementSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], sectionOverrides[m.navSection] ?? {});
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "management-python") {
      // Python doc's own nav section names differ slightly from the JS
      // doc's (e.g. "User Session", "Audit Log", "Bulk Operations" as their
      // own sections) - a separate skip-list rather than reusing
      // ORG_LEVEL_SKIP_SECTIONS as-is.
      if (MGMT_PYTHON_ORG_LEVEL_SKIP_SECTIONS.has(m.navSection) && isMutatingMethod(m.method)) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Org/account-level or bulk-impact section - can affect other users/automations sharing the QA org, not executed by design (still signature-audited).",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (org-level, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method) && !hasTranslatableDisposableSupport(m.navSection, m.method, "python")) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Destructive method - no disposable-resource (create-then-delete) support implemented for this resource type yet.",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (destructive, no fixture support, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method)) {
        try {
          const disposable = await prepareDisposable(m.navSection, m.method, process.env.MGMT_STACK_API_KEY!);
          const overrides = translateDisposableOverrides(m.navSection, disposable.overrides, "python");
          const result = await runManagementPythonSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], overrides);
          if (result.outcome === "pass") {
            const actuallyDeleted = await disposable.verifyDeleted();
            result.resolvedOutput = `${result.resolvedOutput ?? ""} [verified deleted: ${actuallyDeleted}]`;
            if (!actuallyDeleted) result.outcome = "fail";
          }
          results.push(result);
          console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method} (create-then-delete)`);
        } catch (e: any) {
          results.push({ methodId: m.id, navSection: m.navSection, method: m.method, outcome: "fail", error: `disposable-resource setup failed: ${e.message}`, substitutions: {} });
          console.log(`      ✗ ${m.navSection} > ${m.method} (disposable setup failed)`);
        }
        continue;
      }
      const sectionOverridesPy: Record<string, Record<string, string>> = {
        Entry: { uid: process.env.MGMT_ENTRY_UID ?? "", content_type_uid: process.env.MGMT_CONTENT_TYPE_UID ?? "" },
        Asset: { uid: process.env.MGMT_ASSET_UID ?? "" },
        "Content Types": { uid: process.env.MGMT_CONTENT_TYPE_UID ?? "", content_type_uid: process.env.MGMT_CONTENT_TYPE_UID ?? "" },
      };
      const result = await runManagementPythonSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], sectionOverridesPy[m.navSection] ?? {});
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "management-java") {
      if (MGMT_JAVA_ORG_LEVEL_SKIP_SECTIONS.has(m.navSection) && isMutatingMethod(m.method)) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Org/account-level or bulk-impact section - can affect other users/automations sharing the QA org, not executed by design (still signature-audited).",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (org-level, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method) && !hasTranslatableDisposableSupport(m.navSection, m.method, "java")) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason:
            "Destructive method - no disposable-resource (create-then-delete) support for this resource type (or, for Label/Webhook, the doc's own example never passes a UID argument at all - confirmed via source, not fixable via placeholder substitution).",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (destructive, no fixture support, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method)) {
        try {
          const disposable = await prepareDisposable(m.navSection, m.method, process.env.MGMT_STACK_API_KEY!);
          const overrides = translateDisposableOverrides(m.navSection, disposable.overrides, "java");
          const result = await runManagementJavaSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], overrides);
          if (result.outcome === "pass") {
            const actuallyDeleted = await disposable.verifyDeleted();
            result.resolvedOutput = `${result.resolvedOutput ?? ""} [verified deleted: ${actuallyDeleted}]`;
            if (!actuallyDeleted) result.outcome = "fail";
          }
          results.push(result);
          console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method} (create-then-delete)`);
        } catch (e: any) {
          results.push({ methodId: m.id, navSection: m.navSection, method: m.method, outcome: "fail", error: `disposable-resource setup failed: ${e.message}`, substitutions: {} });
          console.log(`      ✗ ${m.navSection} > ${m.method} (disposable setup failed)`);
        }
        continue;
      }
      const sectionOverridesJava: Record<string, Record<string, string>> = {
        Entry: { entry_uid: process.env.MGMT_ENTRY_UID ?? "" },
        Asset: { asset_uid: process.env.MGMT_ASSET_UID ?? "" },
        Contenttype: { content_type_uid: process.env.MGMT_CONTENT_TYPE_UID ?? "" },
      };
      const result = await runManagementJavaSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], sectionOverridesJava[m.navSection] ?? {});
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "management-dotnet") {
      if (MGMT_DOTNET_ORG_LEVEL_SKIP_SECTIONS.has(m.navSection) && isMutatingMethod(m.method)) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Org/account-level or bulk-impact section - can affect other users/automations sharing the QA org, not executed by design (still signature-audited).",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (org-level, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method) && !hasTranslatableDisposableSupport(m.navSection, m.method, "dotnet")) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Destructive method - no disposable-resource (create-then-delete) support implemented for this resource type yet.",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (destructive, no fixture support, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method)) {
        try {
          const disposable = await prepareDisposable(m.navSection, m.method, process.env.MGMT_STACK_API_KEY!);
          const overrides = translateDisposableOverrides(m.navSection, disposable.overrides, "dotnet");
          const result = await runManagementDotnetSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], overrides);
          if (result.outcome === "pass") {
            const actuallyDeleted = await disposable.verifyDeleted();
            result.resolvedOutput = `${result.resolvedOutput ?? ""} [verified deleted: ${actuallyDeleted}]`;
            if (!actuallyDeleted) result.outcome = "fail";
          }
          results.push(result);
          console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method} (create-then-delete)`);
        } catch (e: any) {
          results.push({ methodId: m.id, navSection: m.navSection, method: m.method, outcome: "fail", error: `disposable-resource setup failed: ${e.message}`, substitutions: {} });
          console.log(`      ✗ ${m.navSection} > ${m.method} (disposable setup failed)`);
        }
        continue;
      }
      const sectionOverridesDotnet: Record<string, Record<string, string>> = {
        Entry: { "<ENTRY_UID>": process.env.MGMT_ENTRY_UID ?? "" },
        Asset: { "<ASSET_UID>": process.env.MGMT_ASSET_UID ?? "" },
        Contenttype: { "<CONTENT_TYPE_UID>": process.env.MGMT_CONTENT_TYPE_UID ?? "" },
      };
      const result = await runManagementDotnetSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], sectionOverridesDotnet[m.navSection] ?? {});
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "marketplace") {
      // No org-level skip-list here - this entire doc operates at the
      // organization level by design (apps/manifests aren't stack-scoped),
      // unlike the Management SDK doc where org-level sections were an
      // exception carved out from an otherwise stack-scoped surface.
      if (isDestructiveMethod(m.method) && !hasMarketplaceDisposableSupport(m.navSection, m.method)) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Destructive method - no disposable-resource (create-then-delete) support implemented for this type yet. Only App > delete has it so far.",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (destructive, no fixture support, skipped)`);
        continue;
      }
      if (isDestructiveMethod(m.method) && hasMarketplaceDisposableSupport(m.navSection, m.method)) {
        try {
          const disposable = await prepareMarketplaceDisposable(process.env.MKT_ORG_UID!, process.env.MKT_APP_UID!);
          const result = await runMarketplaceSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], disposable.overrides);
          if (result.outcome === "pass") {
            const actuallyDeleted = await disposable.verifyDeleted();
            result.resolvedOutput = `${result.resolvedOutput ?? ""} [verified deleted: ${actuallyDeleted}]`;
            if (!actuallyDeleted) result.outcome = "fail";
          }
          results.push(result);
          console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method} (create-then-delete)`);
        } catch (e: any) {
          results.push({ methodId: m.id, navSection: m.navSection, method: m.method, outcome: "fail", error: `disposable-resource setup failed: ${e.message}`, substitutions: {} });
          console.log(`      ✗ ${m.navSection} > ${m.method} (disposable setup failed)`);
        }
        continue;
      }
      const result = await runMarketplaceSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "app") {
      if (!APP_SDK_IN_SCOPE_SECTIONS.has(m.navSection)) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Deferred to a follow-up pass - see APP_SDK_IN_SCOPE_SECTIONS' doc comment (org-level install, asset/file-upload context, or live RTE-toolbar interaction needed).",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (out of scope this pass, skipped)`);
        continue;
      }
      // "Properties"/"Methods"/"Events" group-label headings the scraper
      // still records as their own section-self entries (e.g. Stack/Entry/
      // Field's own H3 headings) carry no code - already caught by the
      // no-example check above, so every method reaching here has real code.
      const frame = m.navSection === "DashboardWidget" ? dashboardFrame : customFieldFrame;
      if (!frame) {
        results.push({ methodId: m.id, navSection: m.navSection, method: m.method, outcome: "fail", error: "No live iframe found for this location - see setup warnings above.", substitutions: {} });
        console.log(`      ✗ ${m.navSection} > ${m.method} (no frame)`);
        continue;
      }
      const result = await runAppSdkSnippet(frame, m.id, m.navSection, m.method, m.codeBlocks[0], {
        content_type_uid: appSdk?.contentTypeUid ?? "",
      });
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "marketplace-java") {
      // "App > deleteAuthorization" now dispatches through a real
      // create-then-delete authorization fixture (see
      // prepareAuthorizationDisposable's doc comment) - authorizations
      // aren't a scarce org-wide resource the way apps are, so a fresh one
      // per run is fine. Every OTHER destructive method (deleteApp, ...)
      // still has no disposable-resource support and stays skipped, since
      // the one persistent seeded app can't be spent as a throwaway.
      if (m.navSection === "App" && m.method === "deleteAuthorization") {
        try {
          const disposable = await prepareAuthorizationDisposable(process.env.JAVAMKT_ORG_UID!, process.env.JAVAMKT_APP_UID!);
          const result = await runJavaSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], disposable.overrides);
          if (result.outcome === "pass") {
            const actuallyDeleted = await disposable.verifyDeleted();
            result.resolvedOutput = `${result.resolvedOutput ?? ""} [verified deleted: ${actuallyDeleted}]`;
            if (!actuallyDeleted) result.outcome = "fail";
          }
          results.push(result);
          console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method} (create-then-delete)`);
        } catch (e: any) {
          results.push({ methodId: m.id, navSection: m.navSection, method: m.method, outcome: "fail", error: `disposable-resource setup failed: ${e.message}`, substitutions: {} });
          console.log(`      ✗ ${m.navSection} > ${m.method} (disposable setup failed)`);
        }
        continue;
      }
      if (isDestructiveMethod(m.method)) {
        results.push({
          methodId: m.id,
          navSection: m.navSection,
          method: m.method,
          outcome: "skipped",
          skipReason: "Destructive method - no disposable-resource (create-then-delete) support implemented for this pass.",
          substitutions: {},
        });
        console.log(`      – ${m.navSection} > ${m.method} (destructive, no fixture support, skipped)`);
        continue;
      }
      const result = await runJavaSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "delivery-java") {
      const result = await runJavaDeliverySnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "delivery-legacy-js") {
      const result = await runDeliveryLegacyJsSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0], config.jsImportSpecifier ?? "contentstack");
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "delivery-python") {
      const result = await runPythonSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "delivery-dotnet") {
      const result = await runDotnetSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "delivery-php") {
      const result = await runPhpSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "delivery-ruby") {
      const result = await runRubySnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "delivery-dart") {
      const result = await runDartSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    if (config.sdkKind === "delivery-android") {
      const result = await runAndroidSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
      results.push(result);
      console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
      continue;
    }

    // Only the first code block per method is executed - some methods list
    // multiple illustrative variants; running just the primary one keeps
    // the harness's "log the last const" heuristic unambiguous.
    const result = await runSnippet(runDir, m.id, m.navSection, m.method, m.codeBlocks[0]);
    results.push(result);
    console.log(`      ${result.outcome === "pass" ? "✓" : "✗"} ${m.navSection} > ${m.method}`);
  }
  results.sort((a, b) => a.methodId - b.methodId);

  // Clean up the live browser session + tunnel + disposable app/stack -
  // apps are a scarce, org-wide quota-limited resource (see
  // marketplaceDisposable.ts's discovery), so this doc's dedicated app and
  // stack aren't left persisting between runs the way the Delivery SDK
  // doc's read-only stack is - matches the explicit cleanup done manually
  // for the Management/Marketplace docs, just automated here since the app
  // must be freshly reinstalled every run anyway (see appSdkManifest.ts).
  if (config.sdkKind === "app") {
    await appSession?.close();
    if (appSdk) {
      await teardownAppSdk(appSdk);
      await appSdk.tunnel.close();
    }
  }

  console.log("[3/4] Verifying (signature audit, output check, lint) ...");
  // signatureAudit reads an installed npm package's .d.ts files - not
  // applicable to a Maven/Java artifact, so it's skipped entirely for this
  // sdkKind rather than producing a misleading "could not read .d.ts" finding.
  let findings = [
    ...(config.sdkKind === "marketplace-java" || config.sdkKind === "delivery-java" || config.sdkKind === "delivery-python" || config.sdkKind === "delivery-dotnet" || config.sdkKind === "delivery-php" || config.sdkKind === "delivery-ruby" || config.sdkKind === "delivery-dart" || config.sdkKind === "delivery-android" || config.sdkKind === "management-python" || config.sdkKind === "management-java" || config.sdkKind === "management-dotnet" ? [] : await signatureAudit(doc.methods, config.sdkPackage)),
    ...outputCheck(results),
    ...lintBlocks(doc.methods),
  ];

  const repoSrcDir = config.repoName ? `${ROOT}repos/${config.repoName}/${config.repoSrcSubdir ?? "src"}` : undefined;
  if (repoSrcDir && existsSync(repoSrcDir)) {
    console.log(`      Cross-checking missing-method findings against cloned repo source (${config.repoName})...`);
    findings = sourceAudit(findings, repoSrcDir);
  } else if (config.repoName) {
    console.log(`      repos/${config.repoName} not cloned - skipping source-level audit (npm-package-only findings below).`);
  }

  console.log("[4/4] Writing report ...");
  writeReport({ docName: doc.name, docUrl: doc.url, runId, results, findings }, `${ROOT}reports`);

  const passCount = results.filter((r) => r.outcome === "pass").length;
  const failCount = results.filter((r) => r.outcome === "fail").length;
  const skippedCount = results.filter((r) => r.outcome === "skipped").length;
  console.log(
    `\nDone: ${passCount} passed, ${failCount} failed${skippedCount ? `, ${skippedCount} skipped (org-level/destructive-unimplemented)` : ""}, ${findings.length} audit findings.`
  );
  console.log(`See reports/index.html`);
}

main().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});

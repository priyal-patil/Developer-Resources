/**
 * Seeds a real test stack in the Contentstack QA org so every doc example
 * can run with its dummy values replaced by (or matching) real ones:
 *
 *  - content types named exactly like the doc's dummies: blog_post,
 *    article, product_page (so `--content-types blog_post article` runs
 *    literally as written)
 *  - two entries per content type, one asset, environments
 *    production/development, one label
 *  - a wide-scope management token registered in csdx under the alias
 *    `production` (the alias the doc's examples use)
 *  - a `develop` branch IF the plan allows it (QA plan: it doesn't —
 *    recorded so branch examples get flagged as environment limitations)
 */
import {
  createBranchAlias,
  createContentType,
  createDeliveryToken,
  createEntry,
  createEnvironment,
  createLabel,
  createManagementToken,
  createStack,
  deleteStack,
  tryCreateBranch,
  uploadAsset,
} from "../api/contentstack.js";
import { addTokenAlias, csdxLogin } from "./csdx.js";

export interface SeedContext {
  stackApiKey: string;
  stackName: string;
  alias: string;
  managementToken: string;
  contentTypes: string[];
  environments: string[];
  branchesSupported: boolean;
  branchError?: string;
  /** The branch that actually exists on the stack (doc dummy: develop). */
  realBranch: string;
  /** A real branch alias, if the platform let us create one (doc dummy: developAlias). */
  realBranchAlias?: string;
  /** UID of one seeded entry (blog_post), for docs needing a real `<base_entry_uid>`. */
  sampleEntryUid: string;
  /** A real delivery token scoped to the "production" environment. */
  deliveryToken: string;
  /** Set only for docs (export-content-to-csv) that need a real --taxonomy-uid to test against. */
  taxonomyUid?: string;
  /** Set only for the change-master-locale doc — the real downloaded migration script + two independent real exported data dirs (one per example command). */
  migrationScriptPath?: string;
  migrationExportDirs?: [string, string];
  /** Set only for the apps-cli-plugin doc — the real Developer Hub app created for its lifecycle. */
  appUid?: string;
  appName?: string;
  /** Resolved lazily, right before an app:uninstall command needing --installation-uid runs — only knowable after a real app:install happened during execution. */
  appInstallationUid?: string;
  /** Set only for the taxonomy-migration doc — the real downloaded sample script + base CSV (comma). substitute.ts derives its own per-invocation, uid-suffixed (and optionally pipe-delimited) copies from this. */
  taxonomyMigrationScriptPath?: string;
  taxonomyMigrationCsvPath?: string;
  /** Set only for the update-missing-reference-uids doc — the real downloaded fixup script + real config.json pointing at a genuine backup/mapper dir from a real prior import. */
  referenceFixScriptPath?: string;
  referenceFixConfigPath?: string;
  /** Set only for docs (needsSourceExport) that separately need the ORIGINAL source stack's real API key — after prepareImportDoc runs, ctx.stackApiKey itself becomes the destination stack's key. */
  sourceStackApiKeyForMigration?: string;
  /** Set only for migrate-content-between-stacks-using-the-cli — a second, empty destination stack's real API key (ctx.stackApiKey stays the original/source stack for this doc, unlike needsSourceExport). */
  migrateTargetStackApiKey?: string;
}

export const ALIAS = "production"; // the alias the doc's examples use verbatim
export const CONTENT_TYPES = ["blog_post", "article", "product_page"]; // the doc's dummy UIDs, made real

export async function seed(): Promise<SeedContext> {
  const stackName = `cli-automation-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
  console.log(`  Creating stack "${stackName}"…`);
  const { apiKey } = await createStack(stackName);

  try {
    let sampleEntryUid = "";
    for (const uid of CONTENT_TYPES) {
      const title = uid.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      await createContentType(apiKey, uid, title);
      const uid1 = await createEntry(apiKey, uid, `${title} One`);
      await createEntry(apiKey, uid, `${title} Two`);
      if (!sampleEntryUid) sampleEntryUid = uid1; // first blog_post entry
    }
    console.log(`  Content types seeded: ${CONTENT_TYPES.join(", ")} (2 entries each)`);

    const environments = ["production", "development"];
    for (const e of environments) await createEnvironment(apiKey, e);
    await createLabel(apiKey, "cli-automation-label", CONTENT_TYPES);
    await uploadAsset(apiKey, "cli-automation-sample.txt", "Sample asset seeded by cli-automation.\n");
    console.log("  Environments, label, asset seeded");

    const deliveryToken = await createDeliveryToken(apiKey, "production");
    console.log("  Delivery token created (scoped to production)");

    const branch = await tryCreateBranch(apiKey, "develop");
    console.log(
      branch.ok ? "  Branch develop created" : `  Branches unavailable on this plan (${branch.error})`
    );
    const realBranch = branch.ok ? "develop" : "main";

    // The doc's dummy "developAlias" is itself impossible (alias UIDs must be
    // lowercase — reported by the lint); create the closest real alias.
    const aliasOk = await createBranchAlias(apiKey, "developalias", realBranch);
    console.log(aliasOk ? `  Branch alias developalias → ${realBranch}` : "  Branch alias creation unavailable");

    console.log("  Creating management token…");
    const managementToken = await createManagementToken(apiKey);

    console.log("  csdx: set region + login…");
    await csdxLogin();
    console.log(`  csdx: registering token alias "${ALIAS}"…`);
    await addTokenAlias(ALIAS, apiKey, managementToken);

    return {
      stackApiKey: apiKey,
      stackName,
      alias: ALIAS,
      managementToken,
      contentTypes: CONTENT_TYPES,
      environments,
      branchesSupported: branch.ok,
      branchError: branch.error,
      realBranch,
      realBranchAlias: aliasOk ? "developalias" : undefined,
      sampleEntryUid,
      deliveryToken,
    };
  } catch (err) {
    // Don't leave a half-seeded stack behind in the shared QA org.
    console.error("  Seed failed — deleting stack…");
    await deleteStack(apiKey).catch(() => {});
    throw err;
  }
}

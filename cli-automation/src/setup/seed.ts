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
}

export const ALIAS = "production"; // the alias the doc's examples use verbatim
export const CONTENT_TYPES = ["blog_post", "article", "product_page"]; // the doc's dummy UIDs, made real

export async function seed(): Promise<SeedContext> {
  const stackName = `cli-automation-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
  console.log(`  Creating stack "${stackName}"…`);
  const { apiKey } = await createStack(stackName);

  try {
    for (const uid of CONTENT_TYPES) {
      const title = uid.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      await createContentType(apiKey, uid, title);
      await createEntry(apiKey, uid, `${title} One`);
      await createEntry(apiKey, uid, `${title} Two`);
    }
    console.log(`  Content types seeded: ${CONTENT_TYPES.join(", ")} (2 entries each)`);

    const environments = ["production", "development"];
    for (const e of environments) await createEnvironment(apiKey, e);
    await createLabel(apiKey, "cli-automation-label", CONTENT_TYPES);
    await uploadAsset(apiKey, "cli-automation-sample.txt", "Sample asset seeded by cli-automation.\n");
    console.log("  Environments, label, asset seeded");

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
    };
  } catch (err) {
    // Don't leave a half-seeded stack behind in the shared QA org.
    console.error("  Seed failed — deleting stack…");
    await deleteStack(apiKey).catch(() => {});
    throw err;
  }
}

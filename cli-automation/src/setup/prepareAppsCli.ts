/**
 * Extra setup specific to the apps-cli-plugin doc.
 *
 * The doc's full lifecycle (create → get → install → update → deploy →
 * reinstall → uninstall → delete) needs a REAL Developer Hub app to exist
 * before any of the later commands can be tested meaningfully — none of
 * that is inline-executable from the doc's own text alone (app:create's
 * bare command still needs --boilerplate + a real "fetch from GitHub?"
 * confirmation to run non-interactively). So this:
 *
 *  1. runs a real `csdx app:create` for a genuine, disposable stack app
 *  2. looks up its real app UID via the Developer Hub API (csdx doesn't
 *     print it directly, and later commands need --app-uid)
 */
import { getAuthtoken } from "../api/contentstack.js";
import { run } from "./csdx.js";

export interface AppsCliResult {
  appUid: string;
  appName: string;
}

export async function prepareAppsCli(orgId: string, runDir: string): Promise<AppsCliResult> {
  const appName = `cli-auto-${Date.now().toString(36).slice(-6)}`; // must be 3-20 chars — verified by hand
  console.log(`  Creating a real Developer Hub app "${appName}" for the apps-cli-plugin doc's lifecycle…`);
  const createResult = await run(`csdx app:create --name "${appName}" --org ${orgId} --app-type stack --boilerplate "App Boilerplate"`, {
    cwd: runDir,
    timeoutMs: 3 * 60 * 1000,
  });
  if (createResult.exitCode !== 0) {
    throw new Error(`Pre-run app:create for apps-cli-plugin doc failed: ${createResult.output.slice(-400)}`);
  }

  const authtoken = await getAuthtoken();
  const res = await fetch(`https://developerhub-api.contentstack.com/manifests?organization_uid=${orgId}`, {
    headers: { authtoken, organization_uid: orgId },
  });
  const data = await res.json();
  const app = (data.data ?? []).find((a: any) => a.name === appName);
  if (!app) throw new Error(`Could not find created app "${appName}" via Developer Hub API after app:create reported success`);

  return { appUid: app.uid as string, appName };
}

/** Find the real installation UID for an app on a stack — needed lazily, right before app:uninstall runs (not known until after a real app:install). */
export async function findInstallationUid(orgId: string, stackApiKey: string, appUid: string): Promise<string | undefined> {
  const lookup = async (forceRefresh: boolean) => {
    const authtoken = await getAuthtoken(forceRefresh);
    const res = await fetch(`https://developerhub-api.contentstack.com/installations?target_uid=${stackApiKey}&target_type=stack`, {
      headers: { authtoken, organization_uid: orgId },
    });
    if (res.status === 401) return undefined;
    const data = await res.json();
    const installation = (data.data ?? []).find((i: any) => i.manifest?.uid === appUid);
    return installation?.uid as string | undefined;
  };
  // A cached Management token can go stale over a long-running doc's
  // lifetime the same way the csdx CLI's own session can — retry once with
  // a forced refresh before concluding "not installed".
  return (await lookup(false)) ?? (await lookup(true));
}

/** Find a Developer Hub app by exact name — used to clean up the extra apps app:create's own flagged examples create (distinct from the one prepareAppsCli makes up front). */
export async function findAppByName(orgId: string, name: string): Promise<{ uid: string } | undefined> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`https://developerhub-api.contentstack.com/manifests?organization_uid=${orgId}`, {
    headers: { authtoken, organization_uid: orgId },
  });
  const data = await res.json();
  const app = (data.data ?? []).find((a: any) => a.name === name);
  return app ? { uid: app.uid as string } : undefined;
}

export async function deleteDevHubApp(orgId: string, appUid: string): Promise<boolean> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`https://developerhub-api.contentstack.com/manifests/${appUid}`, {
    method: "DELETE",
    headers: { authtoken, organization_uid: orgId },
  });
  return res.status === 200;
}

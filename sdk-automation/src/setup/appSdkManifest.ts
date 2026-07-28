/**
 * Marketplace-app plumbing specific to the App SDK doc automation - creating
 * an app whose `ui_location` actually renders our test-harness bundle
 * (testapp/) inside the real Contentstack UI, for the 5 in-scope locations
 * (CustomField/SidebarWidget/FieldModifierLocation/DashboardWidget/FullPage).
 *
 * Two real API quirks discovered via live trial-and-error against the
 * DeveloperHub API (developerhub-api.contentstack.com, no /v3 prefix,
 * organization_uid as a header - see marketplaceDisposable.ts) - neither
 * documented anywhere:
 *  - `ui_location.base_url` is NOT derived from `hosting.deployment_url`
 *    except at the moment an app is first created (with the default
 *    `http://localhost:3000`). Any later `ui_location` update MUST include
 *    `base_url` explicitly in the same payload, or it 400s with
 *    "ui_location.base_url is invalid" even if `hosting.deployment_url` was
 *    just set correctly in a prior call.
 *  - Each location's real `data_type`/`allowed_types`/`default_width`
 *    requirements, and the valid `type` enum itself
 *    (`cs.cm.stack.custom_field`, `cs.cm.stack.sidebar`,
 *    `cs.cm.stack.dashboard`, `cs.cm.stack.field_modifier`,
 *    `cs.cm.stack.full_page`, plus `cs.cm.stack.config`, `cs.cm.stack.rte`,
 *    `cs.cm.stack.asset_sidebar`, `cs.org.global_full_page`,
 *    `cs.cm.stack.content_type_sidebar`, ... for the deferred locations),
 *    only surfaced via real 400 responses - undocumented on the Marketplace
 *    SDK doc or the App SDK doc.
 *
 * After installing, the CustomField location's real `extension_uid` (needed
 * to bind a content-type field to this app - a plain `data_type` +
 * `extension_uid` schema entry, same mechanism as the legacy Extensions API)
 * is only exposed via the INSTALLATION record (`GET /installations/{uid}`),
 * not the manifest itself and not `GET /v3/extensions` (which stays empty
 * for app-based custom fields).
 *
 * CRITICAL, only discovered via live end-to-end testing: each location's
 * generated Extension record has its own `src` (the actual iframe URL the
 * real Contentstack UI loads) that is captured ONCE at install time and
 * does NOT follow later `configureAppLocations()` calls on an
 * already-installed app - confirmed by fetching `GET /v3/extensions/{uid}`
 * directly and seeing a stale `src` persist through multiple `ui_location`
 * updates, fresh browser contexts, and hard page reloads. The only way to
 * refresh it is a full uninstall + reinstall (which generates brand-new
 * Extension records with the CURRENT `ui_location.base_url` baked in as
 * `src`) - `installApp()` below always does this, it is never a no-op
 * "skip if already installed" like the Marketplace SDK doc's pattern.
 * Since the tunnel URL is different every run (see appSdkTunnel.ts), the
 * CustomField content-type field's `extension_uid` must also be refreshed
 * (removed + re-added) after every reinstall - see seedAppSdkStack.ts.
 */
import { getAuthtoken } from "./contentstack.js";

const HOST = "https://developerhub-api.contentstack.com";

async function api(method: string, path: string, body: unknown, orgUid: string): Promise<{ status: number; data: any }> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: { "Content-Type": "application/json", authtoken, organization_uid: orgUid },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export async function findAppByName(orgUid: string, name: string): Promise<{ uid: string } | undefined> {
  const { status, data } = await api("GET", "/manifests", undefined, orgUid);
  if (status !== 200) return undefined;
  const match = (data.data ?? []).find((a: any) => a.name === name);
  return match ? { uid: match.uid } : undefined;
}

export async function createApp(orgUid: string, name: string): Promise<{ uid: string }> {
  const { status, data } = await api("POST", "/manifests", { name, description: "sdk-automation App SDK test harness", target_type: "stack" }, orgUid);
  if (status !== 200 && status !== 201) throw new Error(`app create failed: ${status} ${JSON.stringify(data).slice(0, 300)}`);
  const uid = (data.data ?? data).uid as string;
  if (!uid) throw new Error(`app create returned no uid: ${JSON.stringify(data).slice(0, 300)}`);
  return { uid };
}

/** The 5 in-scope UI locations, each pointing at `baseUrl` (the current tunnel URL - changes every run). */
export async function configureAppLocations(orgUid: string, appUid: string, baseUrl: string): Promise<void> {
  const hosting = await api("PUT", `/manifests/${appUid}`, { hosting: { provider: "external", deployment_url: baseUrl } }, orgUid);
  if (hosting.status !== 200) throw new Error(`set hosting failed: ${hosting.status} ${JSON.stringify(hosting.data).slice(0, 300)}`);

  const uiLocation = await api(
    "PUT",
    `/manifests/${appUid}`,
    {
      ui_location: {
        base_url: baseUrl,
        locations: [
          { type: "cs.cm.stack.custom_field", meta: [{ name: "SDK Auto Field", path: "/", signed: false, enabled: true, data_type: "json" }] },
          { type: "cs.cm.stack.sidebar", meta: [{ name: "SDK Auto Sidebar", path: "/", signed: false, enabled: true }] },
          { type: "cs.cm.stack.dashboard", meta: [{ name: "SDK Auto Dashboard", path: "/", signed: false, enabled: true, default_width: "full" }] },
          { type: "cs.cm.stack.field_modifier", meta: [{ name: "SDK Auto FieldMod", path: "/", signed: false, enabled: true, allowed_types: ["$all"] }] },
          { type: "cs.cm.stack.full_page", meta: [{ name: "SDK Auto FullPage", path: "/", signed: false, enabled: true }] },
        ],
      },
    },
    orgUid
  );
  if (uiLocation.status !== 200) throw new Error(`set ui_location failed: ${uiLocation.status} ${JSON.stringify(uiLocation.data).slice(0, 500)}`);
}

export async function findInstallation(orgUid: string, appUid: string, stackApiKey: string): Promise<{ uid: string } | undefined> {
  const { status, data } = await api("GET", "/installations", undefined, orgUid);
  if (status !== 200) return undefined;
  const match = (data.data ?? []).find((i: any) => i.manifest?.uid === appUid && i.target?.uid === stackApiKey);
  return match ? { uid: match.uid } : undefined;
}

/** Always uninstalls first if already installed, then reinstalls fresh - see the module doc comment on why this can't be a "skip if already installed" idempotent check like the Marketplace SDK doc's pattern. */
export async function installApp(orgUid: string, appUid: string, stackApiKey: string): Promise<{ uid: string }> {
  const existingBefore = await findInstallation(orgUid, appUid, stackApiKey);
  if (existingBefore) await api("DELETE", `/installations/${existingBefore.uid}`, undefined, orgUid);

  const { status, data } = await api("POST", `/manifests/${appUid}/install`, { target_uid: stackApiKey, target_type: "stack" }, orgUid);
  if (status !== 200 && status !== 201) throw new Error(`install failed: ${status} ${JSON.stringify(data).slice(0, 300)}`);
  const existing = await findInstallation(orgUid, appUid, stackApiKey);
  if (!existing) throw new Error("install succeeded but no matching installation record found");
  return existing;
}

/** Real per-location extension_uid values (needed for CustomField's content-type schema binding) - only exposed via the installation record. */
export async function getInstallationExtensionUids(orgUid: string, installationUid: string): Promise<Record<string, string>> {
  const { status, data } = await api("GET", `/installations/${installationUid}`, undefined, orgUid);
  if (status !== 200) throw new Error(`get installation failed: ${status} ${JSON.stringify(data).slice(0, 300)}`);
  const out: Record<string, string> = {};
  for (const loc of data.data?.ui_location?.locations ?? []) {
    const extUid = loc.meta?.[0]?.extension_uid;
    if (extUid) out[loc.type] = extUid;
  }
  return out;
}

export async function uninstallApp(orgUid: string, installationUid: string): Promise<void> {
  await api("DELETE", `/installations/${installationUid}`, undefined, orgUid);
}

export async function deleteApp(orgUid: string, appUid: string): Promise<void> {
  await api("DELETE", `/manifests/${appUid}`, undefined, orgUid);
}

/**
 * Create-then-delete plumbing for the Marketplace SDK doc, mirroring
 * disposableResource.ts's approach for the Management SDK doc. Marketplace
 * apps ("manifests") are ORGANIZATION-scoped, not stack-scoped - the API is
 * `POST/GET/PUT/DELETE /manifests` (no `/v3` prefix - unlike the CMA host)
 * on the DeveloperHub host, with `organization_uid` sent as an
 * HTTP HEADER (confirmed from the cloned repo's lib/marketplace/index.js:
 * `this.params = { organization_uid }`, then passed to axios as `headers:
 * {...this.params}` in every call - not as a query param, despite that
 * being the more common Contentstack convention for scoping).
 *
 * Only App (create/fetch/update/delete) and Installation (via App.install())
 * are implemented - the two resource types this project can safely create
 * and clean up in the shared QA org. Deployment/Hosting (real code bundles)
 * and OAuth authorize (needs a real user-consent redirect) are out of scope
 * for automated execution - see the doc-bugs report.
 *
 * IMPORTANT: unlike ContentType/Entry/Asset in the Management SDK doc
 * (cheap, effectively unlimited per stack), apps are a SCARCE org-wide
 * resource - a real run hit "you have reached the maximum number of
 * allowed apps" with the org already sitting at 50 apps (from years of
 * other teams'/automations' test/demo apps, not just this project's). So
 * there is no separate "create a throwaway app just to delete it" - App >
 * delete instead reuses the ONE persistent seeded app (see
 * seedMarketplaceStack.ts), run as the LAST method of the whole doc run
 * (index.ts reorders it to the end), so every other App-section snippet
 * that depends on the app existing runs first.
 */
import { getAuthtoken } from "./contentstack.js";

// Marketplace apps ("manifests") live on the DeveloperHub API, not the
// regular CMA host (api.contentstack.io) - confirmed via
// lib/contentstack.js's client(): `getContentstackEndpoint(region,
// 'developerHub', true)` resolves to this host by default. Every one of
// this doc's `contentstack.client({ authtoken })` examples relies on that
// default with no host override, so this is the real host readers hit too.
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

async function retryUntilTrue(check: () => Promise<boolean>, attempts = 3, delayMs = 1500): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return true;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

/** The org enforces a low max-apps quota (confirmed via a real "you have reached the maximum number of allowed apps" 400) - list first and reuse by name rather than creating a fresh app per seed run. */
export async function findAppByName(orgUid: string, name: string): Promise<{ uid: string } | undefined> {
  const { status, data } = await api("GET", "/manifests", undefined, orgUid);
  if (status !== 200) return undefined;
  const match = (data.data ?? []).find((a: any) => a.name === name);
  return match ? { uid: match.uid } : undefined;
}

export async function createDisposableApp(orgUid: string, name?: string): Promise<{ uid: string }> {
  // The Marketplace API enforces `name` <= 20 chars (discovered via a real
  // 400 response) - not documented on this doc page at all. A name isn't
  // passed for the transient create-then-delete case (App > delete), where
  // uniqueness matters more than a fixed, reusable name.
  const stamp = Date.now().toString().slice(-8);
  const { status, data } = await api(
    "POST",
    "/manifests",
    // target_type must be "stack" (not "organization") for the app to be
    // installable onto a stack via installApp() below - an org-scoped app
    // can only ever be installed at the org level (discovered via a real
    // "Installation target not supported" 400 when this was "organization").
    { name: name ?? `SDK App ${stamp}`, description: "Disposable app created by sdk-automation for the Marketplace SDK doc.", target_type: "stack" },
    orgUid
  );
  if (status !== 200 && status !== 201) throw new Error(`disposable app create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  const uid = (data.data ?? data).uid as string;
  if (!uid) throw new Error(`disposable app create returned no uid: ${JSON.stringify(data).slice(0, 200)}`);
  return { uid };
}

function isNotFoundResponse(status: number, data: any): boolean {
  return status === 404 || (status >= 400 && /not found/i.test(JSON.stringify(data)));
}

/** Confirms an app is actually gone (does NOT delete it itself) - for verifying the doc's own delete snippet worked. */
export async function verifyAppDeleted(orgUid: string, uid: string): Promise<boolean> {
  return retryUntilTrue(async () => {
    const r = await api("GET", `/manifests/${uid}`, undefined, orgUid);
    return isNotFoundResponse(r.status, r.data);
  });
}

/** Deletes an app directly (not via the doc's snippet) - for manual cleanup, e.g. after a run where the doc's delete snippet itself failed. */
export async function deleteApp(orgUid: string, uid: string): Promise<boolean> {
  const { status, data } = await api("DELETE", `/manifests/${uid}`, undefined, orgUid);
  if (status !== 200 && !isNotFoundResponse(status, data)) return false;
  return verifyAppDeleted(orgUid, uid);
}

/**
 * Installs the given app onto a stack, returning the resulting
 * installation's uid - real fixture data for the Installation nav section.
 * The install response itself doesn't echo the installation's own uid (just
 * confirms success) - the org-wide `GET /installations` list (not
 * documented on this doc page at all) is what actually exposes it, matched
 * back by `manifest.uid`.
 */
export async function installApp(orgUid: string, appUid: string, stackApiKey: string): Promise<{ uid: string } | undefined> {
  const { status, data } = await api("POST", `/manifests/${appUid}/install`, { target_uid: stackApiKey, target_type: "stack" }, orgUid);
  // "Installation for app is already done" (400) is not a failure for our
  // purposes - a previous seed run already installed this same persistent
  // app onto this same stack, and re-installing isn't necessary.
  const alreadyInstalled = status === 400 && /already (done|installed)/i.test(JSON.stringify(data));
  if (status !== 200 && status !== 201 && !alreadyInstalled) return undefined;

  const list = await api("GET", "/installations", undefined, orgUid);
  if (list.status !== 200) return undefined;
  const match = (list.data.data ?? []).find((i: any) => i.manifest?.uid === appUid && i.target?.uid === stackApiKey);
  return match?.uid ? { uid: match.uid } : undefined;
}

export interface MarketplaceDisposable {
  overrides: Record<string, string>;
  verifyDeleted: () => Promise<boolean>;
}

/**
 * OAuth authorizations are NOT a scarce org-wide resource the way apps
 * are - unlike App > delete (which must reuse the one persistent app),
 * this can genuinely create-then-delete a fresh authorization per run.
 *
 * Getting there needed two real API calls this doc never documents at
 * all: `PUT /manifests/{app_uid}/oauth` (confirmed via the marketplace-sdk
 * repo's own `test/sanity-check/api/app-test.js`, since the scopes this API
 * accepts - e.g. `user:read`, `scim:manage` - aren't listed on this doc
 * page and a first attempt with made-up scope names 400'd with "invalid
 * app_token_config"/"invalid user_token_config") to turn OAuth on for the
 * app at all, and `POST /manifests/{app_uid}/authorize` (confirmed via the
 * SDK's own `App.authorize()` source) to actually grant an authorization -
 * this second call needed no real browser/user-consent redirect, since the
 * authenticated authtoken making the call IS the consenting user; it
 * returns a `redirect_url` with a `code` query param (the OAuth
 * authorization-code flow's final step), and the authorization record
 * itself becomes immediately visible via `GET /manifests/{app_uid}/authorizations`.
 */
async function ensureOauthConfigured(orgUid: string, appUid: string): Promise<{ clientId: string }> {
  const existing = await api("GET", `/manifests/${appUid}/oauth`, undefined, orgUid);
  if (existing.status === 200 && existing.data?.data?.client_id) {
    return { clientId: existing.data.data.client_id as string };
  }
  const { status, data } = await api(
    "PUT",
    `/manifests/${appUid}/oauth`,
    {
      redirect_uri: "https://example.com/oauth/callback",
      app_token_config: { enabled: false, scopes: [] },
      user_token_config: { enabled: true, scopes: ["user:read"], allow_pkce: true },
    },
    orgUid
  );
  if (status !== 200 && status !== 201) throw new Error(`oauth config failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return { clientId: (data.data ?? data).client_id as string };
}

export async function prepareAuthorizationDisposable(orgUid: string, appUid: string): Promise<MarketplaceDisposable> {
  const { clientId } = await ensureOauthConfigured(orgUid, appUid);
  const { status, data } = await api(
    "POST",
    `/manifests/${appUid}/authorize`,
    { response_type: "code", client_id: clientId, redirect_uri: "https://example.com/oauth/callback", scope: "user:read" },
    orgUid
  );
  if (status !== 200 && status !== 201) throw new Error(`disposable authorization create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);

  const list = await api("GET", `/manifests/${appUid}/authorizations`, undefined, orgUid);
  if (list.status !== 200) throw new Error(`could not list authorizations to find the new one: ${list.status}`);
  const authorizations = (list.data.data ?? []) as any[];
  const authorizationUid = authorizations[authorizations.length - 1]?.authorization_uid as string | undefined;
  if (!authorizationUid) throw new Error(`authorize succeeded but no authorization_uid found in ${JSON.stringify(list.data).slice(0, 200)}`);

  return {
    overrides: { authorizationUid, authorization_uid: authorizationUid, uid: authorizationUid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/manifests/${appUid}/authorizations`, undefined, orgUid);
        if (r.status !== 200) return false;
        return !(r.data.data ?? []).some((a: any) => a.authorization_uid === authorizationUid);
      }),
  };
}

/** "App > delete" reuses the one persistent seeded app (see the scarce-apps note above). "App > deleteAuthorization" creates-then-deletes a fresh OAuth authorization instead, which is NOT scarce the same way. */
export function hasMarketplaceDisposableSupport(navSection: string, method: string): boolean {
  return navSection === "App" && (method === "delete" || method === "deleteAuthorization");
}

/** Reuses the persistent seeded app (MKT_APP_UID) rather than creating a new one - see the scarce-apps note above. Must run LAST, since every other App-section snippet depends on this app still existing. */
export async function prepareMarketplaceDisposable(orgUid: string, existingAppUid: string): Promise<MarketplaceDisposable> {
  return {
    overrides: { manifest_uid: existingAppUid, app_uid: existingAppUid },
    verifyDeleted: async () => verifyAppDeleted(orgUid, existingAppUid),
  };
}

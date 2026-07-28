/**
 * Create-then-delete plumbing for the Management SDK doc's destructive
 * methods. Covers ContentType/Entry/Asset/Webhook/Label/GlobalField (all 4
 * languages, modulo per-language placeholder support - see
 * translateDisposableOverrides) plus Extension/Release/Taxonomy (JS/Python
 * only so far). Every other section's delete/remove methods are still
 * skipped in index.ts rather than run against real data - this remains
 * intentionally incremental, not full coverage of every destructive method
 * across every section.
 *
 * Each entry creates a fresh, single-use resource immediately before its
 * delete snippet runs, returns the real UID(s) to substitute into that one
 * snippet (via runManagementSnippet's overridePlaceholders - never the
 * global placeholder map, since e.g. `uid` means a different resource in
 * nearly every section), and verifies afterward that the resource is
 * actually gone - not just that the snippet didn't throw.
 */
import { getAuthtoken } from "./contentstack.js";

const HOSTS: Record<string, string> = {
  "AWS-NA": "https://api.contentstack.io",
  "AWS-EU": "https://eu-api.contentstack.com",
  "AWS-AU": "https://au-api.contentstack.com",
  "AZURE-NA": "https://azure-na-api.contentstack.com",
  "AZURE-EU": "https://azure-eu-api.contentstack.com",
  "GCP-NA": "https://gcp-na-api.contentstack.com",
  "GCP-EU": "https://gcp-eu-api.contentstack.com",
};
function host(): string {
  return HOSTS[process.env.CONTENTSTACK_REGION ?? "AWS-NA"] ?? HOSTS["AWS-NA"];
}

async function api(method: string, path: string, body: unknown, apiKey: string): Promise<{ status: number; data: any }> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${host()}/v3${path}`, {
    method,
    headers: { "Content-Type": "application/json", authtoken, api_key: apiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** Retries a "is it actually gone yet" check a few times with a short delay - a delete can succeed but not be immediately reflected by a follow-up GET (eventual consistency). */
async function retryUntilTrue(check: () => Promise<boolean>, attempts = 3, delayMs = 1500): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return true;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

/**
 * Contentstack's Management API doesn't use a plain 404 for "not found" on
 * content types/entries - it returns 422 (error_code 141) with an
 * error_message that varies by resource type: content types say "...was
 * not found...", entries say "The requested object doesn't exist."
 * (confirmed via raw GET calls on a just-deleted content type and entry).
 * Checking `status === 404` alone, or too narrow a message regex, made
 * deletions look unverified even though they'd genuinely worked - this was
 * a bug in the verification check itself, not the SDK or the doc.
 */
function isNotFoundResponse(status: number, data: any): boolean {
  if (status === 404) return true;
  return status === 422 && /was not found|doesn.t exist|error_code":141/i.test(JSON.stringify(data));
}

export interface DisposableResource {
  overrides: Record<string, string>;
  /** Confirms the resource is actually gone (404) after the doc's delete snippet ran - not just that it didn't throw. */
  verifyDeleted: () => Promise<boolean>;
}

export type DisposableFactory = (apiKey: string) => Promise<DisposableResource>;

const contentTypeDisposable: DisposableFactory = async (apiKey) => {
  const stamp = Date.now();
  const uid = `disposable_ct_${stamp}`;
  const { status, data } = await api(
    "POST",
    "/content_types",
    // The title must be unique per stack, same as the uid - a fixed title
    // across reruns hits "title is not unique" (422) once the first
    // disposable content type has ever been created and not cleaned up.
    { content_type: { title: `Disposable Content Type ${stamp}`, uid, schema: [{ display_name: "Title", uid: "title", data_type: "text", mandatory: true, unique: true }] } },
    apiKey
  );
  if (status !== 201) throw new Error(`disposable content type create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return {
    overrides: { content_type_uid: uid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/content_types/${uid}`, undefined, apiKey);
        return isNotFoundResponse(r.status, r.data);
      }),
  };
};

const entryDisposable: DisposableFactory = async (apiKey) => {
  const contentTypeUid = process.env.MGMT_CONTENT_TYPE_UID ?? "blog_post";
  const { status, data } = await api(
    "POST",
    `/content_types/${contentTypeUid}/entries`,
    { entry: { title: `Disposable Entry ${Date.now()}` } },
    apiKey
  );
  if (status !== 201) throw new Error(`disposable entry create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  const uid = data.entry.uid as string;
  return {
    overrides: { content_type_uid: contentTypeUid, uid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/content_types/${contentTypeUid}/entries/${uid}`, undefined, apiKey);
        return isNotFoundResponse(r.status, r.data);
      }),
  };
};

const assetDisposable: DisposableFactory = async (apiKey) => {
  const authtoken = await getAuthtoken();
  const form = new FormData();
  form.append("asset[upload]", new Blob([`disposable fixture ${Date.now()}`], { type: "text/plain" }), "disposable-fixture.txt");
  const res = await fetch(`${host()}/v3/assets`, { method: "POST", headers: { authtoken, api_key: apiKey }, body: form });
  const data = await res.json();
  if (res.status !== 201) throw new Error(`disposable asset upload failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  const uid = data.asset.uid as string;
  return {
    overrides: { uid },
    verifyDeleted: async () => (await api("GET", `/assets/${uid}`, undefined, apiKey)).status === 404,
  };
};

const webhookDisposable: DisposableFactory = async (apiKey) => {
  const { status, data } = await api(
    "POST",
    "/webhooks",
    {
      webhook: {
        name: `disposable-webhook-${Date.now()}`,
        destinations: [{ target_url: "https://example.com/sdk-automation-disposable-webhook" }],
        channels: ["assets.create"],
        disabled: true,
        // Required by the API despite not being documented as such on any
        // of the four Management SDK docs' `Webhook > create` examples -
        // confirmed via a raw create call that failed with "Path `retry_policy`
        // is required" until this was added.
        retry_policy: "manual",
      },
    },
    apiKey
  );
  if (status !== 201) throw new Error(`disposable webhook create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  const uid = data.webhook.uid as string;
  return {
    overrides: { webhook_uid: uid, uid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/webhooks/${uid}`, undefined, apiKey);
        return isNotFoundResponse(r.status, r.data);
      }),
  };
};

const labelDisposable: DisposableFactory = async (apiKey) => {
  const contentTypeUid = process.env.MGMT_CONTENT_TYPE_UID ?? "blog_post";
  const { status, data } = await api(
    "POST",
    "/labels",
    { label: { name: `disposable-label-${Date.now()}`, content_types: [contentTypeUid] } },
    apiKey
  );
  if (status !== 201) throw new Error(`disposable label create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  const uid = data.label.uid as string;
  return {
    overrides: { label_uid: uid, uid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/labels/${uid}`, undefined, apiKey);
        return isNotFoundResponse(r.status, r.data);
      }),
  };
};

const globalFieldDisposable: DisposableFactory = async (apiKey) => {
  const stamp = Date.now();
  const uid = `disposable_gf_${stamp}`;
  const { status, data } = await api(
    "POST",
    "/global_fields",
    { global_field: { title: `Disposable Global Field ${stamp}`, uid, schema: [{ display_name: "Title", uid: "title", data_type: "text", mandatory: true }] } },
    apiKey
  );
  if (status !== 201) throw new Error(`disposable global field create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return {
    overrides: { global_field_uid: uid, uid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/global_fields/${uid}`, undefined, apiKey);
        return isNotFoundResponse(r.status, r.data);
      }),
  };
};

const extensionDisposable: DisposableFactory = async (apiKey) => {
  const { status, data } = await api(
    "POST",
    "/extensions",
    { extension: { tags: ["disposable"], data_type: "text", title: `Disposable Extension ${Date.now()}`, type: "field", src: "https://example.com/sdk-automation-disposable-extension.html" } },
    apiKey
  );
  if (status !== 201) throw new Error(`disposable extension create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  const uid = data.extension.uid as string;
  return {
    overrides: { extension_uid: uid, uid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/extensions/${uid}`, undefined, apiKey);
        return isNotFoundResponse(r.status, r.data);
      }),
  };
};

const releaseDisposable: DisposableFactory = async (apiKey) => {
  const { status, data } = await api(
    "POST",
    "/releases",
    { release: { name: `Disposable Release ${Date.now()}`, locked: false, items: [] } },
    apiKey
  );
  if (status !== 201) throw new Error(`disposable release create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  const uid = data.release.uid as string;
  return {
    overrides: { release_uid: uid, uid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/releases/${uid}`, undefined, apiKey);
        return isNotFoundResponse(r.status, r.data);
      }),
  };
};

const taxonomyDisposable: DisposableFactory = async (apiKey) => {
  const stamp = Date.now();
  const uid = `disposable_tax_${stamp}`;
  const { status, data } = await api(
    "POST",
    "/taxonomies",
    { taxonomy: { uid, name: `Disposable Taxonomy ${stamp}`, description: "disposable" } },
    apiKey
  );
  if (status !== 201 && status !== 200) throw new Error(`disposable taxonomy create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return {
    // JS/Python's own doc examples use the literal camelCase placeholder
    // 'taxonomyUid' for this section specifically (confirmed by reading the
    // rendered page) - inconsistent with e.g. Workflow's snake_case
    // 'workflow_uid' in the very same doc. Both spellings are included so
    // whichever one a given snippet actually uses gets substituted.
    overrides: { taxonomyUid: uid, taxonomy_uid: uid, uid },
    verifyDeleted: () =>
      retryUntilTrue(async () => {
        const r = await api("GET", `/taxonomies/${uid}`, undefined, apiKey);
        return isNotFoundResponse(r.status, r.data);
      }),
  };
};

/**
 * Keyed by a normalized resource-type name, not the exact navSection string
 * - the same logical section is spelled differently across the four
 * Management SDK docs (e.g. "Contenttype" / "Content Types", "Webhook" /
 * "Webhooks", "Globalfield" / "Globalfields" / "Global Fields"). Dispatch
 * only happens once the caller has already confirmed the method itself is
 * destructive (delete/remove/destroy), so matching on section alone -
 * without also checking the method name - is safe and avoids having to
 * enumerate every language's exact spelling for both parts of the key.
 */
const REGISTRY: Record<string, DisposableFactory> = {
  contenttype: contentTypeDisposable,
  entry: entryDisposable,
  asset: assetDisposable,
  webhook: webhookDisposable,
  label: labelDisposable,
  globalfield: globalFieldDisposable,
  extension: extensionDisposable,
  release: releaseDisposable,
  taxonomy: taxonomyDisposable,
};

export function normalizeSection(navSection: string): string {
  const stripped = navSection.toLowerCase().replace(/[^a-z]/g, "");
  if (stripped === "entries") return "entry";
  return stripped.replace(/s$/, "");
}

export function hasDisposableSupport(navSection: string, _method: string): boolean {
  return normalizeSection(navSection) in REGISTRY;
}

export async function prepareDisposable(navSection: string, method: string, apiKey: string): Promise<DisposableResource> {
  const factory = REGISTRY[normalizeSection(navSection)];
  if (!factory) throw new Error(`No disposable-resource factory registered for ${navSection}>${method}`);
  return factory(apiKey);
}

/**
 * Translates a disposable resource's generic snake_case overrides
 * (`uid`, `content_type_uid`, `webhook_uid`, `label_uid`, `global_field_uid`)
 * into the placeholder key format each language's own doc actually uses -
 * confirmed per-language by reading each doc's real rendered examples
 * rather than assumed:
 *   - JS/Python: identical snake_case keys already (no translation needed).
 *   - Java: bare identifiers named per-resource-type (`entry_uid`, `asset_uid`,
 *     `content_type_uid`) - confirmed Java's own Label/Webhook delete
 *     examples never pass a UID argument at all (`contentstack.stack().label()`),
 *     so those two are NOT translated here (there's no placeholder to
 *     substitute; a real code-injection fix would be needed instead, out of
 *     scope for this pass) - only entry/asset/contenttype are covered.
 *   - .NET: angle-bracket-wrapped tokens (`<ENTRY_UID>`, `<ASSET_UID>`,
 *     `<CONTENT_TYPE_UID>`, `<WEBHOOK_UID>`, `<LABEL_UID>`, `<GLOBAL_FIELD_UID>`).
 */
export function translateDisposableOverrides(navSection: string, generic: Record<string, string>, style: "js" | "python" | "java" | "dotnet"): Record<string, string> {
  if (style === "js" || style === "python") return generic;
  const section = normalizeSection(navSection);
  if (style === "java") {
    if (section === "entry") return { entry_uid: generic.uid, content_type_uid: generic.content_type_uid ?? "" };
    if (section === "asset") return { asset_uid: generic.uid };
    if (section === "contenttype") return { content_type_uid: generic.uid };
    return {};
  }
  // style === "dotnet"
  if (section === "entry") return { "<ENTRY_UID>": generic.uid, "<CONTENT_TYPE_UID>": generic.content_type_uid ?? "" };
  if (section === "asset") return { "<ASSET_UID>": generic.uid };
  if (section === "contenttype") return { "<CONTENT_TYPE_UID>": generic.uid };
  if (section === "webhook") return { "<WEBHOOK_UID>": generic.webhook_uid ?? generic.uid };
  if (section === "label") return { "<LABEL_UID>": generic.label_uid ?? generic.uid };
  if (section === "globalfield") return { "<GLOBAL_FIELD_UID>": generic.global_field_uid ?? generic.uid };
  return {};
}

/**
 * Whether a language's harness has a real placeholder to receive a
 * disposable resource's UID for this section - see translateDisposableOverrides'
 * doc comment for why Java excludes webhook/label. Extension/Release/Taxonomy
 * (added in a later pass) are JS/Python-only for now - their Java/.NET
 * placeholder conventions haven't been individually verified yet, so those
 * two languages fall back to the existing "no fixture support" skip rather
 * than risk substituting into the wrong placeholder text.
 */
const DOTNET_TRANSLATED_SECTIONS = new Set(["entry", "asset", "contenttype", "webhook", "label", "globalfield"]);
export function hasTranslatableDisposableSupport(navSection: string, method: string, style: "js" | "python" | "java" | "dotnet"): boolean {
  if (!hasDisposableSupport(navSection, method)) return false;
  if (style === "js" || style === "python") return true;
  const section = normalizeSection(navSection);
  if (style === "java") return section === "entry" || section === "asset" || section === "contenttype";
  return DOTNET_TRANSLATED_SECTIONS.has(section);
}

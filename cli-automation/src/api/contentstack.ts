/**
 * Minimal Contentstack Management API client.
 *
 * Used by the setup stage to seed a real test stack in the QA org
 * (content types named exactly like the doc's dummy values, entries,
 * an asset, environments, a management token) and by teardown to
 * delete the stack afterwards.
 */
import "dotenv/config";

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

let cachedToken: string | null = null;

/**
 * Session authtokens can expire well before a full doc run finishes (some
 * runs take 20-30+ minutes). A process-lifetime cache meant teardown's
 * deleteStack() call silently failed with a stale token — the delete
 * request came back non-200, was swallowed by a `.catch(() => false)`
 * upstream, and the stack was left behind in the QA org. Pass
 * `forceRefresh` for anything where reliability matters more than saving
 * one login round-trip (teardown, in particular).
 */
export async function getAuthtoken(forceRefresh = false): Promise<string> {
  if (cachedToken && !forceRefresh) return cachedToken;
  const res = await fetch(`${host()}/v3/user-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: { email: process.env.CONTENTSTACK_EMAIL, password: process.env.CONTENTSTACK_PASSWORD },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data?.user?.authtoken) {
    throw new Error(`Login failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  cachedToken = data.user.authtoken as string;
  return cachedToken;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
  forceFreshAuth = false
): Promise<{ status: number; data: any }> {
  const authtoken = await getAuthtoken(forceFreshAuth);
  const res = await fetch(`${host()}/v3${path}`, {
    method,
    headers: { "Content-Type": "application/json", authtoken, ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export async function createStack(name: string): Promise<{ apiKey: string; name: string }> {
  const { status, data } = await api(
    "POST",
    "/stacks",
    { stack: { name, master_locale: "en-us" } },
    { organization_uid: process.env.CONTENTSTACK_ORG_ID ?? "" }
  );
  if (status !== 201) throw new Error(`Stack create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return { apiKey: data.stack.api_key, name };
}

/**
 * Delete a stack, verified. Always forces a fresh authtoken — teardown runs
 * after everything else in a doc run (often 20-30+ min in), and a stale
 * cached token here means a silently orphaned stack in the shared QA org.
 * Confirms deletion by re-fetching the stack afterward, and retries once
 * more on any mismatch before giving up.
 */
export async function deleteStack(apiKey: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { status } = await api("DELETE", "/stacks", undefined, { api_key: apiKey }, true);
    if (status !== 200) continue;
    // DELETE returning 200 isn't proof enough on its own — verify the stack is actually gone.
    const check = await api("GET", "/stacks", undefined, { api_key: apiKey }, true);
    if (check.status !== 200) return true; // 4xx/404 now — confirmed gone
  }
  return false;
}

/** Create a taxonomy + one term for real, for docs (export-content-to-csv) that need a genuine --taxonomy-uid to test against. */
export async function createTaxonomy(apiKey: string, uid: string, name: string): Promise<{ taxonomyUid: string; termUid: string }> {
  const { status, data } = await api("POST", "/taxonomies", { taxonomy: { uid, name, description: "cli-automation test taxonomy" } }, { api_key: apiKey });
  if (status !== 201 && status !== 200) throw new Error(`Taxonomy create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  const termUid = `${uid}_term`;
  const term = await api("POST", `/taxonomies/${uid}/terms`, { term: { uid: termUid, name: "CLI Automation Term" } }, { api_key: apiKey });
  if (term.status !== 201 && term.status !== 200) throw new Error(`Term create failed: ${term.status} ${JSON.stringify(term.data).slice(0, 200)}`);
  return { taxonomyUid: uid, termUid };
}

/** Find a stack by exact name in the QA org — used to locate and clean up a stack that `cm:stacks:seed --org --stack-name` creates for real (its API key isn't known in advance). */
export async function findStackByName(name: string): Promise<{ apiKey: string } | undefined> {
  const { status, data } = await api("GET", `/stacks?query=${encodeURIComponent(JSON.stringify({ name }))}`, undefined, {
    organization_uid: process.env.CONTENTSTACK_ORG_ID ?? "",
  });
  if (status !== 200) return undefined;
  const match = (data.stacks ?? []).find((s: any) => s.name === name);
  return match ? { apiKey: match.api_key } : undefined;
}

/** Content type with a real HTML RTE field + JSON RTE field, for migrate-content-from-html-rte-to-json-rte's doc — that migration needs both to already exist and the HTML RTE to hold real content. */
export async function createRteContentType(apiKey: string, uid: string): Promise<void> {
  const { status, data } = await api(
    "POST",
    "/content_types",
    {
      content_type: {
        title: "RTE Migration Demo",
        uid,
        schema: [
          { display_name: "Title", uid: "title", data_type: "text", mandatory: true, unique: true, field_metadata: { _default: true } },
          { display_name: "URL", uid: "url", data_type: "text", mandatory: false, field_metadata: { _default: true } },
          {
            display_name: "Html Rte",
            uid: "rich_text_editor",
            data_type: "text",
            field_metadata: { allow_rich_text: true, description: "", multiline: false, rich_text_type: "advanced", options: [], version: 3 },
          },
          {
            display_name: "Json Rte",
            uid: "json_rte",
            data_type: "json",
            field_metadata: { allow_json_rte: true, embed_entry: true, description: "", default_value: {}, rich_text_type: "advanced" },
            reference_to: ["sys_assets"],
            format: "",
            error_messages: { format: "" },
          },
        ],
        options: { is_page: true, singleton: false, title: "title", sub_title: [], url_pattern: "/:title", url_prefix: "/" },
      },
    },
    { api_key: apiKey }
  );
  if (status !== 201) throw new Error(`RTE content type ${uid} failed: ${status} ${JSON.stringify(data).slice(0, 300)}`);
}

/** Real entry with actual HTML in the RTE field — the migration command needs existing content to migrate, not an empty field. */
export async function createRteEntry(apiKey: string, contentTypeUid: string): Promise<string> {
  const { status, data } = await api(
    "POST",
    `/content_types/${contentTypeUid}/entries`,
    { entry: { title: "RTE Migration Entry", url: "/rte-migration-entry", rich_text_editor: "<p>Hello <b>world</b>, migrate me.</p>" } },
    { api_key: apiKey }
  );
  if (status !== 201) throw new Error(`RTE entry create failed: ${status} ${JSON.stringify(data).slice(0, 300)}`);
  return data.entry.uid as string;
}

export async function createContentType(apiKey: string, uid: string, title: string): Promise<void> {
  const { status, data } = await api(
    "POST",
    "/content_types",
    {
      content_type: {
        title,
        uid,
        schema: [
          { display_name: "Title", uid: "title", data_type: "text", mandatory: true, unique: true, field_metadata: { _default: true } },
          { display_name: "URL", uid: "url", data_type: "text", mandatory: false, field_metadata: { _default: true } },
          { display_name: "Body", uid: "body", data_type: "text", mandatory: false, field_metadata: { multiline: true } },
        ],
        options: { is_page: true, singleton: false, title: "title", sub_title: [], url_pattern: "/:title", url_prefix: "/" },
      },
    },
    { api_key: apiKey }
  );
  if (status !== 201) throw new Error(`Content type ${uid} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
}

export async function createEntry(apiKey: string, contentType: string, title: string): Promise<string> {
  const { status, data } = await api(
    "POST",
    `/content_types/${contentType}/entries?locale=en-us`,
    { entry: { title, url: `/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, body: `Seeded by cli-automation for ${contentType}.` } },
    { api_key: apiKey }
  );
  if (status !== 201) throw new Error(`Entry for ${contentType} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.entry.uid as string;
}

/** Create a delivery token (with preview enabled) scoped to the given environment. */
export async function createDeliveryToken(apiKey: string, environment: string): Promise<string> {
  const { status, data } = await api(
    "POST",
    "/stacks/delivery_tokens",
    {
      token: {
        name: "cli-automation-delivery",
        description: "Created by cli-automation",
        scope: [
          { module: "environment", environments: [environment], acl: { read: true } },
          { module: "branch", branches: ["main"], acl: { read: true } },
        ],
      },
    },
    { api_key: apiKey }
  );
  if (status !== 201) throw new Error(`Delivery token failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.token.token as string;
}

export async function createEnvironment(apiKey: string, name: string): Promise<void> {
  const { status, data } = await api(
    "POST",
    "/environments",
    { environment: { name, urls: [{ url: `https://${name}.example.com`, locale: "en-us" }] } },
    { api_key: apiKey }
  );
  if (status !== 201) throw new Error(`Environment ${name} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
}

export async function createLabel(apiKey: string, name: string, contentTypes: string[]): Promise<void> {
  const { status, data } = await api("POST", "/labels", { label: { name, content_types: contentTypes } }, { api_key: apiKey });
  if (status !== 201) throw new Error(`Label ${name} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
}

export async function uploadAsset(apiKey: string, filename: string, content: string): Promise<void> {
  const authtoken = await getAuthtoken();
  const form = new FormData();
  form.append("asset[upload]", new Blob([content], { type: "text/plain" }), filename);
  form.append("asset[title]", filename);
  const res = await fetch(`${host()}/v3/assets`, {
    method: "POST",
    headers: { authtoken, api_key: apiKey },
    body: form,
  });
  if (res.status !== 201) throw new Error(`Asset upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/**
 * Create a management token with the widest scope the API accepts
 * (all valid modules + mandatory branch entry), so exports of every
 * module succeed via `-a <alias>`.
 */
export async function createManagementToken(apiKey: string): Promise<string> {
  const modules = [
    "content_type", "entry", "asset", "environment", "locale", "extension",
    "webhook", "workflow", "label", "global_field", "release", "branch_alias",
    "role", // without it, export's custom-roles fetch gets "Access denied" — and the CLI's progress UI hangs on that error instead of exiting
  ];
  const scope = [
    ...modules.map((m) => ({ module: m, acl: { read: true, write: true } })),
    { module: "branch", branches: ["main"], acl: { read: true } },
  ];
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { status, data } = await api(
    "POST",
    "/stacks/management_tokens",
    { token: { name: "cli-automation", description: "Created by cli-automation", scope, expires_on: expires, is_email_notification_enabled: false } },
    { api_key: apiKey }
  );
  if (status !== 201) throw new Error(`Management token failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.token.token as string;
}

/** Create a branch alias pointing at a branch. Alias UIDs must be lowercase. */
export async function createBranchAlias(apiKey: string, aliasUid: string, targetBranch: string): Promise<boolean> {
  const { status } = await api(
    "PUT",
    `/stacks/branch_aliases/${aliasUid}`,
    { branch_alias: { target_branch: targetBranch } },
    { api_key: apiKey }
  );
  return status === 200 || status === 201;
}

/** Try to create a branch; returns false if the plan doesn't support it. */
export async function tryCreateBranch(apiKey: string, uid: string): Promise<{ ok: boolean; error?: string }> {
  const { status, data } = await api("POST", "/stacks/branches", { branch: { uid, source: "main" } }, { api_key: apiKey });
  if (status === 201) return { ok: true };
  return { ok: false, error: JSON.stringify(data.errors ?? data).slice(0, 200) };
}

// Allow: `tsx src/api/contentstack.ts delete <apiKey> [...]` for manual cleanup.
if (process.argv[1]?.endsWith("contentstack.ts") && process.argv[2] === "delete") {
  for (const k of process.argv.slice(3)) {
    console.log(`${(await deleteStack(k)) ? "✓ deleted" : "✗ failed"}  ${k}`);
  }
}

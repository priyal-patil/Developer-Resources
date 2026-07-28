/**
 * Minimal Contentstack Management API client for seeding the persistent
 * sdk-automation stack. Same host map / auth pattern as cli-automation's
 * src/api/contentstack.ts (kept separate per the standalone-subproject
 * convention rather than shared as a package).
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

export async function findStackByName(name: string): Promise<{ apiKey: string } | undefined> {
  const { status, data } = await api("GET", `/stacks?query=${encodeURIComponent(JSON.stringify({ name }))}`, undefined, {
    organization_uid: process.env.CONTENTSTACK_ORG_ID ?? "",
  });
  if (status !== 200) return undefined;
  const match = (data.stacks ?? []).find((s: any) => s.name === name);
  return match ? { apiKey: match.api_key } : undefined;
}

export async function createStack(name: string): Promise<{ apiKey: string }> {
  const { status, data } = await api(
    "POST",
    "/stacks",
    { stack: { name, master_locale: "en-us" } },
    { organization_uid: process.env.CONTENTSTACK_ORG_ID ?? "" }
  );
  if (status !== 201) throw new Error(`Stack create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return { apiKey: data.stack.api_key };
}

/**
 * Delete a stack, verified. Always forces a fresh authtoken (cheap - the
 * cached one may be stale by the time cleanup runs) and confirms deletion
 * by re-fetching the stack afterward rather than trusting a 200 alone.
 */
export async function deleteStack(apiKey: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { status } = await api("DELETE", "/stacks", undefined, { api_key: apiKey }, true);
    if (status !== 200) continue;
    const check = await api("GET", "/stacks", undefined, { api_key: apiKey }, true);
    if (check.status !== 200) return true; // 4xx/404 now - confirmed gone
  }
  return false;
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
  // A rerun after a partial-failure seed (e.g. delivery-token creation
  // failing later in the pipeline) hits "title is not unique" (422, error
  // code 115) rather than a clean 409 - the content type already exists
  // from the earlier attempt, so this is idempotent too, not a real failure.
  const alreadyExists = status === 409 || (status === 422 && JSON.stringify(data).includes("not unique"));
  if (status !== 201 && !alreadyExists) throw new Error(`Content type ${uid} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
}

export async function getContentTypeSchema(apiKey: string, uid: string): Promise<any[]> {
  const { status, data } = await api("GET", `/content_types/${uid}`, undefined, { api_key: apiKey });
  if (status !== 200) throw new Error(`Get content type ${uid} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.content_type.schema;
}

/** Adds a taxonomy field (referencing the given taxonomy uid) to a content type's schema, if not already present. */
export async function addTaxonomyField(apiKey: string, contentTypeUid: string, taxonomyUid: string): Promise<{ status: number; data: any }> {
  const schema = await getContentTypeSchema(apiKey, contentTypeUid);
  if (schema.some((f: any) => f.data_type === "taxonomy")) return { status: 200, data: { note: "already present" } };
  schema.push({
    data_type: "taxonomy",
    display_name: "Taxonomies",
    uid: "taxonomies",
    taxonomies: [{ taxonomy_uid: taxonomyUid, max_terms: 1, mandatory: false, non_localizable: false }],
    multiple: true,
    non_localizable: false,
  });
  return api("PUT", `/content_types/${contentTypeUid}`, { content_type: { schema } }, { api_key: apiKey });
}

export async function listEntries(apiKey: string, contentType: string): Promise<string[]> {
  const { status, data } = await api("GET", `/content_types/${contentType}/entries?locale=en-us`, undefined, { api_key: apiKey });
  if (status !== 200) return [];
  return (data.entries ?? []).map((e: any) => e.uid);
}

export async function createEntry(apiKey: string, contentType: string, title: string): Promise<string> {
  const { status, data } = await api(
    "POST",
    `/content_types/${contentType}/entries?locale=en-us`,
    { entry: { title, url: `/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, body: `Seeded by sdk-automation for ${contentType}.` } },
    { api_key: apiKey }
  );
  if (status !== 201) throw new Error(`Entry for ${contentType} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.entry.uid as string;
}

export async function tagEntryTaxonomy(apiKey: string, contentType: string, uid: string, taxonomyUid: string, termUid: string): Promise<{ status: number; data: any }> {
  return api(
    "PUT",
    `/content_types/${contentType}/entries/${uid}?locale=en-us`,
    { entry: { taxonomies: [{ taxonomy_uid: taxonomyUid, term_uid: termUid }] } },
    { api_key: apiKey }
  );
}

export async function publishEntry(apiKey: string, contentType: string, uid: string, environment: string): Promise<void> {
  const { status, data } = await api(
    "POST",
    `/content_types/${contentType}/entries/${uid}/publish`,
    { entry: { environments: [environment], locales: ["en-us"] } },
    { api_key: apiKey }
  );
  if (status !== 200 && status !== 201) throw new Error(`Publish ${uid} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
}

export async function createEnvironment(apiKey: string, name: string): Promise<void> {
  const { status, data } = await api(
    "POST",
    "/environments",
    { environment: { name, urls: [{ url: `https://${name}.example.com`, locale: "en-us" }] } },
    { api_key: apiKey }
  );
  const alreadyExists = status === 409 || (status === 422 && JSON.stringify(data).includes("not unique"));
  if (status !== 201 && !alreadyExists) throw new Error(`Environment ${name} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
}

export async function uploadAsset(apiKey: string, filename: string, content: string): Promise<string> {
  const authtoken = await getAuthtoken();
  const form = new FormData();
  form.append("asset[upload]", new Blob([content], { type: "text/plain" }), filename);
  form.append("asset[title]", filename);
  const res = await fetch(`${host()}/v3/assets`, { method: "POST", headers: { authtoken, api_key: apiKey }, body: form });
  const data = await res.json();
  if (res.status !== 201) throw new Error(`Asset upload failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.asset.uid as string;
}

export async function publishAsset(apiKey: string, uid: string, environment: string): Promise<void> {
  const { status, data } = await api(
    "POST",
    `/assets/${uid}/publish`,
    { asset: { environments: [environment], locales: ["en-us"] } },
    { api_key: apiKey }
  );
  if (status !== 200 && status !== 201) throw new Error(`Publish asset ${uid} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
}

export async function createDeliveryToken(apiKey: string, environment: string): Promise<string> {
  const { status, data } = await api(
    "POST",
    "/stacks/delivery_tokens",
    {
      token: {
        name: "sdk-automation-delivery",
        description: "Created by sdk-automation",
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

export async function createTaxonomy(apiKey: string, uid: string, name: string, termUid: string): Promise<{ taxonomyUid: string; termUid: string }> {
  const { status, data } = await api("POST", "/taxonomies", { taxonomy: { uid, name, description: "sdk-automation test taxonomy" } }, { api_key: apiKey });
  const taxExists = status === 409 || (status >= 400 && JSON.stringify(data).match(/not unique|already exist/i));
  if (status !== 201 && status !== 200 && !taxExists) throw new Error(`Taxonomy create failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  const term = await api("POST", `/taxonomies/${uid}/terms`, { term: { uid: termUid, name: "SDK Automation Term" } }, { api_key: apiKey });
  const termExists = term.status === 409 || (term.status >= 400 && JSON.stringify(term.data).match(/not unique|already exist/i));
  if (term.status !== 201 && term.status !== 200 && !termExists) {
    throw new Error(`Term create failed: ${term.status} ${JSON.stringify(term.data).slice(0, 200)}`);
  }
  return { taxonomyUid: uid, termUid };
}

export async function createGlobalField(apiKey: string, uid: string, title: string): Promise<void> {
  const { status, data } = await api(
    "POST",
    "/global_fields",
    {
      global_field: {
        title,
        uid,
        schema: [
          { display_name: "Format", uid: "format", data_type: "text", mandatory: false, field_metadata: { _default: true } },
        ],
      },
    },
    { api_key: apiKey }
  );
  const alreadyExists = status === 409 || (status >= 400 && JSON.stringify(data).match(/not unique|already exist/i));
  if (status !== 201 && !alreadyExists) throw new Error(`Global field ${uid} failed: ${status} ${JSON.stringify(data).slice(0, 200)}`);
}

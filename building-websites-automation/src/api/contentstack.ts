/**
 * Minimal Contentstack Management API client.
 *
 * Used for:
 *   - teardown (delete the stack a run seeds)
 *   - the dashboard stage's API fallback (create delivery/preview tokens)
 *
 * Auth is the account session token (authtoken), obtained from email/password.
 */
import "dotenv/config";

/** Management API host per region. */
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

/** Log in with account credentials and return the session authtoken (cached). */
export async function getAuthtoken(): Promise<string> {
  if (cachedToken) return cachedToken;
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

/** Delete a stack by its API key. Returns true on success. */
export async function deleteStack(stackApiKey: string): Promise<boolean> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${host()}/v3/stacks`, {
    method: "DELETE",
    headers: { api_key: stackApiKey, authtoken, "Content-Type": "application/json" },
  });
  return res.ok;
}

/** Create a delivery token (with preview) on a stack; returns both tokens. */
export async function createDeliveryToken(
  stackApiKey: string,
  environment: string
): Promise<{ deliveryToken: string; previewToken?: string }> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${host()}/v3/stacks/delivery_tokens`, {
    method: "POST",
    headers: { api_key: stackApiKey, authtoken, "Content-Type": "application/json" },
    body: JSON.stringify({
      token: {
        name: "kickstart-automation",
        description: "Created by kickstart-automation",
        scope: [
          { module: "environment", environments: [environment], acl: { read: true } },
          { module: "branch", branches: ["main"], acl: { read: true } },
        ],
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token create failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return {
    deliveryToken: data.token?.token,
    previewToken: data.token?.preview_token,
  };
}


/** Upload a local file as an asset; returns the asset uid. */
export async function uploadAsset(stackApiKey: string, filePath: string, title: string): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const { basename } = await import("node:path");
  const authtoken = await getAuthtoken();
  const form = new FormData();
  form.append("asset[upload]", new Blob([readFileSync(filePath)]), basename(filePath));
  form.append("asset[title]", title);
  const res = await fetch(`${host()}/v3/assets`, {
    method: "POST",
    headers: { api_key: stackApiKey, authtoken },
    body: form,
  });
  const data = await res.json();
  if (!res.ok || !data?.asset?.uid) throw new Error(`asset upload failed: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.asset.uid as string;
}

/** Create an entry; returns the entry uid. */
export async function createEntry(stackApiKey: string, contentTypeUid: string, entry: Record<string, unknown>): Promise<string> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${host()}/v3/content_types/${contentTypeUid}/entries?locale=en-us`, {
    method: "POST",
    headers: { api_key: stackApiKey, authtoken, "Content-Type": "application/json" },
    body: JSON.stringify({ entry }),
  });
  const data = await res.json();
  if (!res.ok || !data?.entry?.uid) throw new Error(`entry create failed (${contentTypeUid}): HTTP ${res.status} ${JSON.stringify(data).slice(0, 250)}`);
  return data.entry.uid as string;
}

/** Fetch an entry (to verify field state, e.g. the doc's Page-URL bug check). */
export async function getEntry(stackApiKey: string, contentTypeUid: string, entryUid: string): Promise<Record<string, unknown>> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${host()}/v3/content_types/${contentTypeUid}/entries/${entryUid}?locale=en-us`, {
    headers: { api_key: stackApiKey, authtoken },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`entry fetch failed: HTTP ${res.status}`);
  return data.entry ?? {};
}

/** Update an entry's fields. */
export async function updateEntry(stackApiKey: string, contentTypeUid: string, entryUid: string, entry: Record<string, unknown>): Promise<void> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${host()}/v3/content_types/${contentTypeUid}/entries/${entryUid}?locale=en-us`, {
    method: "PUT",
    headers: { api_key: stackApiKey, authtoken, "Content-Type": "application/json" },
    body: JSON.stringify({ entry }),
  });
  if (!res.ok) throw new Error(`entry update failed: HTTP ${res.status} ${JSON.stringify(await res.json()).slice(0, 200)}`);
}

/** Publish an entry (with references is implicit for assets already published/none). */
export async function publishEntry(stackApiKey: string, contentTypeUid: string, entryUid: string, environment: string): Promise<void> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${host()}/v3/content_types/${contentTypeUid}/entries/${entryUid}/publish`, {
    method: "POST",
    headers: { api_key: stackApiKey, authtoken, "Content-Type": "application/json" },
    body: JSON.stringify({ entry: { environments: [environment], locales: ["en-us"] } }),
  });
  if (!res.ok) throw new Error(`entry publish failed (${contentTypeUid}): HTTP ${res.status} ${JSON.stringify(await res.json()).slice(0, 200)}`);
}

/** Publish an asset to an environment. */
export async function publishAsset(stackApiKey: string, assetUid: string, environment: string): Promise<void> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${host()}/v3/assets/${assetUid}/publish`, {
    method: "POST",
    headers: { api_key: stackApiKey, authtoken, "Content-Type": "application/json" },
    body: JSON.stringify({ asset: { environments: [environment], locales: ["en-us"] } }),
  });
  if (!res.ok) throw new Error(`asset publish failed: HTTP ${res.status}`);
}

// Allow: `tsx src/api/contentstack.ts delete <apiKey> [<apiKey>...]`
if (process.argv[1]?.endsWith("contentstack.ts") && process.argv[2] === "delete") {
  const keys = process.argv.slice(3);
  Promise.all(
    keys.map(async (k) => console.log(`${(await deleteStack(k)) ? "✓ deleted" : "✗ failed"}  ${k}`))
  );
}

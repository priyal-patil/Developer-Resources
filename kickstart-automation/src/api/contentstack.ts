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

// Allow: `tsx src/api/contentstack.ts delete <apiKey> [<apiKey>...]`
if (process.argv[1]?.endsWith("contentstack.ts") && process.argv[2] === "delete") {
  const keys = process.argv.slice(3);
  Promise.all(
    keys.map(async (k) => console.log(`${(await deleteStack(k)) ? "✓ deleted" : "✗ failed"}  ${k}`))
  );
}

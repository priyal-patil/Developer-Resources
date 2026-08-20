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

/**
 * Session authtokens expire well before a full run finishes (a --all run is
 * 30+ minutes, and the shared nuxt/next stacks are torn down at the very end).
 * A process-lifetime cache meant those teardown deletes came back 401, the
 * failure was swallowed by an upstream `.catch(() => false)`, and the stack was
 * orphaned in the shared QA org. Pass `forceRefresh` anywhere reliability beats
 * saving one login round-trip — teardown, in particular.
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

/**
 * Delete a stack, verified. Always forces a fresh authtoken — teardown runs
 * last, often 30+ minutes into a run, and a stale cached token here means a
 * silently orphaned stack in the shared QA org. A 200 isn't proof on its own,
 * so the stack is re-fetched afterward; retries once on any mismatch.
 */
export async function deleteStack(stackApiKey: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const authtoken = await getAuthtoken(true);
    const res = await fetch(`${host()}/v3/stacks`, {
      method: "DELETE",
      headers: { api_key: stackApiKey, authtoken, "Content-Type": "application/json" },
    });
    if (!res.ok) continue;
    const check = await fetch(`${host()}/v3/stacks`, {
      headers: { api_key: stackApiKey, authtoken, "Content-Type": "application/json" },
    });
    if (!check.ok) return true; // 4xx now — confirmed gone
  }
  return false;
}

/** Stacks this harness has created in the QA org, oldest first. */
export async function listRunStacks(): Promise<{ apiKey: string; name: string; createdAt: string }[]> {
  const authtoken = await getAuthtoken(true);
  const res = await fetch(`${host()}/v3/stacks?limit=100`, {
    headers: {
      authtoken,
      organization_uid: process.env.CONTENTSTACK_ORG_ID ?? "",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.stacks ?? [])
    .filter((s: any) => /^CS Kickstart /.test(s.name ?? ""))
    .map((s: any) => ({ apiKey: s.api_key, name: s.name, createdAt: s.created_at }));
}

/**
 * Resolve a stack's API key from its exact name. The seed step normally scrapes
 * the api key out of `csdx cm:stacks:seed` stdout, but that output format is
 * the CLI's business and has changed before — when the scrape misses, every
 * later step (delivery token, .env, running the app) fails with "no seeded
 * stack api key" even though the stack was created fine. This is the fallback.
 */
export async function findStackApiKeyByName(name: string): Promise<string | undefined> {
  const stacks = await listRunStacks().catch(() => []);
  return stacks.find((s) => s.name === name)?.apiKey;
}

/**
 * Self-heal: delete stacks left behind by earlier runs whose teardown never
 * ran (interrupted process, expired token). Anything older than `maxAgeMs`
 * cannot belong to this run, so it is safe to remove. Called at run start.
 */
export async function sweepOrphanStacks(maxAgeMs = 2 * 60 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const orphans = (await listRunStacks().catch(() => [])).filter(
    (s) => Date.parse(s.createdAt) < cutoff
  );
  let swept = 0;
  for (const s of orphans) {
    const ok = await deleteStack(s.apiKey).catch(() => false);
    console.log(`  ${ok ? "🧹 swept orphan" : "⚠ could not sweep"} ${s.name} (${s.apiKey})`);
    if (ok) swept++;
  }
  return swept;
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

// Allow: `npm run teardown -- <apiKey> [<apiKey>...]`  /  `npm run sweep [-- <maxAgeHours>]`
if (process.argv[1]?.endsWith("contentstack.ts")) {
  if (process.argv[2] === "delete") {
    const keys = process.argv.slice(3);
    await Promise.all(
      keys.map(async (k) => console.log(`${(await deleteStack(k)) ? "✓ deleted" : "✗ failed"}  ${k}`))
    );
  } else if (process.argv[2] === "sweep") {
    const hours = Number(process.argv[3] ?? 2);
    console.log(`Sweeping "CS Kickstart *" stacks older than ${hours}h…`);
    console.log(`Swept ${await sweepOrphanStacks(hours * 60 * 60 * 1000)} stack(s).`);
  }
}

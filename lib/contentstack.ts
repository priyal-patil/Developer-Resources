type EntryResponse<T> = { entry: T };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export async function fetchHomepage<T>(): Promise<T> {
  const host        = requiredEnv("CONTENTSTACK_CDN_HOST");
  const apiKey      = requiredEnv("CONTENTSTACK_API_KEY");
  const token       = requiredEnv("CONTENTSTACK_DELIVERY_TOKEN");
  const environment = requiredEnv("CONTENTSTACK_ENVIRONMENT");
  const contentType = requiredEnv("CONTENTSTACK_CONTENT_TYPE_UID");
  const entryUid    = requiredEnv("CONTENTSTACK_ENTRY_UID");
  const locale      = process.env.CONTENTSTACK_LOCALE;

  const params = new URLSearchParams({ environment });
  if (locale) params.set("locale", locale);

  const url = `https://${host}/v3/content_types/${contentType}/entries/${entryUid}?${params}`;

  const res = await fetch(url, {
    headers: { api_key: apiKey, access_token: token },
    cache: "force-cache",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Contentstack fetch failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as EntryResponse<T>;
  return json.entry;
}

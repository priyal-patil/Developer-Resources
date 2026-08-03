/**
 * Playwright session management for the App SDK doc automation - reuses the
 * login flow already proven working in
 * `../../kickstart-automation/src/execute/dashboard.ts` (this sibling
 * project already drives app.contentstack.com's real login form).
 *
 * Every request to the tunnel's `*.loca.lt` host needs a
 * `bypass-tunnel-reminder` header, or `localtunnel`'s free service shows an
 * anti-bot interstitial page instead of the real app - confirmed via live
 * testing (a request without this header returns a "Tunnel website ahead!"
 * warning page's HTML, not our bundle). Scoped via `context.route()` to
 * only the tunnel's own host, not all requests, since setting it globally
 * breaks CORS preflight checks on unrelated third-party resources the real
 * Contentstack UI loads (e.g. Google Fonts).
 */
import { chromium, type Browser, type BrowserContext, type Page, type Frame } from "playwright";

const APP = "https://app.contentstack.com";

export interface AppSdkBrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function loginAppSdkSession(): Promise<AppSdkBrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**://*.loca.lt/**", async (route) => {
    const headers = { ...route.request().headers(), "bypass-tunnel-reminder": "true" };
    await route.continue({ headers });
  });
  const page = await context.newPage();

  await page.goto(`${APP}/#!/login`);
  await page.fill('input[name="email"]', process.env.CONTENTSTACK_EMAIL!);
  await page.fill('input[name="password"]', process.env.CONTENTSTACK_PASSWORD!);
  await page.click('[data-test-id="cs-email-login"]');
  await page.waitForURL(/#!\/dashboard/, { timeout: 30_000 });

  return {
    browser,
    context,
    page,
    close: async () => {
      await browser.close();
    },
  };
}

export async function gotoEntryEditPage(page: Page, stackApiKey: string, contentTypeUid: string, entryUid: string): Promise<void> {
  const url = `${APP}/#!/stack/${stackApiKey}/content-type/${contentTypeUid}/en-us/entry/${entryUid}/edit`;
  await page.goto(url, { waitUntil: "networkidle" });
}

export async function gotoDashboard(page: Page, stackApiKey: string): Promise<void> {
  await page.goto(`${APP}/#!/stack/${stackApiKey}/dashboard`, { waitUntil: "networkidle" });
}

/**
 * Finds the iframe (there may be several `*.loca.lt` frames on one page -
 * one per active UI location) whose `window.sdk.location[locationKey]`
 * actually resolved to something - i.e. THIS iframe is the one the real
 * Contentstack UI embedded for that specific location, not a sibling
 * location's iframe running the same bundle.
 */
export async function findLocationFrame(page: Page, locationKey: string, attempts = 15): Promise<Frame | undefined> {
  for (let i = 0; i < attempts; i++) {
    const frames = page.frames().filter((f) => f.url().includes("loca.lt"));
    for (const f of frames) {
      const ready = await f.evaluate(() => (window as any).__appSdkStatus === "ready").catch(() => false);
      if (!ready) continue;
      const has = await f
        .evaluate((key) => {
          const loc = (window as any).sdk?.location?.[key];
          return !!loc && Object.keys(loc).length > 0;
        }, locationKey)
        .catch(() => false);
      if (has) return f;
    }
    await page.waitForTimeout(1000);
  }
  return undefined;
}

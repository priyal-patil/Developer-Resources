/**
 * Dashboard stage — drives the Contentstack app UI with Playwright to perform the
 * doc's browser steps (create delivery token, enable Live Preview), exactly as a
 * user would. Falls back to the Management API if the UI flow fails, so a run still
 * completes and the report flags the UI step.
 *
 * Selectors below were captured by walking the live app.contentstack.com dashboard.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import type { ExecContext, KickstartConfig } from "../types.js";
import { createDeliveryToken } from "../api/contentstack.js";

const APP = "https://app.contentstack.com";

/** Log in once and reuse the page for later dashboard steps. */
async function ensurePage(ctx: ExecContext): Promise<Page> {
  if (ctx.page) return ctx.page as Page;
  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`${APP}/#!/login`);
  await page.fill('input[name="email"]', process.env.CONTENTSTACK_EMAIL!);
  await page.fill('input[name="password"]', process.env.CONTENTSTACK_PASSWORD!);
  await page.click('[data-test-id="cs-email-login"]');
  await page.waitForURL(/#!\/dashboard/, { timeout: 30_000 });

  ctx.browser = browser;
  ctx.page = page;
  return page;
}

/** Outcome of checking the doc's named UI labels against the live app. */
export interface LabelCheck {
  found: string[];
  missing: string[];
}

/**
 * Assert each doc-named UI label (from "X > Y" click-paths) exists among the
 * app's navigation/actionable elements on the current page. Case-insensitive
 * substring match, scoped to nav-ish elements so page prose can't mask a
 * renamed menu item (e.g. doc says "Live Preview", nav says "Visual Experience").
 */
async function checkNavLabels(page: Page, labels: string[], acc: Map<string, boolean>): Promise<void> {
  if (!labels.length) return;
  const navTexts: string[] = await page.evaluate(() => {
    // Nav-ish elements only — deliberately NOT bare [data-test-id] (that matches
    // whole content containers and page prose would mask renamed menu items).
    const sel = [
      "a", "button", '[role="menuitem"]', '[role="link"]', '[role="tab"]',
      "nav *", '[class*="nav" i] *', '[class*="menu" i] *', '[class*="breadcrumb" i] *',
      '[data-test-id*="nav" i] *', '[data-test-id*="menu" i] *',
      '[data-test-id*="sidebar" i] *', '[data-test-id*="breadcrumb" i] *',
      '[data-test-id*="switcher" i] *',
    ].join(",");
    return [...document.querySelectorAll(sel)].map((e) => (e.textContent || "").trim()).filter((t) => t && t.length < 80);
  });
  const hay = navTexts.join("\n").toLowerCase();
  for (const label of labels) {
    if (hay.includes(label.toLowerCase())) acc.set(label, true);
    else if (!acc.has(label)) acc.set(label, false);
  }
}

/** Collapse the accumulated label map into found/missing lists. */
function labelResult(acc: Map<string, boolean>): LabelCheck {
  const found: string[] = [];
  const missing: string[] = [];
  for (const [label, ok] of acc) (ok ? found : missing).push(label);
  return { found, missing };
}

/** Render a label check for step-detail logs; empty string when nothing to say. */
export function describeLabelCheck(lc: LabelCheck | undefined): string {
  if (!lc || (!lc.found.length && !lc.missing.length)) return "";
  const parts = [];
  if (lc.found.length) parts.push(`UI labels verified on screen: ${lc.found.join(", ")}`);
  if (lc.missing.length) parts.push(`GAP: doc names UI item(s) not found in the app: ${lc.missing.join(", ")} — the doc's click-path may be outdated`);
  return parts.join("\n");
}

export async function closeDashboard(ctx: ExecContext): Promise<void> {
  if (ctx.browser) await (ctx.browser as Browser).close().catch(() => {});
  ctx.browser = undefined;
  ctx.page = undefined;
}

/**
 * Perform the doc's "Get your Organization ID from the dashboard: Org Admin → Info"
 * step in the browser, and return the Org ID shown there.
 *
 * Flow: Organizations → select the org by name → App Switcher → Administration →
 * Info page → read the "Organization UID" value.
 */
export async function getOrgIdFromDashboard(
  ctx: ExecContext,
  orgName: string,
  docLabels: string[] = []
): Promise<{ orgId?: string; detail: string; labels?: LabelCheck }> {
  const acc = new Map<string, boolean>();
  try {
    const page = await ensurePage(ctx);
    await page.goto(`${APP}/#!/organizations`);
    await page.waitForSelector('[data-test-id="org-selection-card"]', { timeout: 20_000 });

    // Select the org whose name matches exactly (many similarly-named orgs exist).
    const picked = await page.evaluate((name) => {
      const cards = [...document.querySelectorAll('[data-test-id="org-selection-card"]')];
      const card = cards.find(
        (c) => c.querySelector('[data-test-id="cs-truncate"]')?.textContent?.trim() === name
      );
      const btn = card?.querySelector('[data-test-id="org-selection-btn"]') as HTMLElement | undefined;
      if (btn) { btn.click(); return true; }
      return false;
    }, orgName);
    if (!picked) return { detail: `org "${orgName}" not found on the organization selection page` };

    await page.waitForURL(/#!\/stacks/, { timeout: 20_000 });
    await page.click('[data-test-id="app-switcher"]');
    await checkNavLabels(page, docLabels, acc); // switcher open — where "Org Admin" should be
    await page.click('[data-test-id="app-switcher-orgadmin"]');
    await page.waitForURL(/\/orgadmin\/.+\/info/, { timeout: 20_000 });
    // Wait for the org-admin sidebar to render before asserting labels against it.
    await page.waitForSelector('[data-test-id^="orgadmin-nav"]', { timeout: 10_000 }).catch(() => {});
    await checkNavLabels(page, docLabels, acc); // org-admin nav — where "Info" should be

    // The Info page loads the UID asynchronously — wait for it next to its label.
    await page
      .waitForFunction(() => /organization uid[\s\S]{0,40}?blt[a-z0-9]{12,}/i.test(document.body.innerText), {
        timeout: 15_000,
      })
      .catch(() => {});

    const orgId = await page.evaluate(() => {
      const m = document.body.innerText.match(/organization uid[\s\S]{0,40}?(blt[a-z0-9]{12,})/i);
      if (m) return m[1];
      for (const el of document.querySelectorAll("input,textarea")) {
        const v = (el as HTMLInputElement).value?.trim() ?? "";
        if (/^blt[a-z0-9]{12,}$/.test(v)) return v;
      }
      return null;
    });

    if (orgId) {
      ctx.orgId = orgId;
      return { orgId, detail: `read Org ID from Org Admin → Info: ${orgId}`, labels: labelResult(acc) };
    }
    return { detail: "Organization UID not found on the Info page", labels: labelResult(acc) };
  } catch (err) {
    return { detail: `org-id browser step failed: ${(err as Error).message}`, labels: labelResult(acc) };
  }
}

/**
 * Create a delivery token (preview On) via the UI and capture both tokens.
 * Returns "ui" | "api" | "failed" indicating how it succeeded.
 */
export async function createDeliveryTokenUI(
  ctx: ExecContext,
  _cfg: KickstartConfig,
  docLabels: string[] = []
): Promise<{ how: "ui" | "api" | "failed"; detail: string; labels?: LabelCheck }> {
  const apiKey = ctx.stackApiKey;
  const env = ctx.environment ?? "preview";
  const acc = new Map<string, boolean>();
  if (!apiKey) return { how: "failed", detail: "no seeded stack api key" };

  try {
    const page = await ensurePage(ctx);
    await page.goto(`${APP}/#!/stack/${apiKey}/settings/tokens/list`);
    await page.waitForSelector('[data-test-id="cs-delivery-token-add"]', { timeout: 20_000 });
    await checkNavLabels(page, docLabels, acc); // settings sidebar — "Settings", "Tokens"
    await page.click('[data-test-id="cs-delivery-token-add"]');
    await page.getByRole("textbox", { name: "name" }).fill("kickstart-automation");

    // Branches (required): open select, choose "main".
    await page.locator('[data-test-id="cs-delivery-token-branch-select"]').click();
    await page.click('[data-test-id="cs-delivery_token-branches-select-input-main"]');

    // Publishing environment (required): click the env label (the radio input is overlaid).
    await page.locator(`[data-test-id="cs-delivery-token-env-name-${env}"]`).getByText(env).click();

    // "Create Preview Token" toggle defaults ON — leave it.
    await page.click('[data-test-id="cs-delivery-token-generate"]');
    await page.waitForURL(/\/tokens\/.+\/edit/, { timeout: 20_000 });

    const tokens = await page.evaluate(() => {
      const out: Record<string, string> = {};
      document.querySelectorAll("input,textarea").forEach((el) => {
        const i = el as HTMLInputElement;
        const key = i.getAttribute("data-test-id") || i.name || i.placeholder || i.id;
        if (i.value && i.value.length > 6) out[key] = i.value;
      });
      return out;
    });

    ctx.previewToken = tokens["previewToken"];
    ctx.deliveryToken = Object.entries(tokens).find(
      ([k, v]) => v.startsWith("cs") && k !== "previewToken"
    )?.[1];

    if (ctx.deliveryToken) {
      return {
        how: "ui",
        detail: `delivery token created via UI (preview token ${ctx.previewToken ? "yes" : "no"})`,
        labels: labelResult(acc),
      };
    }
    throw new Error("token fields not found after generate");
  } catch (uiErr) {
    // Fallback: mint the token via Management API so env/verify can proceed.
    try {
      const { deliveryToken, previewToken } = await createDeliveryToken(apiKey, env);
      ctx.deliveryToken = deliveryToken;
      ctx.previewToken = previewToken;
      return { how: "api", detail: `UI failed (${(uiErr as Error).message}); created via API fallback`, labels: labelResult(acc) };
    } catch (apiErr) {
      return { how: "failed", detail: `UI and API both failed: ${(apiErr as Error).message}`, labels: labelResult(acc) };
    }
  }
}

/** Enable Live Preview and select the preview environment via the UI (best effort). */
export async function enableLivePreviewUI(
  ctx: ExecContext,
  _cfg: KickstartConfig,
  docLabels: string[] = []
): Promise<{ how: "ui" | "failed"; detail: string; labels?: LabelCheck }> {
  const apiKey = ctx.stackApiKey;
  const env = ctx.environment ?? "preview";
  const acc = new Map<string, boolean>();
  if (!apiKey) return { how: "failed", detail: "no seeded stack api key" };

  try {
    const page = await ensurePage(ctx);
    await page.goto(`${APP}/#!/stack/${apiKey}/settings/visual-experience`);
    await page.waitForSelector('[data-test-id="cs-stack-settings-visual-experience"]', { timeout: 20_000 });
    await checkNavLabels(page, docLabels, acc); // settings sidebar — is "Live Preview" a nav item?

    // When a reused stack already has Live Preview configured (env select shows a
    // value), the doc's "ensure it is enabled" is satisfied — nothing to change.
    const envSelText = (await page.locator('[data-test-id="live-preview-environment-select"]').textContent().catch(() => "")) ?? "";
    if (envSelText.toLowerCase().includes(env.toLowerCase())) {
      return { how: "ui", detail: `Live Preview already enabled with environment "${env}" (configured earlier, as the doc allows)`, labels: labelResult(acc) };
    }

    // "Enable Live Preview" is a checkbox; its input is overlaid, so click the label.
    // The Default Preview Environment select stays disabled until it's ticked.
    const enableLabel = page.getByText("Enable Live Preview", { exact: true });
    const alreadyOn = await page.locator('input[type="checkbox"]').first().isChecked().catch(() => false);
    if (!alreadyOn) await enableLabel.click().catch(() => {});

    // Pick the preview environment from the now-enabled react-select.
    await page.locator('[data-test-id="live-preview-environment-select"]').click();
    await page.locator(".Select__option", { hasText: env }).first().click();

    await page.locator('button[data-test-id="cs-button"]', { hasText: "Save" }).click();
    await page.waitForTimeout(1500);
    return {
      how: "ui",
      detail: `Live Preview enabled, default preview environment set to "${env}" via UI`,
      labels: labelResult(acc),
    };
  } catch (err) {
    return { how: "failed", detail: `Live Preview UI step failed: ${(err as Error).message}`, labels: labelResult(acc) };
  }
}

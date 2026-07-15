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
 * Perform the doc's "Import Content Types" step in the dashboard UI, in the doc's
 * exact order (Dishes, Header, Footer, Page): Content Models → import icon →
 * "Import Content Type" modal → choose file → Import → assert it appears.
 *
 * Doc-drift note surfaced live: the doc says "Click on the Import Content Type
 * button", but the UI control is an unlabeled icon (aria-label "Import List").
 *
 * Selectors (live, 2026-07): table-import-icon · cs-import-file-choose (hidden
 * input) · cs-import-file-import
 */
export async function importContentTypesUI(
  ctx: ExecContext,
  files: Array<{ name: string; path: string }>
): Promise<{ ok: boolean; detail: string }> {
  const apiKey = ctx.stackApiKey;
  if (!apiKey) return { ok: false, detail: "no stack to import content types into" };
  try {
    const page = await ensurePage(ctx);
    const ctUrl = `${APP}/#!/stack/${apiKey}/content-types`;
    await page.goto(ctUrl);
    await page.waitForTimeout(2000);
    if (!page.url().includes("/content-types")) {
      await page.goto("about:blank");
      await page.goto(ctUrl);
    }
    const done: string[] = [];
    for (const f of files) {
      await page.waitForSelector('[data-test-id="table-import-icon"]', { timeout: 20_000 });
      await page.click('[data-test-id="table-import-icon"]');
      await page.waitForSelector('input[data-test-id="cs-import-file-choose"]', { state: "attached", timeout: 10_000 });
      await page.setInputFiles('input[data-test-id="cs-import-file-choose"]', f.path);
      await page.click('[data-test-id="cs-import-file-import"]');
      await page.waitForFunction((n) => document.body.innerText.includes(n), f.name, { timeout: 20_000 });
      done.push(f.name);
      await page.waitForTimeout(1200);
    }
    return { ok: true, detail: `imported ${done.length} content types via UI in the doc's order: ${done.join(", ")}. Note: the doc says "Import Content Type button" but the UI control is an unlabeled icon (aria-label "Import List").` };
  } catch (err) {
    return { ok: false, detail: `import-content-types UI flow failed: ${(err as Error).message}` };
  }
}

/**
 * Perform the doc's "Create Environment" step in the dashboard UI:
 * Settings → Environments → New Environment → modal (Name, Base URL,
 * language defaults to en-us) → Create → assert it appears in the list.
 *
 * Selectors captured live (2026-07): cs-environment-empty-state-header-new-environment ·
 * cs-environments-create-title-input · cs-environments-create-url-input ·
 * cs-environment-create-add
 */
export async function createEnvironmentUI(
  ctx: ExecContext,
  envName: string,
  baseUrl: string,
  docLabels: string[] = []
): Promise<{ ok: boolean; detail: string; labels?: LabelCheck }> {
  const acc = new Map<string, boolean>();
  const apiKey = ctx.stackApiKey;
  if (!apiKey) return { ok: false, detail: "no stack to create the environment in" };
  try {
    const page = await ensurePage(ctx);
    const envUrl = `${APP}/#!/stack/${apiKey}/settings/environments`;
    await page.goto(envUrl);
    await page.waitForTimeout(2000);
    // On a freshly created stack the SPA can bounce hash-only navigation back to
    // /dashboard — force a full cross-document navigation in that case.
    if (!page.url().includes("/settings/environments")) {
      await page.goto("about:blank");
      await page.goto(envUrl);
    }
    await page.waitForSelector('[data-test-id*="new-environment"], [data-test-id="cs-environment-empty-state-create"]', { timeout: 20_000 });
    await checkNavLabels(page, docLabels, acc);

    await page.locator('[data-test-id*="new-environment"]').first().click();
    await page.locator('[data-test-id="cs-environments-create-title-input"] input').fill(envName);
    await page.locator('[data-test-id="cs-environments-create-url-input"] input').fill(baseUrl);
    await page.click('[data-test-id="cs-environment-create-add"]');

    // Assert the environment now appears in the list (the doc's expected outcome).
    await page.waitForFunction(
      (name) => document.body.innerText.includes(name),
      envName,
      { timeout: 15_000 }
    );
    ctx.environment = envName;
    return { ok: true, detail: `environment "${envName}" (${baseUrl}) created via UI and visible in the list`, labels: labelResult(acc) };
  } catch (err) {
    return { ok: false, detail: `create-environment UI flow failed: ${(err as Error).message}`, labels: labelResult(acc) };
  }
}

/**
 * Perform the doc's "Create a New Stack" step in the dashboard UI, exactly as
 * written: Stacks page → "+ New Stack" → "Create New" → dialog (Name mandatory,
 * Description optional, Master Language defaults to en-us) → Create → the doc
 * promises a redirect to the Stack Dashboard, which we assert and use to capture
 * the new stack's API key.
 *
 * Selectors captured from the live dashboard (2026-07):
 *   cs-add-stack · cs-add-stack-create-new · cs-stack-create-title-input ·
 *   cs-stack-create-description-input · cs-stack-select-language · cs-create-stack
 */
export async function createStackUI(
  ctx: ExecContext,
  stackName: string,
  description: string,
  docLabels: string[] = []
): Promise<{ ok: boolean; detail: string; labels?: LabelCheck }> {
  const acc = new Map<string, boolean>();
  try {
    const page = await ensurePage(ctx);
    await page.goto(`${APP}/#!/stacks`);
    await page.waitForSelector('[data-test-id="cs-add-stack"]', { timeout: 20_000 });
    await checkNavLabels(page, docLabels, acc);

    await page.click('[data-test-id="cs-add-stack"]');
    await page.click('[data-test-id="cs-add-stack-create-new"]');
    await page.locator('[data-test-id="cs-stack-create-title-input"] input').fill(stackName);
    await page.locator('[data-test-id="cs-stack-create-description-input"] textarea').fill(description);
    // Master Language (mandatory) defaults to en-us — the doc's example language.
    await page.click('[data-test-id="cs-create-stack"]');

    // The doc's promised outcome: "You will be redirected to the Stack Dashboard."
    await page.waitForURL(/#!\/stack\/(blt[a-z0-9]+)\/dashboard/, { timeout: 30_000 });
    const apiKey = page.url().match(/#!\/stack\/(blt[a-z0-9]+)\//)?.[1];
    if (!apiKey) return { ok: false, detail: "created but could not read the stack API key from the dashboard URL", labels: labelResult(acc) };

    ctx.stackApiKey = apiKey;
    return { ok: true, detail: `stack "${stackName}" created via UI; redirected to Stack Dashboard as the doc promises (api key ${apiKey})`, labels: labelResult(acc) };
  } catch (err) {
    return { ok: false, detail: `create-stack UI flow failed: ${(err as Error).message}`, labels: labelResult(acc) };
  }
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
  docLabels: string[] = [],
  tokenName = "PlateStack"
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
    await page.getByRole("textbox", { name: "name" }).fill(tokenName);

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

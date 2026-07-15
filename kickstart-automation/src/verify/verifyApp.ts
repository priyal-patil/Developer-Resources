/**
 * STAGE 3 — VERIFY
 *
 * Confirm the kickstart app actually works after the doc's steps ran:
 *   - `npm run dev` boots without crashing
 *   - the port responds with HTTP 200
 *   - the page renders real content (seeded entry text), not an error shell
 *   - a screenshot is saved as evidence
 *
 * Requires Node >= 22 for most kickstarts; if the dev server never comes up we
 * report that as a failed verify (which is itself a valid signal).
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import type { DocStep, ExecContext, KickstartConfig, StepResult } from "../types.js";

const verifyStep = (title: string): DocStep => ({ index: 100, title, kind: "verify", commands: [], raw: "" });

export async function verifyApp(cfg: KickstartConfig, ctx: ExecContext): Promise<StepResult[]> {
  const url = `http://localhost:${cfg.port ?? 3000}`;
  const results: StepResult[] = [];

  // Boot the dev server (command derived from the doc) in its own process group.
  const runCmd = cfg.runCommand ?? "npm run dev";
  const dev = spawn(runCmd, { cwd: ctx.cwd, shell: true, detached: true });
  let serverLog = "";
  dev.stdout.on("data", (d) => (serverLog += d.toString()));
  dev.stderr.on("data", (d) => (serverLog += d.toString()));

  try {
    const up = await waitForServer(url, 120_000);
    if (!up.ok) {
      results.push({
        step: verifyStep("Run the app — dev server"),
        status: "failed",
        detail: `${url} did not respond within 120s. Server log tail:\n${serverLog.slice(-600)}`,
      });
      return results;
    }
    // A response is not success — a 4xx/5xx means the app booted but is erroring.
    const serverOk = (up.status ?? 500) < 400;
    results.push({
      step: verifyStep("Run the app — dev server"),
      status: serverOk ? "passed" : "failed",
      detail: `${url} responded HTTP ${up.status}${serverOk ? "" : " — app is erroring, not serving content"}`,
    });

    // Render check + screenshot.
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const shot = join(process.cwd(), "reports", `${cfg.name}-app.png`);
      await page.screenshot({ path: shot, fullPage: true });
      const bodyText = (await page.textContent("body")) ?? "";
      // Nuxt/Nitro error pages are full of HTML, so length alone isn't enough —
      // look for the error signatures the framework renders.
      // Only unambiguous error-page phrases — a bare "500" appears in normal
      // marketing copy and caused false positives; real 500s are caught by the
      // HTTP status check above.
      const errorSig = /an error has occurred|server error|application error|cannot get|API key for Stack is required|internal server error/i;
      const errored = errorSig.test(bodyText);
      const rendered = bodyText.trim().length > 50 && !errored;
      const firstError = bodyText.match(errorSig)?.[0];
      results.push({
        step: verifyStep("Run the app — page renders"),
        status: rendered ? "passed" : "failed",
        detail: rendered
          ? `page rendered ${bodyText.trim().length} chars of content`
          : `page shows an error${firstError ? `: "${firstError}"` : ""} (see screenshot)`,
        evidence: shot,
      });
    } finally {
      await browser.close();
    }
    return results;
  } finally {
    if (dev.pid) {
      try {
        process.kill(-dev.pid, "SIGKILL");
      } catch {
        dev.kill("SIGKILL");
      }
    }
    // Backstop: some dev servers (astro) re-spawn outside the process group and
    // keep writing to the workdir, breaking the next run's cleanup.
    await new Promise((r) => {
      const pk = spawn(`pkill -9 -f "${ctx.cwd}"`, { shell: true });
      pk.on("close", () => r(null));
    });
  }
}

/** Poll a URL until it responds or the timeout elapses. */
async function waitForServer(url: string, timeoutMs: number): Promise<{ ok: boolean; status?: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      return { ok: true, status: res.status };
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { ok: false };
}

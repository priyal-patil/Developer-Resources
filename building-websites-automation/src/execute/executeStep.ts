/**
 * STAGE 2 — EXECUTE
 *
 * Perform one DocStep. Routes by kind:
 *   shell / cli  → run each command in the kickstart's workdir (this slice)
 *   env          → write the `.env` file from known values (TODO — needs creds)
 *   dashboard    → drive the Contentstack dashboard via Playwright (TODO)
 *   verify       → handled in the verify stage
 *
 * STATUS: shell/CLI slice implemented. Credentialed and dashboard paths are stubbed.
 */
import { resolve, join } from "node:path";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import type { DocStep, ExecContext, KickstartConfig, StepResult, StepStatus } from "../types.js";
import { runCommand, policyFor } from "./runner.js";
import { createDeliveryTokenUI, enableLivePreviewUI, getOrgIdFromDashboard, createStackUI, createEnvironmentUI, importContentTypesUI, describeLabelCheck } from "./dashboard.js";
import { extractUiPathLabels } from "../parse/parseDoc.js";
import { createDocEntries } from "./entries.js";

/** Map a CLI region code to the uppercase region code the kickstart repos expect. */
const REGION_CODE: Record<string, string> = {
  "AWS-NA": "US",
  "AWS-EU": "EU",
  "AZURE-NA": "AZURE_NA",
  "AZURE-EU": "AZURE_EU",
  "GCP-NA": "GCP_NA",
};

export async function executeStep(
  step: DocStep,
  cfg: KickstartConfig,
  ctx: ExecContext
): Promise<StepResult> {
  switch (step.kind) {
    case "shell":
    case "cli":
      return runShellStep(step, cfg, ctx);
    case "env":
      return writeEnvStep(step, cfg, ctx);
    case "dashboard":
      return runDashboardStep(step, cfg, ctx);
    case "verify":
      return { step, status: "skipped", detail: "handled in verify stage" };
    default:
      return { step, status: "skipped", detail: "manual/unknown step — reported only" };
  }
}

/** Dispatch a dashboard step to the right UI flow based on its title. */
async function runDashboardStep(step: DocStep, cfg: KickstartConfig, ctx: ExecContext): Promise<StepResult> {
  if (!ctx.hasCreds) return { step, status: "skipped", detail: "dashboard step needs credentials" };

  // The doc's named click-path labels ("Settings > Tokens") are asserted against
  // the live app; a missing label is a doc gap even when the outcome succeeds.
  const docLabels = extractUiPathLabels(step.raw);
  const withLabels = (status: StepResult["status"], detail: string, labels?: Parameters<typeof describeLabelCheck>[0]): StepResult => {
    const labelNote = describeLabelCheck(labels);
    const gap = Boolean(labels?.missing.length);
    return {
      step,
      status: gap && status === "passed" ? "failed" : status,
      detail: labelNote ? `${detail}\n${labelNote}` : detail,
    };
  };

  // Create a New Stack — performed in the dashboard UI exactly as the doc instructs.
  if (/create a new stack/i.test(step.title)) {
    const r = await createStackUI(ctx, ctx.stackName ?? "BW Getting Started", "Created by building-websites-automation (doc verbatim run)", extractUiPathLabels(step.raw));
    const labelNote = describeLabelCheck(r.labels);
    const gap = Boolean(r.labels?.missing.length);
    return {
      step,
      status: r.ok ? (gap ? "failed" : "passed") : "failed",
      detail: labelNote ? `${r.detail}\n${labelNote}` : r.detail,
    };
  }

  // Import Content Types — the doc's exact sequence: download+extract the ZIP it
  // links, then import the four JSONs via the dashboard modal in the doc's order.
  if (/import content types/i.test(step.title)) {
    const zipUrl = step.raw.match(/\((https:[^)]+\.zip)\)/i)?.[1];
    if (!zipUrl) return { step, status: "ambiguous", detail: "GAP: could not find the .zip download link in the doc's step" };
    const dl = await runCommand(`curl -sL -o "StackData.zip" "${zipUrl}" && unzip -o -q StackData.zip`, ctx.cwd, 180_000);
    if (dl.code !== 0) return { step, status: "failed", detail: `downloading/extracting the doc's zip failed: ${(dl.stderr || dl.stdout).slice(0, 200)}` };

    const base = join(ctx.cwd, "Stack Data", "Content Types");
    // The doc's stated order: Dishes, Header, Footer, Page.
    const files = [
      { name: "Dishes", path: join(base, "Dishes", "dishes.json") },
      { name: "Header", path: join(base, "Header", "header.json") },
      { name: "Footer", path: join(base, "Footer", "footer.json") },
      { name: "Page",   path: join(base, "Page", "page.json") },
    ];
    const missing = files.filter((f) => !existsSync(f.path));
    if (missing.length) return { step, status: "failed", detail: `GAP: zip does not contain the file(s) the doc references: ${missing.map((m) => m.name).join(", ")}` };

    const r = await importContentTypesUI(ctx, files);
    return { step, status: r.ok ? "passed" : "failed", detail: r.detail };
  }

  // Create Entries — performed with the doc's exact values (via Management API,
  // reported transparently); the confirmed doc gaps stay in the report.
  if (/create entries/i.test(step.title)) {
    const r = await createDocEntries(ctx);
    const gaps = [
      "GAP: the doc creates entries only for Header, Footer, and ONE Page (Home) — no entries for the imported Dishes content type (its zip even ships dish images), and no Page entries for /menu, /about-us, /contact although the Header/Footer navigation links point there.",
    ].join("\n");
    return {
      step,
      status: r.ok ? "failed" : "failed", // gaps above are doc bugs regardless of execution success
      detail: `[api] ${r.detail}\n${gaps}`,
    };
  }

  // Launch deployment is report-only by design (no real cloud deploys from the harness).
  if (/deploy.*launch/i.test(step.title)) {
    return {
      step,
      status: "skipped",
      detail: "report-only by design: the harness does not perform real Launch deployments",
    };
  }

  // Live Preview first (a title may mention both), then any token-creation step.
  if (/live preview/i.test(step.title)) {
    const r = await enableLivePreviewUI(ctx, cfg, docLabels);
    // Live Preview is non-blocking for the app to render; treat UI failure as ambiguous, not fatal.
    return withLabels(r.how === "failed" ? "ambiguous" : "passed", r.detail, r.labels);
  }
  if (/create environment.*token|environment and delivery token/i.test(step.title)) {
    // Inputs come from the doc's own text (Name: development, Base URL, token name).
    const envName = step.raw.match(/Name\*{0,2}:?\s*\*{0,2}\s*([a-z][\w-]+)/i)?.[1] ?? "development";
    const baseUrl = step.raw.match(/(http:\/\/localhost[^\s`")\]]*)/)?.[1] ?? "http://localhost:3000/";
    const tokenName = step.raw.match(/Enter\s*[\u201c"]([^\u201d"]+)[\u201d"]/)?.[1] ?? "PlateStack";

    const envR = await createEnvironmentUI(ctx, envName, baseUrl, extractUiPathLabels(step.raw));
    if (!envR.ok) return { step, status: "failed", detail: envR.detail };
    const tokR = await createDeliveryTokenUI(ctx, cfg, [], tokenName);
    const detail = `${envR.detail}\n[${tokR.how}] ${tokR.detail}`;
    return { step, status: tokR.how === "failed" ? "failed" : "passed", detail };
  }

  if (/token/i.test(step.title)) {
    // Dependent variants' docs say to reuse the token created in the base variant.
    if (ctx.reused && ctx.deliveryToken) {
      return { step, status: "passed", detail: "reusing delivery/preview token from the base variant's stack (as the doc instructs)" };
    }
    const r = await createDeliveryTokenUI(ctx, cfg, docLabels);
    return withLabels(r.how === "failed" ? "failed" : "passed", `[${r.how}] ${r.detail}`, r.labels);
  }
  return { step, status: "skipped", detail: "unrecognized dashboard step" };
}

/** Write the kickstart's .env from the seeded stack + captured tokens. */
function writeEnvStep(step: DocStep, cfg: KickstartConfig, ctx: ExecContext): StepResult {
  if (!ctx.stackApiKey || !ctx.deliveryToken) {
    return { step, status: "skipped", detail: "no stack/token available (dashboard stage incomplete)" };
  }
  // Region value format differs per framework (bare "NA" vs prefixed "AWS-NA").
  // Match whatever the repo's own .env.example uses so we supply a valid value.
  const cliRegion = process.env.CONTENTSTACK_REGION ?? "AWS-NA";
  const example = readRepoEnvExample(ctx.cwd);
  const exampleRegion = example[Object.keys(example).find((k) => /_REGION$/.test(k)) ?? ""] ?? "";
  const region = /AWS-|AZURE-|GCP-/i.test(exampleRegion) ? cliRegion : (REGION_CODE[cliRegion] ?? "NA");
  const valueFor = (key: string): string => {
    if (/_API_KEY$/.test(key)) return ctx.stackApiKey!;
    if (/_DELIVERY_TOKEN$/.test(key)) return ctx.deliveryToken!;
    if (/_PREVIEW_TOKEN$/.test(key)) return ctx.previewToken ?? "";
    if (/_REGION$/.test(key)) return region;
    if (/_ENVIRONMENT$/.test(key)) return ctx.environment ?? "preview";
    if (/_PREVIEW$/.test(key)) return "true";
    return "";
  };

  let docKeys = cfg.envKeys ?? [];
  let sameAsEarlier = false;
  if (!docKeys.length && ctx.baseEnvKeys?.length && /same\b.*(earlier|previous|listed)|as in the previous/i.test(step.raw)) {
    docKeys = ctx.baseEnvKeys;
    sameAsEarlier = true;
  }
  let exportGapNote = "";
  if (!docKeys.length) {
    // This doc's env code block is EMPTY in the markdown/"Copy for LLM" export
    // (reported as a doc-pipeline finding). The webpage shows the keys; the starter's
    // .env.sample carries the same names, so we use those to perform the step.
    docKeys = readRepoEnvKeys(ctx.cwd);
    exportGapNote = "GAP (export): the doc's env code block is empty in the markdown export — keys taken from the starter's .env.sample (as shown on the webpage).\n";
    if (!docKeys.length) return { step, status: "ambiguous", detail: "no env var names found in doc or repo" };
  }

  // Verbatim: write EXACTLY the keys the doc lists — do not substitute the repo's.
  // If they don't match what the repo reads, that's a reported gap (the app will break).
  // The filename comes from the doc too (some kickstarts use .env.local).
  const envFile = /\.env\.local\b/.test(`${step.title} ${step.raw}`) ? ".env.local" : ".env";
  const path = join(ctx.cwd, envFile);
  writeFileSync(path, docKeys.map((k) => `${k}=${valueFor(k)}`).join("\n") + "\n");

  const repoKeys = readRepoEnvKeys(ctx.cwd);
  const mismatch = repoKeys.length ? describeMismatch(docKeys, repoKeys) : null;
  if (mismatch) {
    return {
      step,
      status: "failed",
      detail: `GAP: the doc's env var names do not match what the repo reads (.env.example). Wrote the doc's keys verbatim — the app will not pick up config.\n${mismatch}`,
    };
  }
  return {
    step,
    status: exportGapNote ? "failed" : "passed",
    detail: sameAsEarlier
      ? `doc says "same variables as earlier" — wrote the base variant's ${docKeys.length} keys → ${path}`
      : `${exportGapNote}wrote ${docKeys.length} vars from the doc verbatim → ${path}`,
  };
}

/** Read the env var names the repo actually expects, from its .env.example. */
function readRepoEnvKeys(repoDir: string): string[] {
  const p = [".env.example", ".env.sample"].map((f) => join(repoDir, f)).find(existsSync);
  if (!p) return [];
  return [...readFileSync(p, "utf8").matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
}

/** Read key→example-value pairs from the repo's .env.example (comments stripped). */
function readRepoEnvExample(repoDir: string): Record<string, string> {
  const p = join(repoDir, ".env.example");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const m of readFileSync(p, "utf8").matchAll(/^([A-Z][A-Z0-9_]+)=([^\n#]*)/gm)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** Describe how the doc's env keys differ from the repo's, or null if they match. */
function describeMismatch(docKeys: string[], repoKeys: string[]): string | null {
  const docOnly = docKeys.filter((k) => !repoKeys.includes(k));
  const repoOnly = repoKeys.filter((k) => !docKeys.includes(k));
  if (!docOnly.length && !repoOnly.length) return null;
  return [
    docOnly.length ? `  doc has (repo doesn't): ${docOnly.join(", ")}` : "",
    repoOnly.length ? `  repo expects (doc omits): ${repoOnly.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function runShellStep(step: DocStep, cfg: KickstartConfig, ctx: ExecContext): Promise<StepResult> {
  const log: string[] = [];
  let worst: StepStatus = "passed";

  for (const cmd of step.commands) {
    const policy = policyFor(cmd);

    // `cd` just moves our working directory for subsequent commands.
    const cdMatch = cmd.match(/^cd\s+(.+)/);
    if (cdMatch) {
      ctx.cwd = resolve(ctx.cwd, cdMatch[1].trim());
      log.push(`cd → ${ctx.cwd}`);
      continue;
    }

    if (policy === "interactive" && !ctx.hasCreds) {
      log.push(`⏭  ${cmd}  (interactive — needs manual/creds run)`);
      worst = downgrade(worst, "skipped");
      continue;
    }
    if (policy === "needs-creds" && !ctx.hasCreds) {
      log.push(`⏭  ${cmd}  (needs test-org credentials)`);
      worst = downgrade(worst, "skipped");
      continue;
    }
    if (policy === "deferred") {
      log.push(`↩  ${cmd}  (deferred to verify stage)`);
      continue;
    }

    // The doc's seed command needs the Org ID, which the doc says to get from the
    // dashboard (Org Admin → Info) — perform that browser step before seeding,
    // asserting the doc's named click-path labels exist in the app.
    if (/^csdx cm:stacks:seed\b/.test(cmd) && !ctx.orgId && ctx.hasCreds) {
      const orgName = process.env.CONTENTSTACK_ORG_NAME ?? "Contentstack QA";
      const r = await getOrgIdFromDashboard(ctx, orgName, extractUiPathLabels(step.raw));
      log.push(`   ↳ ${r.detail}`);
      const labelNote = describeLabelCheck(r.labels);
      if (labelNote) log.push(`   ↳ ${labelNote.replace(/\n/g, "\n   ↳ ")}`);
      if (r.labels?.missing.length) worst = downgrade(worst, "failed");
    }

    // Rewrite for non-interactive/credentialed execution; log the ORIGINAL (redacted) form.
    const toRun = rewriteCommand(cmd, cfg, ctx);
    // Seeding large stacks (e.g. kickstart-veda-seed) can far exceed the default timeout.
    const timeoutMs = /^csdx cm:stacks:seed\b/.test(cmd) ? 900_000 : undefined;
    const res = await runCommand(toRun, ctx.cwd, timeoutMs);
    if (res.timedOut) {
      log.push(`✗ ${cmd}  (timed out)`);
      worst = downgrade(worst, "failed");
    } else if (res.code !== 0) {
      log.push(`✗ ${cmd}  (exit ${res.code})\n${(res.stderr || res.stdout).slice(0, 500)}`);
      worst = downgrade(worst, "failed");
    } else {
      log.push(`✓ ${cmd}`);
      captureSeedOutput(cmd, `${res.stdout}\n${res.stderr}`, ctx, log);
    }
  }

  return { step, status: worst, detail: log.join("\n") };
}

/**
 * Adapt a doc command for headless execution:
 *  - inject `-u/-p` into `csdx auth:login` (password never enters the log)
 *  - fix the doc's empty `--org ""`, add `-y`, and give the stack a unique name
 */
function rewriteCommand(cmd: string, _cfg: KickstartConfig, ctx: ExecContext): string {
  const env = process.env;

  // The doc's region is just an example; use the region matching the test account.
  if (/^csdx config:set:region\b/.test(cmd) && env.CONTENTSTACK_REGION) {
    return `csdx config:set:region ${env.CONTENTSTACK_REGION}`;
  }

  if (/^csdx auth:login\b/.test(cmd) && !/(-u\b|--username)/.test(cmd)) {
    return `csdx auth:login -u "${env.CONTENTSTACK_EMAIL}" -p "${env.CONTENTSTACK_PASSWORD}"`;
  }

  if (/git clone .*your-username/.test(cmd) && _cfg.repo) {
    return `git clone ${_cfg.repo}`;
  }

  if (/^csdx cm:stacks:seed\b/.test(cmd)) {
    // Use the Org ID obtained from the dashboard; fall back to env if unavailable.
    const orgId = ctx.orgId ?? env.CONTENTSTACK_ORG_ID ?? "";
    // Fill the doc's org placeholder (empty "", or a <YOUR_ORG_ID> token).
    let c = cmd.replace(/--org\s+("[^"]*"|'[^']*'|<[^>]+>)/g, `--org "${orgId}"`);
    if (!/--org\s+\S/.test(c)) c += ` --org "${orgId}"`;
    if (ctx.stackName) c = c.replace(/(-n|--stack-name)\s+"[^"]*"/, `$1 "${ctx.stackName}"`);
    if (!/(-y\b|--yes\b)/.test(c)) c += " -y";
    return c;
  }

  return cmd;
}

/** Pull the new stack's API key out of seed output so the env stage can use it. */
function captureSeedOutput(cmd: string, stdout: string, ctx: ExecContext, log: string[]): void {
  if (!/^csdx cm:stacks:seed\b/.test(cmd)) return;
  const m = stdout.match(/api[_ ]?key["'\s:=]+([a-zA-Z0-9]{6,})/i);
  if (m) {
    ctx.stackApiKey = m[1];
    log.push(`   ↳ seeded stack api key: ${m[1]}`);
  }
}

/** Keep the most severe status seen so far. */
function downgrade(current: StepStatus, next: StepStatus): StepStatus {
  const rank: Record<StepStatus, number> = {
    passed: 0,
    skipped: 1,
    ambiguous: 2,
    missing: 3,
    failed: 4,
  };
  return rank[next] > rank[current] ? next : current;
}

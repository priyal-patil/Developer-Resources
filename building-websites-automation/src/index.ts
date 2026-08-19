/**
 * ORCHESTRATOR — ties the four stages together for one or all kickstarts.
 *
 *   parse → execute → verify → report
 *
 * Usage:
 *   npm run run-one            # first kickstart in config
 *   npm run run-one -- nuxt    # a specific kickstart by name
 *   npm run run-all            # every kickstart in config
 */
import "dotenv/config";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { DocStep, ExecContext, KickstartConfig, KickstartResult } from "./types.js";
import { parseDocFull, deriveFromDoc } from "./parse/parseDoc.js";
import { executeStep } from "./execute/executeStep.js";
import { verifyApp } from "./verify/verifyApp.js";
import { checkProjectStructure, checkCodeSnippets } from "./verify/crossCheck.js";
import { generateReport } from "./report/generateReport.js";
import { deleteStack, cdnHost } from "./api/contentstack.js";
import { closeDashboard } from "./execute/dashboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const kickstarts: KickstartConfig[] = JSON.parse(
  readFileSync(join(root, "config", "docs.json"), "utf8")
);

const workdirRoot = resolve(root, process.env.WORKDIR ?? "./workdir");
const hasCreds = Boolean(process.env.CONTENTSTACK_EMAIL && process.env.CONTENTSTACK_PASSWORD);

/** Restrict parsed steps to this variant's range, if configured. */
function stepsForVariant(all: DocStep[], cfg: KickstartConfig): DocStep[] {
  if (!cfg.stepRange) return all;
  const [start, end] = cfg.stepRange;
  return all.filter((s) => s.index >= start && s.index <= end);
}

/** Stack/tokens produced by a base variant, kept for dependents that reuse it. */
interface SharedStack {
  envKeys?: string[];
  stackApiKey?: string;
  deliveryToken?: string;
  previewToken?: string;
  orgId?: string;
  environment?: string;
}
const sharedStacks = new Map<string, SharedStack>();

async function runOne(input: KickstartConfig): Promise<KickstartResult> {
  console.log(`\n=== ${input.name} (${input.variant ?? "default"}) ===\n${input.doc}`);

  // Parse the doc, then fill missing config (repo/port/envKeys/stackName) from it.
  const parsed = await parseDocFull(input.doc);
  const steps = stepsForVariant(parsed.steps, input);
  const cfg = deriveFromDoc(steps, input);
  console.log(`  repo ${cfg.repo ?? "?"} · port ${cfg.port} · ${cfg.envKeys?.length ?? 0} env keys (from doc)`);

  // Fresh, isolated working directory per kickstart.
  const cwd = join(workdirRoot, cfg.name);
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  mkdirSync(cwd, { recursive: true });
  const ctx: ExecContext = {
    cwd,
    hasCreds,
    // Unique stack name per run so repeated runs don't collide in a shared org.
    stackName: `${cfg.stackName} ${Date.now().toString(36)}`,
    // Per-doc default: the first doc instructs a "development" environment;
    // override via config (see docs.json) for docs that use a different name.
    environment: cfg.environment ?? "development",
    cdnHost: cdnHost(),
  };

  // The doc for this variant says to reuse the stack created by the base variant.
  if (cfg.reuseStackFrom) {
    const base = sharedStacks.get(cfg.reuseStackFrom);
    if (base?.stackApiKey) {
      const { envKeys, ...stackFields } = base;
      Object.assign(ctx, stackFields, { reused: true, baseEnvKeys: envKeys });
      console.log(`  ↺ reusing stack ${base.stackApiKey} from "${cfg.reuseStackFrom}" (as the doc instructs)`);
    } else {
      console.log(`  ⚠ doc says to reuse the stack from "${cfg.reuseStackFrom}", but no base run provided one`);
    }
  }

  const results = [];
  try {
    for (const step of steps) {
      // The doc's "run the app" step is superseded by the dedicated verify stage.
      if (step.kind === "verify") continue;
      const r = await executeStep(step, cfg, ctx);
      console.log(`  ${icon(r.status)} [${step.kind}] ${step.title}`);
      results.push(r);
    }

    // Cross-check the doc's claims against the cloned repo (structure + code snippets).
    // Page-level blocks describe the BASE variant's repo; checking them against a
    // dependent variant's repo would produce false gaps.
    const isBase = !cfg.stepRange || cfg.stepRange[0] === 0;
    if (isBase) {
      const structure = checkProjectStructure(ctx.cwd, parsed.structure);
      console.log(`  ${icon(structure.status)} [check] ${structure.step.title}`);
      results.push(structure);
      for (const snip of checkCodeSnippets(ctx.cwd, parsed.snippets)) {
        console.log(`  ${icon(snip.status)} [check] ${snip.step.title}`);
        results.push(snip);
      }
    }

    results.push(...(await verifyApp(cfg, ctx)));
  } finally {
    await closeDashboard(ctx);
    const hasDependents = kickstarts.some((k) => k.reuseStackFrom === cfg.name);
    if (ctx.stackApiKey && hasDependents && !ctx.reused) {
      // Defer teardown: later variants reuse this stack (per their docs).
      sharedStacks.set(cfg.name, {
        envKeys: cfg.envKeys,
        stackApiKey: ctx.stackApiKey,
        deliveryToken: ctx.deliveryToken,
        previewToken: ctx.previewToken,
        orgId: ctx.orgId,
        environment: ctx.environment,
      });
      console.log(`  ⏸ keeping stack ${ctx.stackApiKey} for dependent variants`);
    } else if (ctx.stackApiKey && !ctx.reused) {
      // Auto-teardown: delete the stack this run seeded so the shared org stays clean.
      const ok = await deleteStack(ctx.stackApiKey).catch(() => false);
      console.log(`  ${ok ? "🧹 torn down" : "⚠ teardown failed for"} stack ${ctx.stackApiKey}`);
    }
  }

  return {
    kickstart: cfg.name,
    startedAt: new Date().toISOString(),
    steps: results,
    ok: results.every((r) => r.status !== "failed" && r.status !== "missing"),
  };
}

function icon(status: string): string {
  return { passed: "✓", failed: "✗", missing: "?", skipped: "⏭", ambiguous: "~" }[status] ?? "•";
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const named = args.filter((a) => !a.startsWith("--"));
  const targets = all
    ? kickstarts
    : named.length
      ? kickstarts.filter((k) => named.includes(k.name))
      : [kickstarts[0]];

  const results: KickstartResult[] = [];
  for (const cfg of targets) {
    try {
      results.push(await runOne(cfg));
    } catch (err) {
      console.error(`  ✗ ${cfg.name}: ${(err as Error).message}`);
    }
  }

  // Merge with previous report so single-kickstart re-runs don't wipe the rest;
  // this run's result replaces the older one for the same kickstart.
  const reportPath = join(root, "reports", "latest.json");
  let merged = results;
  try {
    const prev: KickstartResult[] = JSON.parse(readFileSync(reportPath, "utf8")).results ?? [];
    const fresh = new Set(results.map((r) => r.kickstart));
    merged = [...prev.filter((p) => !fresh.has(p.kickstart)), ...results];
    // Keep config order for a stable report.
    const order = new Map(kickstarts.map((k, i) => [k.name, i]));
    merged.sort((a, b) => (order.get(a.kickstart) ?? 99) - (order.get(b.kickstart) ?? 99));
  } catch {
    /* no previous report — write this run's results as-is */
  }
  // Tear down stacks that were kept alive for dependent variants.
  for (const [name, s] of sharedStacks) {
    if (!s.stackApiKey) continue;
    const ok = await deleteStack(s.stackApiKey).catch(() => false);
    console.log(`${ok ? "🧹 torn down" : "⚠ teardown failed for"} shared stack ${s.stackApiKey} (${name})`);
  }

  generateReport(merged, reportPath);
}

main();

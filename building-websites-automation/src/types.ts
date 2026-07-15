/** Shared types for the read → execute → verify → report pipeline. */

export type StepKind = "shell" | "cli" | "dashboard" | "env" | "verify" | "unknown";

/** One step extracted from a Kickstart doc. */
export interface DocStep {
  index: number;
  title: string;
  kind: StepKind;
  /** Raw commands/instructions pulled from the doc for this step. */
  commands: string[];
  /** Original prose, kept for the report so we can show doc-vs-actual. */
  raw: string;
}

/**
 * A Kickstart entry from config/kickstarts.json. Only `name` + `doc` are required —
 * `repo`, `port`, `envKeys`, `stackName` are derived from the doc when omitted
 * (see deriveFromDoc). Provide them only to override the derived values.
 */
export interface KickstartConfig {
  name: string;
  doc: string;
  /** Which guide on the page this entry is, e.g. "standard" | "ssr". */
  variant?: string;
  /** Inclusive [start, end] step indexes for this variant within the doc. */
  stepRange?: [number, number];
  repo?: string;
  seedRepo?: string;
  stackName?: string;
  port?: number;
  nodeVersion?: string;
  envKeys?: string[];
  /** Command to start the app, derived from the doc's Run step (e.g. "npm run dev"). */
  runCommand?: string;
  /**
   * Name of another config entry whose stack/tokens this variant reuses, when its
   * doc says "use the same Stack created earlier". The base's stack is torn down
   * only after all dependents have run.
   */
  reuseStackFrom?: string;
}

/** Mutable state threaded across a single kickstart's steps (e.g. the working dir). */
export interface ExecContext {
  /** Current working directory commands run in; `cd` steps mutate this. */
  cwd: string;
  /** True when test-org credentials are available in the environment. */
  hasCreds: boolean;
  /** API key of the stack created by the seed step, if any. */
  stackApiKey?: string;
  /** Name of the stack created by the seed step (unique per run). */
  stackName?: string;
  /** Environment the seed publishes to (Contentstack seed uses "preview"). */
  environment?: string;
  /** Org ID read from the dashboard (Org Admin → Info), as the doc instructs. */
  orgId?: string;
  /** True when this run reuses the stack/tokens of a base variant (per its doc). */
  reused?: boolean;
  /** Env var names from the base variant, for docs that say "same vars as earlier". */
  baseEnvKeys?: string[];
  /** Tokens produced by the dashboard stage, consumed by the env stage. */
  deliveryToken?: string;
  previewToken?: string;
  /** Live Playwright session, lazily created by the dashboard stage. */
  browser?: unknown;
  page?: unknown;
}

export type StepStatus = "passed" | "failed" | "missing" | "skipped" | "ambiguous";

/** Result of attempting one step. */
export interface StepResult {
  step: DocStep;
  status: StepStatus;
  detail: string;
  /** Path to evidence (screenshot, log) if any. */
  evidence?: string;
}

/** Full result for one Kickstart. */
export interface KickstartResult {
  kickstart: string;
  startedAt: string;
  steps: StepResult[];
  ok: boolean;
}

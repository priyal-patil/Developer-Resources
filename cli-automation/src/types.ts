/** Shared types for the CLI docs automation. */

/** One fenced code block from the doc, classified by what it contains. */
export type BlockKind =
  | "command" // runnable csdx command(s)
  | "syntax" // usage declaration like `csdx cm:stacks:export [OPTIONS]`
  | "ci" // CI pipeline yaml (GitHub Actions / GitLab) with an embedded csdx command
  | "json" // a config file the doc asks you to create
  | "tree" // a directory-structure tree the doc promises
  | "output" // sample terminal output (not executable)
  | "code" // illustrative TS/JS source (a Command class, a test file) — not a standalone runnable command
  | "unknown";

export interface DocBlock {
  id: number;
  /** Heading breadcrumb, e.g. "Examples > Export All Modules". */
  section: string;
  /** Bold label immediately above the block, e.g. "Using Stack API Key:". */
  label: string;
  raw: string;
  kind: BlockKind;
}

/** A row of the doc's Options table. */
export interface DocOption {
  /** Long flag, e.g. "--stack-api-key". */
  flag: string;
  /** Short flag, e.g. "-k" (if documented). */
  short?: string;
  description: string;
  required: string;
}

/** A row of the doc's Configuration File Options table. */
export interface DocConfigOption {
  key: string;
  description: string;
  type: string;
  default: string;
}

/** A prose paragraph (non-code text) with its section breadcrumb. */
export interface ProseSegment {
  section: string;
  text: string;
}

export interface ParsedDoc {
  name: string;
  title: string;
  url: string;
  lastUpdated?: string;
  prerequisites: string[];
  blocks: DocBlock[];
  options: DocOption[];
  configOptions: DocConfigOption[];
  prose: ProseSegment[];
  /**
   * Per-command Options, for docs (e.g. cli-authentication, configure-regions)
   * that document several subcommands, each with its own inline "**Options**"
   * bullet list or table rather than one shared heading-level Options table.
   * Keyed by command path, e.g. "auth:login", "config:set:region".
   */
  commandOptions: Record<string, DocOption[]>;
}

/** A flag as reported by `csdx <command> --help`. */
export interface CliFlag {
  flag: string;
  short?: string;
  description: string;
}

export interface FlagFinding {
  kind:
    | "missing-in-doc" // CLI has it, doc's Options table doesn't
    | "extra-in-doc" // doc lists it, CLI --help doesn't
    | "short-flag-mismatch"
    | "description-mismatch";
  flag: string;
  doc?: string;
  cli?: string;
}

export interface ExecResult {
  blockId: number;
  section: string;
  label: string;
  /** The command exactly as printed in the doc. */
  docCommand: string;
  /** What actually ran, after dummy→real value substitution (secrets redacted). */
  runCommand: string;
  substitutions: string[];
  status: "pass" | "fail" | "skipped";
  skipReason?: string;
  exitCode?: number;
  durationMs?: number;
  /** Tail of combined stdout+stderr. */
  outputTail?: string;
  /** Human description of how reality diverged from what the doc promises. */
  gap?: string;
}

export interface LintFinding {
  blockId: number;
  section: string;
  label: string;
  issue: string;
  snippet: string;
}

export interface StructureFinding {
  kind: "missing-on-disk" | "extra-on-disk" | "note";
  entry: string;
  detail?: string;
}

export interface RunReport {
  doc: { name: string; title: string; url: string; lastUpdated?: string };
  startedAt: string;
  finishedAt: string;
  environment: {
    node: string;
    csdxVersion: string;
    region: string;
    stackApiKey: string;
    stackName: string;
  };
  prerequisites: { text: string; status: "pass" | "fail" | "info"; detail?: string }[];
  execResults: ExecResult[];
  flagFindings: FlagFinding[];
  /** Findings for each audited command (cm:stacks:export and its cm:export alias). */
  flagAudits: { command: string; docOptionCount: number; cliFlagCount: number; findings: FlagFinding[] }[];
  structureFindings: StructureFinding[];
  /** Static text lint of every code block (typos, smart quotes, invisible chars). */
  lintFindings: LintFinding[];
  teardown: { stackDeleted: boolean; aliasRemoved: boolean; configRestored: boolean };
  verdict: "PASS" | "GAPS";
  gapCount: number;
}

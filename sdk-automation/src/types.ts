export interface DocConfig {
  name: string;
  url: string;
  sdkPackage: string;
  sdkKind: "delivery" | "delivery-legacy-js" | "delivery-python" | "delivery-dotnet" | "delivery-php" | "delivery-ruby" | "delivery-dart" | "delivery-android" | "management" | "management-python" | "management-java" | "management-dotnet" | "marketplace" | "app" | "marketplace-java" | "delivery-java";
  runtime: "node-ts" | "node-js" | "java" | "python" | "dotnet" | "php" | "ruby" | "dart" | "android";
  /** Key into config/sdk-repos.json - the cloned repo under repos/<repoName> used for source-level audit alongside the installed npm package. */
  repoName?: string;
  /** Source subdirectory inside the cloned repo to audit against - defaults to "src"; some repos (e.g. plain-JS SDKs) use "lib" instead. */
  repoSrcSubdir?: string;
  /**
   * "md" (default): fetch `<url>.md`, parseDoc.ts's heuristics. "dom":
   * scrape the rendered page with parseDocDom.ts instead - use this when
   * the doc site's markdown/LLM export flattens multi-example code-tab
   * widgets into one corrupted blob (confirmed on the TypeScript Delivery
   * SDK reference; likely true site-wide, not just this one doc).
   */
  scrapeMode?: "md" | "dom";
  /** For sdkKind "delivery-legacy-js": the import specifier passed to the harness (e.g. "contentstack/react-native" for the React Native doc, which documents the same package's alternate build target). Defaults to "contentstack". */
  jsImportSpecifier?: string;
}

/** One method/property documented under a nav section (e.g. "fetch" under "Asset"). */
export interface MethodEntry {
  id: number;
  navSection: string;
  method: string;
  description: string;
  /** Raw fenced code block(s) found under this heading, in doc order. */
  codeBlocks: string[];
}

export interface ParsedDoc {
  name: string;
  title: string;
  url: string;
  lastUpdated?: string;
  /** Top-level left-nav section names, in doc order. */
  navSections: string[];
  methods: MethodEntry[];
}

export type RunOutcome = "pass" | "fail" | "no-example" | "skipped";

export interface RunResult {
  methodId: number;
  navSection: string;
  method: string;
  outcome: RunOutcome;
  /** JSON.stringify of the resolved value, truncated. */
  resolvedOutput?: string;
  error?: string;
  /** Why a method was deliberately not executed (org-level scope, unimplemented create-then-delete, etc.) - only set when outcome is "skipped". */
  skipReason?: string;
  /** placeholder -> real seeded value substitutions applied to this snippet. */
  substitutions: Record<string, string>;
}

export interface AuditFinding {
  methodId: number;
  navSection: string;
  method: string;
  kind: "missing-method" | "output-mismatch" | "lint";
  detail: string;
}

export interface RunReport {
  docName: string;
  docUrl: string;
  runId: string;
  results: RunResult[];
  findings: AuditFinding[];
}

/**
 * Harness for the Ruby Delivery SDK doc
 * (https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/ruby/reference).
 *
 * Each snippet is wrapped in a runnable .rb script and executed with the
 * Homebrew-installed Ruby (system Ruby is 2.6, too old for the gem's
 * `required_ruby_version >= 3.3`) against the real published `contentstack`
 * gem.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunResult } from "../types.js";

const execFileAsync = promisify(execFile);

const RESULT_MARKER = "__SDK_AUTOMATION_RESULT__";
const ERROR_MARKER = "__SDK_AUTOMATION_ERROR__";
// Prefer whatever "ruby" resolves to on PATH (e.g. ruby/setup-ruby's install
// in CI, already >=3.3) - only fall back to this project's own local macOS
// Homebrew path (needed there since system Ruby is 2.6) when that exact
// path exists.
const HOMEBREW_RUBY_BIN = "/opt/homebrew/opt/ruby/bin/ruby";
const RUBY_BIN = existsSync(HOMEBREW_RUBY_BIN) ? HOMEBREW_RUBY_BIN : "ruby";

function rubyEnv(): NodeJS.ProcessEnv {
  if (!existsSync(HOMEBREW_RUBY_BIN)) return { ...process.env };
  return { ...process.env, PATH: `/opt/homebrew/opt/ruby/bin:${process.env.PATH}` };
}

function rubyPlaceholderMap(): Record<string, string> {
  return {
    api_key: process.env.STACK_API_KEY ?? "",
    delivery_token: process.env.DELIVERY_TOKEN ?? "",
    environment: process.env.ENVIRONMENT ?? "production",
    content_type_uid: "blog_post",
    entry_uid: process.env.SEED_ENTRY_UID ?? "",
    asset_uid: process.env.SEED_ASSET_UID ?? "",
    global_field_uid: process.env.SEED_GLOBAL_FIELD_UID ?? "",
    field_uid: "title",
    live_preview_hash: "",
  };
}

function substituteRb(code: string, map: Record<string, string>): { code: string; substitutions: Record<string, string> } {
  let out = code;
  const substitutions: Record<string, string> = {};
  for (const [placeholder, real] of Object.entries(map)) {
    if (!real) continue;
    const re = new RegExp(`(['"])${placeholder}\\1`, "g");
    if (re.test(out)) {
      out = out.replace(re, `$1${real}$1`);
      substitutions[placeholder] = real;
    }
  }
  return { code: out, substitutions };
}

/** Last top-level (brace/paren-depth 0) `@ivar = expr` assignment. */
function lastTopLevelAssignment(code: string): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let last: string | undefined;
  const re = /@(\w+)\s*=(?!=)/g;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "(") depth++;
    else if (ch === "}" || ch === ")") depth--;
    else if (depth === 0 && ch === "@") {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m.index === i) last = m[1];
    }
  }
  return last;
}

/**
 * Ruby's leading-dot method-chain continuation (`.foo` on its own line,
 * continuing the previous line's expression) only works when the dot-line
 * immediately follows - a blank line in between breaks it, and the parser
 * treats the previous line as a complete statement instead (confirmed with
 * a minimal repro). This doc's own rendering separates every logical line
 * with a blank line, which corrupts every multi-line chained-call example
 * on the page. Not a doc bug - the same code without the blank lines is
 * valid Ruby - so this is fixed at the harness level: drop a blank line
 * whenever the next non-blank line starts with `.` or `&.`.
 */
function fixLeadingDotContinuations(code: string): string {
  const lines = code.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && /^\s*\.{1,2}\w|^\s*&\./.test(lines[j])) continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

function buildHarness(body: string): string {
  const withoutRequires = fixLeadingDotContinuations(
    body
      .split("\n")
      .filter((l) => !/^\s*require\s+["']contentstack["']/.test(l))
      .join("\n")
  );
  const lastVar = lastTopLevelAssignment(withoutRequires);

  return `require "contentstack"

begin
${withoutRequires}
${lastVar ? `  puts ${JSON.stringify(RESULT_MARKER)} + @${lastVar}.to_s` : ""}
rescue => e
  puts ${JSON.stringify(ERROR_MARKER)} + e.message
  exit 1
end
`;
}

export async function runRubySnippet(
  runDir: string,
  methodId: number,
  navSection: string,
  method: string,
  rawCode: string
): Promise<RunResult> {
  const { code: substituted, substitutions } = substituteRb(rawCode, rubyPlaceholderMap());
  const harness = buildHarness(substituted);

  mkdirSync(runDir, { recursive: true });
  const file = `${runDir}/ruby-snippet-${methodId}.rb`;
  writeFileSync(file, harness);

  try {
    const { stdout } = await execFileAsync(RUBY_BIN, [file], { timeout: 30_000, env: rubyEnv(), cwd: process.cwd() });
    const resultLine = stdout.split("\n").find((l) => l.includes(RESULT_MARKER));
    return {
      methodId,
      navSection,
      method,
      outcome: "pass",
      resolvedValue: resultLine ? resultLine.slice(resultLine.indexOf(RESULT_MARKER) + RESULT_MARKER.length) : undefined,
      substitutions,
    };
  } catch (e: any) {
    const stdout: string = e.stdout ?? "";
    const stderr: string = e.stderr ?? "";
    const errorLine = stdout.split("\n").find((l: string) => l.includes(ERROR_MARKER));
    const message = errorLine
      ? errorLine.slice(errorLine.indexOf(ERROR_MARKER) + ERROR_MARKER.length)
      : stderr || stdout || e.message || String(e);
    return {
      methodId,
      navSection,
      method,
      outcome: "fail",
      error: message,
      substitutions,
    };
  }
}

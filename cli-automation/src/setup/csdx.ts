/**
 * csdx helpers: locate the Node-22 csdx binary (the doc's prerequisite is
 * Node 22+; on older Node csdx --help dies with ERR_REQUIRE_ESM), run
 * commands with a prompt responder, and snapshot/restore the global CLI
 * config so doc steps like `csdx config:set:log` can't leak state.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Bin dir of the newest Node >= 22 installed via nvm that ALSO has csdx
 * globally installed. Picking purely by version number is unsafe — a newer
 * Node install with no global @contentstack/cli package has no bin/csdx of
 * its own, so a naive PATH prepend falls through to whatever csdx appears
 * later on PATH (observed: silently landed on a stale Node 21 install with
 * the known ERR_REQUIRE_ESM crash bug).
 */
export function node22Bin(): string {
  const nvmDir = path.join(homedir(), ".nvm/versions/node");
  if (!existsSync(nvmDir)) {
    // No nvm here — e.g. a CI runner where actions/setup-node@v4 puts a
    // single Node version directly on PATH, with no per-version nvm
    // layout to scan. Trust the CURRENT runtime + PATH instead, but still
    // enforce the doc's real Node >= 22 prerequisite explicitly rather
    // than silently running under whatever's active.
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 22) {
      throw new Error(`Node >= 22 required (doc prerequisite) — current runtime is Node ${process.versions.node} and no ~/.nvm install was found to select a newer one`);
    }
    return path.dirname(process.execPath);
  }
  const versions = readdirSync(nvmDir)
    .map((v) => v.match(/^v(\d+)\.(\d+)\.(\d+)$/))
    .filter((m): m is RegExpMatchArray => !!m && Number(m[1]) >= 22)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || Number(b[2]) - Number(a[2]) || Number(b[3]) - Number(a[3]));
  const withCsdx = versions.find((v) => existsSync(path.join(nvmDir, v[0], "bin", "csdx")));
  if (!withCsdx) {
    throw new Error(
      versions.length
        ? `Node >= 22 found (${versions.map((v) => v[0]).join(", ")}) but none has @contentstack/cli installed globally — run "npm install -g @contentstack/cli" under one of them`
        : "No Node >= 22 found under ~/.nvm (doc prerequisite)"
    );
  }
  return path.join(nvmDir, withCsdx[0], "bin");
}

export function csdxEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${node22Bin()}:${process.env.PATH}` };
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Patterns to auto-answer if the command prompts interactively. */
  prompts?: { re: RegExp; send: string; label?: string }[];
}

export interface RunOutcome {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
  /** Interactive prompts the runner answered (recorded in the report). */
  promptsAnswered: string[];
}

export const DEFAULT_PROMPTS = [
  { re: /encryption key/i, send: "cli-automation-key\n" },
  // Path prompt from `cm:stacks:export` without --data-dir; Enter accepts the default.
  { re: /Enter the path[^:]*:/i, send: "\n" },
  // The doc's own bare `csdx auth:login` example (no -u/-p flags) prompts
  // interactively — answer with the real QA account credentials.
  { re: /email|username/i, send: `${process.env.CONTENTSTACK_EMAIL ?? ""}\n`, label: "<QA account email>" },
  { re: /password/i, send: `${process.env.CONTENTSTACK_PASSWORD ?? ""}\n`, label: "<QA account password>" },
  { re: /\(y\/n\)|\(Y\/n\)/, send: "y\n" },
  { re: /are you sure/i, send: "yes\n" },
  // compare-and-merge-branches-using-the-cli doc's merge example that omits
  // --base-branch prompts for it as required text input — blank Enter loops
  // forever ("This field can't be empty."); "main" is the real base branch
  // on every stack we seed.
  // config:set:base-branch's own wizard drops the "name" suffix
  // ("Enter base branch ") that cm:branches:diff/:merge use — match both.
  { re: /Enter base branch(\s+name)?\b/i, send: "main\n" },
  // cm:branches:diff/:merge's bare wizard asks for the compare branch next
  // as required text input too — "develop" matches the doc's own dummy
  // compare-branch convention; this plan typically has no second branch
  // alive by this point in the run, so it legitimately resolves to a real
  // "Invalid compare branch" error rather than hanging, same as the doc's
  // own flagged examples using the same dummy name.
  { re: /Enter compare branch name/i, send: "develop\n" },
  // cm:branches:create's bare wizard asks for the source branch next.
  { re: /Enter source branch/i, send: "main\n" },
  { re: /Enter branch UID/i, send: "cli-automation-bare-branch\n" },
  // configure-early-access-program-in-the-cli doc's bare
  // config:set:early-access-header wizard asks for alias then value as
  // required text input.
  { re: /Please enter Early Access header alias/i, send: "cli-automation-alias\n" },
  { re: /Please enter Early Access header value/i, send: "cli-automation-value\n" },
  // configure-rate-limits-in-the-cli doc's bare config:set/remove:rate-limit
  // wizards ask for the org UID as required text input — the generic
  // catch-all's blank Enter is silently accepted (no validation), but that
  // tests an empty-org edge case rather than the doc's real intent.
  { re: /Provide the organization UID/i, send: `${process.env.CONTENTSTACK_ORG_ID ?? ""}\n` },
  // Generic inquirer prompt fallback — covers both text-input prompts
  // ("? Enter X:") and list-select prompts ("? Please select a region
  // (Use arrow keys)", no colon). Enter accepts the default/highlighted
  // choice either way.
  { re: /^\?\s.+$/m, send: "\n" },
];

/** Run a shell command, answering known prompts, with a hard timeout. */
export function run(command: string, opts: RunOptions = {}): Promise<RunOutcome> {
  const { cwd, timeoutMs = 10 * 60 * 1000, prompts = DEFAULT_PROMPTS } = opts;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("bash", ["-c", command], { cwd, env: csdxEnv() });
    // If the child exits/crashes right after printing a prompt (e.g. the
    // known ERR_REQUIRE_ESM crash on a stale Node install), a subsequent
    // stdin.write throws EPIPE as an unhandled 'error' event and takes down
    // this whole automation process. Swallow it — the run() call still
    // resolves normally via the child's 'close' event.
    child.stdin.on("error", () => {});
    let out = "";
    let timedOut = false;
    let lastAnswered = "";
    // Prompts whose `send` is more than a bare newline (real typed text, e.g.
    // a type-ahead org/project name) must fire exactly ONCE per occurrence —
    // the redraw-tolerant tail check below re-fires on every keystroke's
    // redraw (the screen text keeps changing as inquirer echoes each typed
    // character), which previously caused the same string to be typed
    // repeatedly into a filter box. Track those by index instead.
    const sentOnce = new Set<number>();
    // Once a prompt gets a REAL typed answer, the child keeps redrawing
    // that same prompt line as it echoes each typed character back over
    // several separate stdout chunks — during that window, a generic
    // blank-Enter rule (the catch-all) can ALSO match the still-visible
    // "? Enter the stack api key bl..." text and fire a stray blank Enter
    // into the middle of the real answer being typed, truncating it
    // (verified by hand: this produced an empty stack key server-side
    // despite the real value having been written correctly). Track which
    // patterns already got a real typed answer and suppress every OTHER
    // (blank-answer) rule while that same prompt is still the active one.
    const typedAnsweredPatterns: RegExp[] = [];
    const promptsAnswered: string[] = [];
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (out.length > 200_000) out = out.slice(-150_000);
      // Answer at most one prompt per pattern occurrence to avoid loops.
      const tail = out.slice(-500);
      // Terminal prompts redraw via cursor-repositioning ANSI codes rather
      // than real newlines, so an OLD, already-answered prompt's text can
      // remain joined with a NEWER, different prompt inside the same
      // sliding tail window with no newline between them. Matching rules
      // against the whole tail let the old prompt's rule keep re-firing
      // and send a stray blank Enter onto whatever prompt is now actually
      // active — verified by hand: this silently submitted a later "Enter
      // the stack api key" prompt as empty before its own real-value rule
      // ever got a chance to answer it. Every prompt observed from this
      // CLI is inquirer-style, prefixed with "? " (question mark + a real
      // space) — restrict matching to text from the LAST such marker
      // onward, i.e. the prompt that's actually on-screen right now.
      // Plain lastIndexOf("?") is NOT enough: ANSI cursor-control codes
      // like "\x1b[?25l" (hide cursor) also contain a literal "?", and one
      // of those can appear AFTER the real prompt text (e.g. list-style
      // prompts print it right after rendering) — matching on THAT "?"
      // truncated activeSegment down to just the ANSI fragment, missing
      // the actual prompt text entirely and leaving list-style prompts
      // like "? Hosting type" unanswerable (confirmed by hand: a real
      // app:deploy hung 10 minutes on exactly this). ANSI "?" is always
      // followed by digits, never whitespace, so "?" + whitespace reliably
      // disambiguates a real inquirer prompt marker from an ANSI code.
      let lastQ = -1;
      for (const qm of tail.matchAll(/\?\s/g)) lastQ = qm.index ?? lastQ;
      const activeSegment = lastQ === -1 ? tail : tail.slice(lastQ);
      if (typedAnsweredPatterns.some((re) => re.test(activeSegment))) return;
      for (let i = 0; i < prompts.length; i++) {
        const p = prompts[i];
        const isTypedAnswer = p.send.length > 1 && p.send !== "\n";
        if (isTypedAnswer && sentOnce.has(i)) continue;
        const m = activeSegment.match(p.re);
        if (m && (isTypedAnswer || lastAnswered !== tail)) {
          lastAnswered = tail;
          if (isTypedAnswer) {
            sentOnce.add(i);
            typedAnsweredPatterns.push(p.re);
          }
          // Terminal UIs redraw the prompt line; keep answering redraws
          // (harmless newlines) but record each unique prompt once. Use
          // `label` instead of the literal answer for secrets (credentials).
          const entry = `"${m[0].trim().slice(0, 80)}" → ${JSON.stringify(p.label ?? p.send)}`;
          if (!promptsAnswered.includes(entry)) promptsAnswered.push(entry);
          try {
            child.stdin.write(p.send);
          } catch {
            /* child already exited — 'error' listener above covers the async case */
          }
          break;
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output: out, timedOut, durationMs: Date.now() - started, promptsAnswered });
    });
    // A cwd that doesn't exist (or other spawn-level failures) fires this
    // instead of ever starting the child — without a handler, Node treats
    // it as an unhandled 'error' event and crashes the whole automation
    // process (confirmed by hand: create-custom-cli-plugins' own "cd
    // ./myplugin" example, read literally right after an earlier step
    // already changed into that same directory, resolves to a nonexistent
    // nested path). Resolve as a real, honest failure instead — a bad cwd
    // is exactly the kind of doc-structure gap this harness should report,
    // not crash on.
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, output: out + `\n[spawn error: ${err.message}]`, timedOut, durationMs: Date.now() - started, promptsAnswered });
    });
  });
}

/** The csdx global config dir ("conf" storage: Library/Preferences on macOS). */
function csdxConfigDir(): string {
  return process.platform === "darwin"
    ? path.join(homedir(), "Library", "Preferences", "@contentstack")
    : path.join(homedir(), ".config", "@contentstack");
}

export function snapshotCsdxConfig(backupDir: string): boolean {
  const src = csdxConfigDir();
  if (!existsSync(src)) return false;
  rmSync(backupDir, { recursive: true, force: true });
  mkdirSync(path.dirname(backupDir), { recursive: true });
  cpSync(src, backupDir, { recursive: true });
  return true;
}

export function restoreCsdxConfig(backupDir: string): boolean {
  const dst = csdxConfigDir();
  if (!existsSync(backupDir)) return false;
  rmSync(dst, { recursive: true, force: true });
  cpSync(backupDir, dst, { recursive: true });
  return true;
}

/** Point the CLI at the QA region and log in (flags keep it non-interactive). */
export async function csdxLogin(): Promise<void> {
  const region = process.env.CONTENTSTACK_REGION ?? "AWS-NA";
  const r1 = await run(`csdx config:set:region ${region}`);
  if (r1.exitCode !== 0) throw new Error(`config:set:region failed: ${r1.output.slice(-300)}`);
  const r2 = await run(
    `csdx auth:login -u "${process.env.CONTENTSTACK_EMAIL}" -p "${process.env.CONTENTSTACK_PASSWORD}"`
  );
  if (r2.exitCode !== 0 || /error/i.test(r2.output.slice(-200))) {
    throw new Error(`auth:login failed: ${r2.output.slice(-300)}`);
  }
}

export async function addTokenAlias(alias: string, apiKey: string, token: string): Promise<void> {
  const r = await run(`csdx auth:tokens:add -a ${alias} -k ${apiKey} --management --token "${token}" -y`);
  if (r.exitCode !== 0) throw new Error(`auth:tokens:add failed: ${r.output.slice(-300)}`);
}

export async function removeTokenAlias(alias: string): Promise<boolean> {
  const r = await run(`csdx auth:tokens:remove -a ${alias}`, {
    prompts: [{ re: /confirm|\(y\/n\)|select/i, send: "\n" }],
    timeoutMs: 60_000,
  });
  return r.exitCode === 0;
}

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

const DEFAULT_PROMPTS = [
  { re: /encryption key/i, send: "cli-automation-key\n" },
  // Path prompt from `cm:stacks:export` without --data-dir; Enter accepts the default.
  { re: /Enter the path[^:]*:/i, send: "\n" },
  // The doc's own bare `csdx auth:login` example (no -u/-p flags) prompts
  // interactively — answer with the real QA account credentials.
  { re: /email|username/i, send: `${process.env.CONTENTSTACK_EMAIL ?? ""}\n`, label: "<QA account email>" },
  { re: /password/i, send: `${process.env.CONTENTSTACK_PASSWORD ?? ""}\n`, label: "<QA account password>" },
  { re: /\(y\/n\)|\(Y\/n\)/, send: "y\n" },
  { re: /are you sure/i, send: "yes\n" },
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
      for (const p of prompts) {
        const m = tail.match(p.re);
        if (m && lastAnswered !== tail) {
          lastAnswered = tail;
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

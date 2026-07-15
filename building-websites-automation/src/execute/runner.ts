/** Low-level command runner + a policy for what is safe to auto-run. */
import { spawn } from "node:child_process";

export interface CmdResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a shell command in `cwd`, capturing output with a timeout (ms). */
export function runCommand(cmd: string, cwd: string, timeoutMs = 300_000): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
    });
  });
}

export type CmdPolicy = "run" | "needs-creds" | "interactive" | "deferred";

/**
 * Decide how a single command should be handled in the shell/CLI slice.
 *  - run         : safe, no credentials, terminates on its own
 *  - needs-creds : requires test-org login (seed, publish) — run only when creds present
 *  - interactive : prompts for input and would hang — never auto-run
 *  - deferred    : belongs to another stage (e.g. `npm run dev` → verify)
 */
export function policyFor(cmd: string): CmdPolicy {
  const c = cmd.trim().toLowerCase();
  if (/^npm run dev\b|^npm run start\b|^npm start\b/.test(c)) return "deferred";
  if (/^csdx auth:login\b/.test(c)) return "interactive";
  if (/^csdx cm:stacks:seed\b|^csdx cm:.*publish\b/.test(c)) return "needs-creds";
  if (/^cd\s/.test(c)) return "run";
  if (/^(git clone|git |npm install|npm ci|npm run |npx |node )/.test(c)) return "run";
  if (/^csdx config:/.test(c)) return "run";
  return "run";
}

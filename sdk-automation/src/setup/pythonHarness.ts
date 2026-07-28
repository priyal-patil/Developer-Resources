/**
 * Python execution environment for the Delivery SDK Python doc - a venv at
 * pyharness/venv with the real published `contentstack` pip package
 * installed, created once and reused across a run (mirrors the Java
 * harness's cached classpath resolution).
 */
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = new URL("../../", import.meta.url).pathname;
export const VENV_DIR = `${ROOT}pyharness/venv`;
export const VENV_PYTHON = `${VENV_DIR}/bin/python`;

export async function ensurePythonVenv(packages: string[] = ["contentstack"]): Promise<void> {
  if (!existsSync(VENV_PYTHON)) {
    await execFileAsync("python3", ["-m", "venv", VENV_DIR]);
  }
  await execFileAsync(VENV_PYTHON, ["-m", "pip", "install", "--quiet", ...packages], { timeout: 120_000 });
}

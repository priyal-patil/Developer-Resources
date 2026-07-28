/**
 * Classpath resolution for the Java Delivery SDK doc - separate Maven
 * project from javaharness/ (the Marketplace SDK's) since both packages
 * share the `com.contentstack.sdk` groupId/base package; mixing both on one
 * classpath risks class-name collisions (e.g. both may declare their own
 * `com.contentstack.sdk.Region`). Otherwise identical pattern to
 * javaHarness.ts - see its doc comment for the JAVA_HOME/PATH note.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { JAVA_HOME, javaEnv } from "./javaHarness.js";

const execFileAsync = promisify(execFile);

const HARNESS_DIR = new URL("../../javaharness-delivery", import.meta.url).pathname;
const CP_FILE = `${HARNESS_DIR}/cp.txt`;

export { JAVA_HOME, javaEnv };

export async function resolveDeliveryClasspath(): Promise<string> {
  if (existsSync(CP_FILE)) return readFileSync(CP_FILE, "utf8").trim();
  console.log("[java-delivery-harness] Resolving Maven classpath (first run only, cached to javaharness-delivery/cp.txt)...");
  await execFileAsync("mvn", ["-q", "dependency:build-classpath", "-Dmdep.outputFile=cp.txt"], {
    cwd: HARNESS_DIR,
    env: javaEnv(),
    timeout: 120_000,
  });
  return readFileSync(CP_FILE, "utf8").trim();
}

/**
 * Resolves (once, cached to disk) the Maven classpath needed to compile and
 * run generated snippet files against the real published
 * `com.contentstack.sdk:marketplace` artifact - `javaharness/pom.xml` is a
 * minimal throwaway Maven project that exists only to let
 * `mvn dependency:build-classpath` resolve every transitive dependency
 * (retrofit, okhttp, gson, org.json, ...) into one colon-separated path,
 * reused for every snippet's `javac`/`java` invocation instead of paying
 * Maven's startup cost per method.
 *
 * Homebrew's OpenJDK isn't registered with macOS's `/usr/libexec/java_home`
 * by default - plain `java`/`javac` on PATH fail with "Unable to locate a
 * Java Runtime" even though a real JDK is installed, confirmed live. Every
 * subprocess call here sets `JAVA_HOME`/`PATH` explicitly rather than
 * relying on the ambient shell environment.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);

const JAVA_HARNESS_DIR = new URL("../../javaharness", import.meta.url).pathname;
const CP_FILE = `${JAVA_HARNESS_DIR}/cp.txt`;
// Prefer the ambient JAVA_HOME (set by actions/setup-java in CI, or by any
// standard JDK install) - only fall back to this project's own local macOS
// Homebrew path when nothing else is set, so local dev on this machine
// keeps working unchanged.
export const JAVA_HOME = process.env.JAVA_HOME ?? "/opt/homebrew/Cellar/openjdk/25/libexec/openjdk.jdk/Contents/Home";

export function javaEnv(): NodeJS.ProcessEnv {
  return { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH}` };
}

export async function resolveClasspath(): Promise<string> {
  if (existsSync(CP_FILE)) return readFileSync(CP_FILE, "utf8").trim();
  console.log("[java-harness] Resolving Maven classpath (first run only, cached to javaharness/cp.txt)...");
  await execFileAsync("mvn", ["-q", "dependency:build-classpath", "-Dmdep.outputFile=cp.txt"], {
    cwd: JAVA_HARNESS_DIR,
    env: javaEnv(),
    timeout: 120_000,
  });
  return readFileSync(CP_FILE, "utf8").trim();
}

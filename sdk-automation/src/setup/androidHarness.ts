/**
 * Android Delivery SDK execution environment - a Maven project
 * (androidharness/) resolving most dependencies normally, plus a handful
 * manually extracted from Google Maven .aar artifacts (the real SDK
 * itself, Volley, and several androidx.test/tracing/annotation jars
 * Robolectric's own bootstrap needs even though the snippets never
 * reference them directly - see androidharness/pom.xml's comments for why
 * each one couldn't just be a normal Maven <dependency>).
 *
 * Also needs a legacy `com.google.android:android` stub jar purely so
 * `javac` can resolve `android.content.Context`/`android.app.Application`
 * at compile time - Robolectric supplies the REAL framework behavior at
 * runtime via its own sandboxed classloader regardless of what's on this
 * stub, so its age (Android 4.1-era) doesn't matter for the one class our
 * harness code references directly.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync } from "node:fs";

const execFileAsync = promisify(execFile);

// Prefer the ambient JAVA_HOME (set by actions/setup-java in CI, or by any
// standard JDK install) - only fall back to this project's own local macOS
// Homebrew path when nothing else is set.
export const JAVA_HOME = process.env.JAVA_HOME ?? "/opt/homebrew/Cellar/openjdk/25/libexec/openjdk.jdk/Contents/Home";
const ROOT = new URL("../../", import.meta.url).pathname;
const ANDROID_HARNESS_DIR = `${ROOT}androidharness`;

export function javaEnv(): NodeJS.ProcessEnv {
  return { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH}` };
}

let cachedClasspath: string | undefined;

export async function resolveAndroidClasspath(): Promise<string> {
  if (cachedClasspath) return cachedClasspath;
  const cpFile = `${ANDROID_HARNESS_DIR}/cp.txt`;
  if (!existsSync(cpFile)) {
    await execFileAsync("mvn", ["-q", "dependency:build-classpath", "-Dmdep.outputFile=cp.txt"], {
      cwd: ANDROID_HARNESS_DIR,
      env: javaEnv(),
      timeout: 180_000,
    });
  }
  const mavenCp = readFileSync(cpFile, "utf8").trim();
  const extraDir = `${ANDROID_HARNESS_DIR}/extracted-libs`;
  const extraJars = existsSync(extraDir) ? readdirSync(extraDir).filter((f) => f.endsWith(".jar")).map((f) => `${extraDir}/${f}`) : [];
  const androidStub = `${ANDROID_HARNESS_DIR}/android-stub.jar`;
  const annotationJar = `${ANDROID_HARNESS_DIR}/annotation-1.7.0.jar`;
  cachedClasspath = [mavenCp, ...extraJars, androidStub, annotationJar].join(":");
  return cachedClasspath;
}

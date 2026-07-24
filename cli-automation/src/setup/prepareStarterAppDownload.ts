/**
 * bootstrap-starter-apps' "Run the Bootstrap Starter App" / "Run the
 * Compass Starter" sections have real "Download the website code" links
 * (not code blocks) followed by real commands (`cp .env.example
 * .env.development`, `npm install`) that assume the reader already
 * extracted that download into their current folder. This downloads and
 * extracts the real zip a reader would get from that link, so those
 * commands have something genuine to operate on instead of failing with a
 * misleading "no such file" purely because the harness never fetched it.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { run } from "./csdx.js";

export async function downloadAndExtractStarterApp(url: string, destDir: string): Promise<string> {
  mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, "starter-app.zip");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download starter app zip from ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import("node:fs");
  writeFileSync(zipPath, buf);
  const r = await run(`unzip -q ${JSON.stringify(zipPath)} -d ${JSON.stringify(destDir)}`, { timeoutMs: 60_000 });
  if (r.exitCode !== 0) throw new Error(`Failed to extract starter app zip: ${r.output.slice(-300)}`);
  // The zip always contains exactly one top-level folder (e.g.
  // "contentstack-react-starter-app-master/") — find it rather than
  // hardcoding its name, since it varies by repo/tag.
  const entries = readdirSync(destDir).filter((e) => !e.startsWith(".") && e !== "starter-app.zip" && existsSync(path.join(destDir, e)));
  const topDir = entries.find((e) => !e.endsWith(".zip"));
  if (!topDir) throw new Error(`Extracted zip at ${destDir} has no top-level folder`);
  return path.join(destDir, topDir);
}

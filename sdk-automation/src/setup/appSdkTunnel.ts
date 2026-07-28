/**
 * Serves testapp/dist statically and exposes it via a public tunnel
 * (localtunnel - pure npm dependency, no external account/binary needed).
 * The App SDK doc's snippets only run for real inside an iframe embedded in
 * the actual Contentstack UI, which requires a real, publicly-reachable URL
 * for the app's manifest to point at - there's no way to fake this locally.
 * The served bundle contains no secrets (org creds never reach the browser;
 * see testapp/src/init.ts) and the tunnel is only kept up for a run's
 * lifetime.
 *
 * Uses a FIXED subdomain (not localtunnel's random default) - discovered
 * via live testing that once a Custom Field is added to a content type's
 * schema, the field's iframe URL appears to be pinned/cached rather than
 * re-resolved from the app manifest's live `ui_location.base_url` on every
 * page load (a fresh tunnel with a new random URL was NOT picked up by an
 * already-existing field, even after `configureAppLocations()` correctly
 * updated the manifest). A stable subdomain sidesteps needing to
 * recreate/re-bind the field every run. localtunnel's free `loca.lt`
 * subdomains aren't globally reserved, so this could theoretically be taken
 * by someone else between runs - `startAppSdkTunnel()`'s caller should treat
 * a different returned `url` than expected as a signal to reconfigure the
 * app (via `configureAppLocations`) again.
 */
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import localtunnel from "localtunnel";

const DIST_DIR = new URL("../../testapp/dist", import.meta.url).pathname;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
};

export interface AppSdkTunnel {
  url: string;
  close: () => Promise<void>;
}

const SUBDOMAIN = "sdk-automation-appsdk-test";

export async function startAppSdkTunnel(port = 4321): Promise<AppSdkTunnel> {
  if (!existsSync(`${DIST_DIR}/bundle.js`)) {
    throw new Error(`${DIST_DIR}/bundle.js not found - run "npm run build:testapp" first.`);
  }

  const server: Server = createServer((req, res) => {
    const path = req.url === "/" || !req.url ? "/index.html" : req.url;
    const file = `${DIST_DIR}${path}`;
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  const tunnel = await localtunnel({ port, subdomain: SUBDOMAIN });

  return {
    url: tunnel.url,
    close: async () => {
      tunnel.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1]?.endsWith("appSdkTunnel.ts")) {
  startAppSdkTunnel().then((t) => {
    console.log(`[app-sdk-tunnel] Serving testapp/dist at ${t.url}`);
    console.log("Press Ctrl+C to stop.");
  });
}

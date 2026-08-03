/**
 * Minimal test-harness app for the App SDK doc automation. Does nothing but
 * initialize the SDK and expose the resulting instance on `window` -
 * `runAppSdkSnippet.ts` runs the doc's own snippet bodies via
 * `frame.evaluate()` against this, reusing whatever UI location context the
 * real Contentstack UI actually embedded this app in (Custom Field, Sidebar
 * Widget, Dashboard Widget, ...) - never faked or simulated.
 */
import ContentstackAppSDK from "@contentstack/app-sdk";

(window as any).__appSdkStatus = "initializing";
// The doc's own `ContentstackAppSDK.init()` example (and any snippet that
// references the class directly, not just the already-initialized `sdk`
// instance) needs the class itself in scope too.
(window as any).ContentstackAppSDK = ContentstackAppSDK;

ContentstackAppSDK.init()
  .then((sdk) => {
    (window as any).sdk = sdk;
    (window as any).__appSdkStatus = "ready";
  })
  .catch((e) => {
    (window as any).__appSdkError = e && e.message ? e.message : String(e);
    (window as any).__appSdkStatus = "error";
  });

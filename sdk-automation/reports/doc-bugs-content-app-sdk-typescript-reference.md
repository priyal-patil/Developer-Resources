# Doc bugs — TypeScript App SDK Reference

Source: https://www.contentstack.com/docs/developers/sdks/contentstack-app-sdk/typescript/reference
Scope: 89 documented methods/properties across 13 nav sections.

**Results: 45/89 passed, 16 failed, 20 skipped (by design, deferred to a follow-up pass), 78 audit findings.**

This doc is architecturally different from the Delivery/Management/Marketplace SDK docs automated earlier in this project, which required a new execution model built from scratch for this pass - see "Why this doc needed a live browser" below before reading the results.

## Why this doc needed a live browser, not a Node subprocess

The App SDK runs **inside an iframe embedded in the real Contentstack web UI** and talks to the parent frame over `postMessage` (via the `post-robot` library). `ContentstackAppSDK.init()` does nothing meaningful in plain Node.js - there's no parent frame to talk to, confirmed by trying it directly. So unlike the other three docs (plain REST clients, testable via a generated `.ts` file run with `tsx`), this doc's snippets can only be verified by:

1. Building a minimal test-harness app (`testapp/`) that does nothing but call `ContentstackAppSDK.init()` and expose the result on `window`.
2. Hosting it publicly (a local static server + a `localtunnel` tunnel with a fixed subdomain).
3. Creating a real Marketplace app pointed at that tunnel URL, configured with `ui_location` entries for 5 UI locations, and installing it on a real dedicated stack.
4. Logging into the real Contentstack UI with Playwright, navigating to a real entry-edit page and a real dashboard page, locating the app's own iframes there, and running each doc snippet verbatim via `frame.evaluate()` **inside that live iframe** - genuinely exercising the real postMessage handshake against the real UI, not a simulation.

## First-increment scope: 68 of 89 methods

**In scope:** `ContentstackAppSDK` (the SDK class itself), `CustomField`, `SidebarWidget`, `FieldModifierLocation`, `DashboardWidget`, and the bulk of the real API surface, `App SDK Core Objects` (Stack/Entry/Field/Frame/Store) - reachable by installing one app across CustomField + SidebarWidget + FieldModifierLocation on a single entry-edit page, plus DashboardWidget on its own stack-dashboard page.

**Deferred to a follow-up pass (skipped, documented as known-incomplete - same precedent as the Management/Marketplace docs' org-level/destructive skip lists):**
- `GlobalFullPageLocation` - org-level app install, a separate setup from this pass's stack-scoped app.
- `AppConfigWidget` - reached via a different nav flow (an app-configuration modal, not a content page).
- `AssetSidebarWidget` - needs a real asset context and, for `replaceAsset(file)`, an actual binary `File` object.
- `ContentTypeSidebarWidget`, `RTEPlugin`/`RTELocation` - need live UI interaction (a content-type page's own sidebar; the RTE toolbar's plugin button actually rendered and clicked) to verify anything beyond "the registration call didn't throw."
- `FullPage` - its own dedicated full-page app route couldn't be reliably discovered in this pass.

## Confirmed doc bugs

**`stack.getEntries()` and `stack.getAssets()` don't exist.** Both are documented as top-level `Stack` object methods (`await stack.getEntries('content_type_uid')`, `await stack.getAssets()`), but running them verbatim throws `TypeError: stack.getEntries is not a function` / `stack.getAssets is not a function`. Confirmed against the cloned repo's real source (`repos/app-sdk/src/stack/index.ts`) - no `getEntries` or `getAssets` method exists anywhere on the Stack class. The SDK does expose asset-related functionality, but namespaced differently (`stack.Asset.getAssetsOfSpecificTypes(...)`, not a bare `stack.getAssets()`). This is a real, confirmed doc bug - the documented method names simply don't exist on the real object.

**`getPropertySafely(obj, key)` references an undeclared bare identifier.** The doc's own example is `const value = entry.getPropertySafely(dataObject, 'propertyName');` - `dataObject` is never declared anywhere in the snippet. Running it verbatim throws `ReferenceError: dataObject is not defined`. The example needs either a real object literal or a clearly-marked placeholder assignment above it.

## Known, not-a-bug limitations

- **`setData('new value')` fails validation** - our seeded test field is `data_type: "json"` (required so the field could be bound to our installed app at all), but the doc's literal example passes a plain string. This is a fixture/harness mismatch, not a doc bug - the example is presumably written for a text-type field.
- **`getGlobalField`, `getEnvironment`, `getWorkflow`, `getVariantById`** all fail with real, clean API errors (`"was not found"`, `"Variant Not Found"`, etc.) because their placeholder UIDs (`global_field_uid`, `production`, `workflow_uid`, `variant_uid`) don't correspond to real seeded resources in this pass's stack - incomplete coverage, not confirmed bugs, same category as the Management SDK doc's unseeded sections.
- **Frame Object methods reached via the wrong location's variable name** - `enableResizing()`, `enableAutoResizing()`, `disableAutoResizing()`, `onDashboardResize(callback)`, `enablePaddingTop()`, `disablePaddingTop()`, `updateDimension(dimension?)`, `closeModal()` all fail with `Cannot read properties of null (reading 'frame')`. Their own doc examples use `dashboard.frame`/`fieldModifier.frame` (assuming those variables were already declared from the DashboardWidget/FieldModifierLocation sections read earlier on the same page) - since this pass exercises all of "App SDK Core Objects" from the CustomField iframe, `sdk.location.DashboardWidget`/`.FieldModifierLocation` correctly resolve to `null` there (those locations aren't the one this particular iframe was embedded as). This is an inherent limitation of testing Frame-object methods outside their own location's real iframe, not a bug in the doc or SDK - each Frame instance genuinely only exists where its owning location is actually rendered.

## Harness bugs found and fixed during this session (not doc/SDK issues)

Building the live-browser harness surfaced several bugs in this project's own code, all fixed before the final run:
- **Frame detachment**: an early version navigated the same Playwright tab from the entry-edit page to the dashboard page to look up the `DashboardWidget` iframe, which detached the already-found `CustomField` iframe reference used by ~63 other methods - every one of them failed with "Frame was detached" in the first attempt (0 passed). Fixed by using two separate browser tabs.
- **Incomplete cleanup**: `teardownAppSdk()` initially only uninstalled+deleted the test app, leaving the dedicated stack behind after every run. Fixed to also delete the stack.
- **Circular-JSON crash on genuinely-successful snippets**: `DashboardWidget`, `CustomField`, `Stack Object`, `getField`, and `updateHeight` all failed with `"Converting circular structure to JSON"` even though the snippets themselves succeeded - Playwright's own cross-boundary result serialization was choking on live SDK objects with circular references. Fixed by JSON-stringifying (with a circular-safe replacer) *inside* the browser before the result ever crosses back to Node.
- **`ContentstackAppSDK.init()` itself failing**: the test harness only exposed the already-initialized `sdk` instance on `window`, not the `ContentstackAppSDK` class itself, so the doc's own `ContentstackAppSDK.init()` example threw `ReferenceError: ContentstackAppSDK is not defined`. Fixed by exposing the class too.

## Undocumented platform quirks discovered while building the setup

- **`ui_location.base_url` must be resent explicitly on every `ui_location` update.** It is NOT derived from `hosting.deployment_url` except at the moment an app is first created - a later `ui_location` update without `base_url` in the same payload 400s with `"ui_location.base_url is invalid"`, even immediately after `hosting.deployment_url` was set correctly in a prior call.
- **An Extension's `src` is pinned at install time.** Reconfiguring an already-installed app's `ui_location`/`hosting` does NOT update the already-generated Extension record's own `src` field (confirmed via `GET /v3/extensions/{uid}` directly) - the only way to pick up a new tunnel URL is a full uninstall + reinstall, which generates fresh Extension records. This is why the harness always does a fresh reinstall rather than an idempotent "skip if already installed" check.
- **`localtunnel` needs a fixed subdomain and a bypass header.** A fresh random subdomain wasn't picked up by an already-created content-type field pointing at the old URL (see the pinned-`src` point above) - a stable subdomain avoids needing to re-wire the field on every run. Separately, any request to the tunnel needs a `bypass-tunnel-reminder` header or `localtunnel`'s free service shows an anti-bot interstitial page instead of the real app.
- **The docs site's own "ContentstackAppSDK" nav link 404s** (redirects to a broken URL missing the `/docs` prefix) - recovered by falling back to the root page's own content, which happens to already cover this section.
- **The "App SDK Core Objects" page nests headings two levels deeper** (h3 object name → h4 method, or h4 "Properties"/"Methods"/"Events" group-label → h5 method) than every other SDK doc scraped so far (which only ever needed h2/h3). The original per-heading `wrapper.nextElementSibling` sibling-chain walk broke at this depth (`heading.closest(".group")` matched a much higher shared ancestor, losing the actual code widget) - fixed by rewriting the scraper as a single linear `TreeWalker` pass over the whole article instead of per-heading sibling chains. Verified this rewrite doesn't regress the other three docs (re-ran the Management SDK doc's scrape afterward: still exactly 261 methods, 35 no-example, matching the existing baseline).

## Cross-verification: SDK's own test suite - not meaningful here

Unlike the Management/Marketplace SDK docs, there's no live-API cross-check possible for this repo. `repos/app-sdk/__test__/` is entirely mocked Jest unit tests around `post-robot` message handling (e.g. `Store`'s tests construct a fake `connection` object and assert `sendToParent` was called with the right message shape) - no real UI, no real API, no real postMessage handshake involved at all. Running it would only re-confirm the mocks match the source, not provide any independent live signal the way Management/Marketplace's `test/sanity-check` suites did.

## Audit findings (78 total)

Mostly **missing-method** findings from `signatureAudit`'s exact-text match against the installed package's `.d.ts` files - a large fraction are artifacts of the audit comparing the doc's heading text (which includes full parameter signatures, e.g. `"getData()"`, `"onSave(callback)"`) against `.d.ts` declarations that don't repeat that exact substring, the same heading-format artifact already documented in the Management/Marketplace SDK reports, not evidence the methods are missing (`getData`, `onSave`, etc. are all real, confirmed-passing methods in this run). The genuine misses are the ones already covered above (`getEntries`, `getAssets`) plus the sections deferred this pass (their methods can't be confirmed present or absent without executing them).

## Final counts

45 passed · 16 failed (2 confirmed doc bugs - missing `getEntries`/`getAssets`; 1 confirmed doc bug - `getPropertySafely`'s undeclared identifier; 8 Frame-object location-context limitations; 4 unseeded-fixture 404s; 1 fixture data-type mismatch) · 20 skipped (5 deferred sections' methods) · 78 audit findings (mostly heading-signature-format artifacts, a few genuine).

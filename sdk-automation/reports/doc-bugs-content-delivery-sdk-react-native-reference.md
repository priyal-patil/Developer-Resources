# Doc automation report: Content Delivery SDK — React Native reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/react-native/reference
SDK repo: `contentstack/contentstack-javascript` (same repo/package as the JavaScript-browser doc — npm package `contentstack`, imported via the alternate build target `contentstack/react-native`)
Fixtures: shared with all other Delivery SDK language docs — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus the seeded asset and global field.

## Final result

78 documented methods → **52 passed, 20 failed, 6 no-example**.

## No emulator needed — this is the same JS SDK, different build target

Checked the SDK's `package.json` and `webpack/` config before assuming this doc needs React Native/emulator infrastructure: the `contentstack` npm package builds 4 separate bundles (`node`, `web`, `react-native`, `nativescript`) from the **same source** — it's a pure HTTP client with no native module dependencies. Confirmed directly: `import Contentstack from 'contentstack/react-native'` resolves and runs identically under plain Node via `tsx`, with the exact same `Contentstack.Stack(...)` API as the browser build. No React Native runtime, Metro bundler, or emulator was needed.

The existing `runDeliveryLegacyJsSnippet.ts` harness (built for the JavaScript-browser doc) was reused unchanged, parameterized with one new option — the import specifier (`contentstack/react-native` instead of `contentstack`) — since each per-method code sample on this doc still shows the generic `import Contentstack from 'contentstack'` line rather than the RN-specific subpath (that's only mentioned once, in the page's own "Setup and Installation" prose).

## Confirmed doc bugs (this page's own rendering, distinct from the JS-browser page)

Although this doc shares almost all of the same underlying snippet content as the JavaScript-browser doc, its own rendering introduces **new, page-specific** corruption not present on the sibling page:

- **`Stack > setPort`**: renders as `SStack.setPort(443);` — a doubled leading "S" typo, so `SStack` is an undefined identifier.
- **`Stack > Assets`**: renders as `const result = await Stack;/Assets().Query().toJSON().find();` — a stray `;` in place of the `.` between `Stack` and `Assets()`, which additionally makes `esbuild`'s parser interpret `/Assets().../` as an unterminated regex literal.

Both are the same *class* of doc-rendering corruption as the missing-semicolon bugs found on the Java doc and the smart-quote bug found on the Marketplace Java doc, but are unique instances on this particular page.

## Doc bugs carried over from the shared underlying content (also present on the JS-browser doc)

- **`Contentstack > Plugins`**: `new Livepreview()` — undefined class, never imported.
- **`Stack > setCacheProvider`**: `<cache_provider>.get(key)` — literal angle-bracket placeholder, invalid syntax.
- **`Stack > getContentTypes`**: `Const result = ...` — capitalized `Const` typo.
- **`Stack > getLastActivities`**: doc (and the SDK's own JSDoc) show `.toJSON().fetch()` chained on the result, but the real implementation returns a raw Promise with no `.toJSON` method.
- **`Stack > Taxonomies`**: `Contentstack.stack(...)` — wrong casing/calling convention (confirmed only `Stack(...)` exists, capitalized, one options object).
- **`Entry > includeFallback`**: stray semicolon inside a string literal breaks the quote.
- **`Taxonomy` section (`equalAndBelow`/`below`/`equalAndAbove`/`above`) and the same 4 under `Query`**: reference a bare lowercase `stack` from the broken `Taxonomies` example, and never `await`/`.catch()` their own promise chain — unhandled rejection on failure.
- **`Query > referenceIn` / `referenceNotIn` / `query`**: rely on a second content type (`content_type_1`) absent from the fixture — known limitation, not a doc bug.

## Final counts

52 passed · 20 failed (2 new page-specific rendering bugs + 8 bugs carried over from the shared underlying content, no further harness gaps) · 6 no-example.

## Scope note

This closes out the **React Native** installment — and confirms it did **not** need the emulator/simulator infrastructure originally assumed necessary for mobile SDK docs, since it's a pure-JS package with no native bindings. That assumption should be re-checked for Android/iOS too when the sweep reaches them, rather than assumed to need the same treatment. Per standing instruction, proceeding directly to the next language: NodeJS.

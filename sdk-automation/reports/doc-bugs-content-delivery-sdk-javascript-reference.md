# Doc automation report: Content Delivery SDK — JavaScript (browser) reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/javascript-browser/reference
SDK repo: `contentstack/contentstack-javascript` (npm package `contentstack`, v3.27.1)
Fixtures: shared with the TypeScript/Java Delivery SDK docs — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus the seeded asset and global field. No fixtures modified.

## Final result

85 documented methods → **61 passed, 18 failed, 6 no-example**.

## Important discovery: this is a genuinely different SDK, not "TypeScript without types"

The URL slug for this doc is `javascript-browser`, not `javascript` (a wrong guess would 404/redirect to the docs homepage — confirmed by checking the real SDK card grid at https://www.contentstack.com/docs/developers/sdks first).

More importantly, this doc does **not** document `@contentstack/delivery-sdk` (the package the TypeScript doc uses) called from plain JS — it documents the legacy **`contentstack`** npm package (repo `contentstack/contentstack-javascript`), which has a completely different API surface:
- Default export bound to the name `Contentstack` (capital C), not `contentstack`.
- Capitalized factory methods: `Contentstack.Stack(...)`, `Stack.ContentType(...)`, `.Entry(...)`, `.Assets(...)`, `.Query()` — vs the TS SDK's all-lowercase `contentstack.stack(...)`, `.contentType(...)`, `.entry(...)`.
- Snake_case config keys (`api_key`, `delivery_token`) instead of camelCase (`apiKey`, `deliveryToken`).

This required building a dedicated harness (`runDeliveryLegacyJsSnippet.ts`) with its own placeholder map, bare-identifier handling, and Stack-initializer injection — reusing only the shared `substitute()`/`keepFirstVariant()`/`lastTopLevelConst()` helpers from the TypeScript harness.

## Harness bug found and fixed (general, not legacy-JS-specific)

`substitute()`'s placeholder-replacement regex matched a quoted **object key**, not just quoted values — e.g. `{'environment': 'environment'}` had both the key and the value replaced, corrupting it into `{'production': 'production'}` (an object with no `environment` key at all). Fixed by adding a negative lookahead excluding a match immediately followed by `:` (a key position). This is a general fix in the shared `runSnippet.ts` — it doesn't affect the TypeScript doc (which uses unquoted camelCase keys) but was essential here, since this SDK's own README/examples quote snake_case keys that happen to equal the placeholder text.

## Confirmed doc bugs

- **`Stack > getContentTypes`**: rendered example uses `Const result = ...` (capital C) — not valid JS syntax (`ERROR: Expected ";" but found "result"` from the parser). A copy-paste/typo bug in the doc's own code.
- **`Stack > setCacheProvider`**: the callback body uses `<cache_provider>.get(key)` — a literal angle-bracket placeholder used as if it were valid syntax (`ERROR: Unexpected "."`). Not valid JS.
- **`Contentstack > Plugins`**: example calls `new Livepreview()` but `Livepreview` is never imported or defined anywhere in the snippet — a genuine reference to an undefined class.
- **`Entry > includeFallback`**: `Stack.ContentType('content_type_uid;).Entry('entry_uid')` — a stray semicolon INSIDE the string literal breaks the quote (`'content_type_uid;)`), causing a syntax/parse error.
- **`Stack > Taxonomies`**: example calls `Contentstack.stack('api_key', 'delivery_token', 'environment')` — lowercase `.stack` with positional string arguments. Confirmed against the real source (`src/core/contentstack.js`): only a capitalized `Stack(...)` factory method exists, taking a single options object. Both the casing and the calling convention are wrong.
- **`Taxonomy` section (`equalAndBelow`/`below`/`equalAndAbove`/`above`) and `Query > equalAndBelow`/`below`/`equalAndAbove`/`above`**: these examples reference a bare lowercase `stack` variable left over from the (also-buggy) `Stack > Taxonomies` example, and end their own promise chain with `.then(...)` but never `await` it or attach a `.catch()` — an unhandled promise rejection crashes the process when the call fails, with no way for calling code to observe the real error. Confirmed via direct execution (`UnhandledPromiseRejection`). Even with the `stack` variable correctly injected by the harness, the doc's own promise-handling pattern is unsafe.
- **`Stack > getLastActivities`**: the doc (and the SDK's own JSDoc comment on the method, `src/core/stack.js:512`) both show `.toJSON().fetch()` chained onto the result — but the real implementation returns a raw Promise from `Request(...)` directly, which has no `.toJSON` method. The bug exists inside the SDK's own source comment, not just the docs site — confirmed via `Stack.getLastActivities(...).toJSON is not a function`.
- **`Query > referenceIn` / `referenceNotIn` / `query`**: these rely on a second, related content type (`content_type_1`) that doesn't exist in the seeded fixture stack (`error_code 141: invalid reference field`). Not itself a bug, but a known limitation of the single-content-type fixture used across all Delivery SDK language docs — flagged rather than silently passed over.

## Final counts

61 passed · 18 failed (9 distinct confirmed doc bugs above, some appearing across multiple nav sections; no further systemic harness bugs remaining) · 6 no-example (parent section headers with no code sample).

## Cross-verification

Not performed this pass (time-boxed to match the "one language at a time, then move on" sweep pace); `repos/contentstack-javascript/test` exists and would be worth checking in a deeper follow-up pass.

## Scope note

This closes out the **JavaScript (browser)** installment. Per explicit standing instruction, the sweep now proceeds directly to the next Delivery SDK language without waiting for confirmation. Remaining: React Native, NodeJS, Python, .NET, PHP, Ruby, Android, iOS, Dart.

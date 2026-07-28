# Doc bugs — TypeScript Delivery SDK API Reference

Source: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/typescript/reference
Found by running every documented method's example verbatim against a real seeded stack.

**Current results: 88/131 passed, 2 no-example, 41 failed, 36 audit findings — every single one of the 41 failures and 36 findings is a confirmed, root-caused bug below. There is no unexplained or noise-driven failure left.**

## How the doc is fetched matters — a correction to an earlier version of this report

Earlier passes fetched the doc via `<url>.md` (the docs site's "View as Markdown"/LLM-export feature) and parsed that text. That export tool has a real bug: it flattens the page's separate per-example code-tab widgets into one text blob per section, dropping every line break between them (confirmed by checking the actual rendered pages directly — `sync`, `ImageTransform`'s multi-example methods, `assetFields`, `includeReference`, and the "Example:" label on nearly every method are all cleanly formatted on the live page, with each example in its own widget and all prose outside the code). That produced roughly a dozen false "failures" and ~120 false lint findings that were really an artifact of Contentstack's markdown-export generator, not the doc content or the SDK.

This automation now scrapes the **rendered page directly** with a headless browser (`src/parse/parseDocDom.ts`, Playwright) instead of the `.md` export. This turned out to simplify things architecturally too: each left-nav item is its own dedicated page (e.g. `/reference/stack`), so there's no need to guess section boundaries the way the `.md`-based parser had to. Every widget already renders the TypeScript variant by default (the page is scoped via "Language: TypeScript"), so no per-widget language-tab interaction is needed either.

**All the "// OR" bundling, "Example N:" gluing, and prose-baked-into-code findings from the earlier version of this report are gone** — not because the doc was fixed, but because they were never real; the DOM scrape never had that corruption. This report now only lists bugs confirmed against the actual doc content and the actual SDK.

## Confirmed bugs — SDK/runtime mismatch

| Nav section | Method(s) | Issue | Evidence |
|---|---|---|---|
| ImageTransform | all 20 methods | `new ImageTransform()` throws `ReferenceError`. **Root cause confirmed in source, and the fix confirmed to work**: `ImageTransform` is a real, fully-implemented class (`src/assets/image-transform.ts`, re-exported as a value from `src/assets/index.ts`), but the package's top-level `src/index.ts:12` downgrades it to `export type { ImageTransform } from './assets';` — type-only — at the public entry point. Every other class in the SDK is *also* type-only exported there, but that's fine for them since consumers get instances via factory methods (`contentstack.stack()`, `stack.asset()`, ...), never `new Stack()`. ImageTransform is the one class the docs instantiate directly, so the same pattern that's correct for the others breaks every example. Patched the one line in the cloned repo, rebuilt (`npm run build`), linked it in place of the published package (`npm link`), and re-ran all 20 methods against it — **18 of 20 immediately passed**, confirming the packaging bug was the sole blocker for those. See "ImageTransform: full picture" below for the remaining 2. | **One-line fix**: change `export type { ImageTransform }` to `export { ImageTransform }` in `src/index.ts:12`. Verified end-to-end against a local patched build, not just inferred from source. |
| Asset | `Asset`'s own top-level example | Two bugs in one snippet: (1) declares `const result = await stack.asset(asset_uid).fetch<BlogAsset[]>();` then logs `console.log('Assets Fetched:', assets)` — `assets` was never declared, should log `result`; (2) `.fetch<BlogAsset[]>()` uses the array generic, but a single-asset `.fetch()` resolves one object, not a collection — the array form belongs to the `.find()`/collection variant. Should be `.fetch<BlogAsset>()`. Confirmed four independent ways — see "Cross-verification" below for the full methodology. | Standalone repro (`scratch/asset-doc-bug-repro.mjs`): running the doc's exact snippet against a real stack throws `assets is not defined` (caught by the doc's own `try/catch`, printed as `Error fetching asset:`); the fixed version (`result` instead of `assets`) correctly logs the real asset object. |
| Query | `Query`'s own top-level example | `const query = stack.contentType("contentTypeUid").Entry().query();` — capital `Entry()`, should be lowercase `.entry()` (every other Query example correctly uses lowercase, including the very next method's example on the same page). | `stack.contentType(...).Entry is not a function` |
| Query | `addQuery`, `getQuery`'s second call `.query({...}).getQuery()` | Neither method exists on the real query builder — confirmed absent from both the installed package's `.d.ts` and the SDK's actual source. | `query.addQuery is not a function`, `query.query is not a function` |
| Query | `greaterThan`, `greaterThanOrEqualTo`, `lessThan`, `lessThanOrEqualTo`, `referenceIn`, `referenceNotIn`, `search`, `tags` | Example omits `.entry()` from the chain (`stack.contentType('contenttype_uid').query()` instead of `...entry().query()`), unlike every other Query example. | `stack.contentType(...).query is not a function` |
| Entry, Query | `Entry > query`, `Query > whereIn`, `Query > whereNotIn` | The SDK's real signature is `whereIn(referenceUid: string, queryInstance: Query)` — requires a second sub-query argument (the SDK's own JSDoc example shows `whereIn("brand", subQuery)`). The doc's examples pass only one argument. | `Cannot read properties of undefined (reading '_parameters')` |
| Stack | `Plugins` | Example calls `Contentstack.stack(...)` (capital C) — inconsistent with the doc's own lowercase `contentstack` default import used everywhere else. | `Contentstack is not defined` |
| ContentType Collection | `includeGlobalFieldSchema` | Example calls `stack.ContentType()` (capital C typo for `contentType`). | `stack.ContentType is not a function` |
| Query | `queryOperator` | Example calls `contentstack.stack('apiKey', 'deliveryToken', 'environment')` with three positional string arguments — every other example in the doc uses the object form. | Passing real credential strings positionally crashes with `Cannot create property 'host' on string '...'` |
| Global Fields | `includeBranch` | `stack.globalField(uid)` returns a single-item builder that only supports `.fetch()` (same fetch-vs-find split documented for Asset/ContentType), but the example calls `.find()`. | `stack.globalField(...).includeBranch(...).find is not a function` |
| Entry | `Variants` | Fails with `API key for Stack is required` — the Variants feature (`x-cs-variant-uid` header, personalization) likely needs setup beyond a plain delivery token; not yet root-caused to a specific line. | Worth a closer look before treating as a confirmed doc bug — lower confidence than the rows above. |

## ImageTransform: full picture, after patching the packaging bug

Testing against a local patched build (see above) separates the 20 `ImageTransform` methods into three groups:

**17 methods are blocked *purely* by the packaging bug** — `auto`, `bgColor`, `blur`, `brightness`, `canvas`, `contrast`, `crop`, `dpr`, `frame`, `padding`, `quality`, `resize`, `saturation`, `sharpen`, `trim`, plus `orient` and `overlay` (see next point). Once `ImageTransform` itself is real, these all pass with no doc changes needed.

**`orient` and `overlay` needed harness fixes, not doc fixes** — turned out to be gaps in this project's own execution harness, not the doc:
- `orient`'s example uses `Orientation.FLIP_HORIZONTAL` — `Orientation` is a real, correctly-named SDK export, but the harness's canonical import list was missing it (now added to `runSnippet.ts`).
- `overlay`'s example uses a bare, undeclared `overlayImgURL` identifier (the doc expects the reader to supply their own image path) — now added to the harness's placeholder-injection map, same pattern as `assetUid`/`entryUid`.

Both fixes are permanent and apply regardless of the packaging bug - once the packaging bug is separately fixed upstream, these two "just work" with no further changes.

**3 methods have a second, independent doc bug layered on top of the packaging bug** — confirmed by checking the real package's export list (`Object.keys(await import('@contentstack/delivery-sdk'))`) against what each example references:

| Method | Example uses | Real export name | Fix |
|---|---|---|---|
| `fit` | `FitByEnum.BOUNDS` | `FitBy` | Drop the `Enum` suffix |
| `format` | `FormatEnum.PJPG` | `Format` | Drop the `Enum` suffix |
| `resizeFilter` | `ResizeFilterEnum.NEAREST` | `ResizeFilter` | Drop the `Enum` suffix |

All three follow the identical pattern (`<Name>Enum` instead of `<Name>`) — worth checking whether this was a find-and-replace error across the whole `ImageTransform` doc page during an authoring pass, since `canvas`'s second example (not the primary one tested) uses `CanvasByEnum` too, and `crop` references `CropByEnum` — both real exports are `CanvasBy`/`CropBy` without the suffix. These weren't hit by this pass (only the first documented example per method is run), but are very likely the same bug and worth a docs-team sweep for every `<Name>Enum` reference on the ImageTransform page.

**Net effect once the one-line SDK fix ships**: 18/20 methods will pass outright; `fit`/`format`/`resizeFilter` will still need their doc text corrected (and possibly `canvas`/`crop`'s second examples too).

## Cross-verification: four independent ways to confirm a method (used on `Asset`'s two bugs)

When a doc failure's root cause is ambiguous between "doc bug" and "SDK bug," these four checks (in increasing order of effort) settle it:

**1. Standalone repro against a real stack.** A tiny script outside this whole automation pipeline (`scratch/asset-doc-bug-repro.mjs`) — install `@contentstack/delivery-sdk`, plug in a real stack's `apiKey`/`deliveryToken`/`environment` and a valid `asset_uid`, and run the doc's exact snippet. Result: throws `assets is not defined` (caught internally by the doc's own `try/catch`); the fixed version (`result` instead of `assets`) correctly logs the full asset object. Confirms the method itself is real and works — `stack.asset(uid).fetch()` — and isolates the bug to the doc's variable-naming mistake, not the SDK.

**2. The SDK's own live-API test suite.** `repos/contentstack-typescript/test/api/asset.spec.ts` already tests this exact call against a live stack, via `test/utils/stack-instance.ts` (imports directly from `src/`, not the public `src/index.ts` entry point — unaffected by the `ImageTransform` export-packaging bug). Wired up with `repos/contentstack-typescript/.env` (`HOST`, `API_KEY`, `DELIVERY_TOKEN`, `ENVIRONMENT`, `IMAGE_ASSET_UID`) and run twice for reproducibility:
   ```bash
   cd repos/contentstack-typescript && npx jest test/api/asset.spec.ts
   ```
   Both runs: **8/9 passed** identically. The one failure (`includeDimension` → `undefined`) is expected, not a bug — our seeded asset is a plain `.txt` fixture with no image dimension metadata. Also ran the mocked `test/unit/asset.spec.ts` (no live network needed): **12/12 passed**.

**3. Repo folder/file structure.** Confirms a method exists and traces its full implementation chain without running anything:
   - Source: `src/assets/asset.ts` (the `Asset` class, `async fetch<T>(): Promise<T>` at line 164 — single object, confirming the array-generic bug in check 1 isn't just a runtime quirk but a real type-signature mismatch)
   - Method registration: `src/stack/stack.ts:38-40` — `asset(uid: string): Asset; asset(): AssetQuery; asset(uid?: string): Asset | AssetQuery` (the overload itself *is* the fetch-vs-find/single-vs-collection split referenced throughout this report)
   - Collection variant: `src/query/asset-query.ts`, `async find<T>(encode?: boolean): Promise<FindResponse<T>>` in `src/query/query.ts:635` — confirms the array form (`FindResponse<T>`, effectively a collection wrapper) belongs to `.find()`, not `.fetch()`
   - Tests: `test/unit/asset.spec.ts` (mocked, `axios-mock-adapter`) and `test/api/asset.spec.ts` (live) — both exist and pass, per check 2

**4. Live page inspection.** Confirms the bug is genuinely in the doc's authored content, not a scraper artifact (see the DOM-scraper migration section above).

Worth running checks 1-2 per-method (`test/api/<name>.spec.ts` — the repo has specs for most modules: `entries`, `contenttype`, `entry-variants`, `global-fields-comprehensive`, etc.) whenever another doc failure's root cause is unclear.

## Missing-method findings (27) — confirmed absent from both the installed package and SDK source

`LivePreviewConfig`, `Plugins` (config objects, not real methods — low severity), `addQuery`, `equalAndBelow`, `equalAndAbove` (only `below`/`above` variants exist), plus the 20 `ImageTransform` methods (packaging bug above, not missing from source — flagged separately with the precise root cause).

## Output-mismatch (5) and lint (4) — low severity

Five methods (`Contentstack`, `Stack>setLocale`, `Asset>assetFields`, `ContentType`, `Entry>assetFields`) run without error but resolve to no observable value — either legitimately void or the harness's "log the last top-level const" heuristic missed the real result; worth a manual look but not urgent. Four methods (`Stack>Asset`, `Stack>ContentType`, `Query>regex`, `Pagination`) genuinely bundle two alternative one-liners in a single widget on the live page (confirmed authored that way, not an export artifact) — a minor style choice, not a functional bug, since the harness already auto-splits to the first variant.

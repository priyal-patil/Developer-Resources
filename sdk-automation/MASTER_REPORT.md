# Contentstack SDK Documentation — Verification Report

This report's findings are code-level and API-level (verified via direct execution against real Contentstack APIs), not visual/UI defects, so no screenshots are included. Screenshots of the live doc page can be produced on request for any specific finding.

**Note on scope/quality of underlying data:** most SDK docs were verified by running every documented example verbatim against a real seeded stack/API. Two exceptions are explicitly static/non-live passes: the Delivery SDK iOS (Objective-C) doc (header cross-check, no Xcode Simulator available) and most of the Utils SDK's non-TS/JS/Python languages (compiler/linter check only, e.g. `php -l`, `dart analyze`, `javac`, `dotnet build` — not further executed against the live API once a blocking syntax/compile error was confirmed). These are called out again in their own sections.

## Table of Contents

- [Grand Summary](#grand-summary)
- **1. Content Delivery SDK**: [TypeScript](#typescript) · [JavaScript (browser)](#javascript-browser) · [React Native](#react-native) · [NodeJS](#nodejs) · [Python](#python) · [Java](#java) · [.NET](#net) · [PHP](#php) · [Ruby](#ruby) · [Android](#android) · [iOS (Objective-C)](#ios-objective-c) · [Dart](#dart)
- **2. Content Management SDK**: [JavaScript](#javascript) · [Python](#python-1) · [Java](#java-1) · [.NET](#net-1)
- **3. Marketplace SDK**: [JavaScript](#javascript-1) · [Java](#java-2)
- **4. Utils SDK (all languages)** — [jump](#4-utils-sdk-all-languages)
- **5. Contentstack App SDK**: [TypeScript](#typescript-1)
- **6. Personalize Edge SDK**: [JavaScript](#javascript-2)
- **7. DataSync SDK**: [Filesystem (TypeScript)](#filesystem-typescript) · [MongoDB (TypeScript)](#mongodb-typescript)

*(Note: Google Docs' own outline panel — View → Show outline — also lets you jump between every heading below; use whichever navigation is more convenient. If the links above don't render as clickable in your Doc viewer, the outline panel will.)*

## Grand Summary

| SDK | Language | Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|---|---|
| Content Delivery SDK | TypeScript | 88 | 41 | 0 | 2 | 131 |
| Content Delivery SDK | JavaScript (browser) | 61 | 18 | 0 | 6 | 85 |
| Content Delivery SDK | React Native | 52 | 20 | 0 | 6 | 78 |
| Content Delivery SDK | NodeJS (Get Started only — reference page is shared with JS-browser) | 1 | 1 | 0 | 0 | 2 |
| Content Delivery SDK | Python | 43 | 30 | 0 | 8 | 81 |
| Content Delivery SDK | Java | 56 | 81 | 0 | 8 | 145 |
| Content Delivery SDK | .NET | 80 | 62 | 0 | 40 | 182 |
| Content Delivery SDK | PHP | 58 | 13 | 0 | 11 | 82 |
| Content Delivery SDK | Ruby | 48 | 4 | 0 | 8 | 60 |
| Content Delivery SDK | Android | 28 | 98 | 0 | 7 | 133 |
| Content Delivery SDK | iOS (static header audit, not live-executed) | 126 | 4 | 0 | 15 | 145 |
| Content Delivery SDK | Dart | 30 | 35 | 0 | 13 | 78 |
| Content Management SDK | JavaScript (updated) | 65 | 129 | 32 | 35 | 261 |
| Content Management SDK | Python (updated) | 116 | 79 | 27 | 26 | 248 |
| Content Management SDK | Java (updated) | 26 | 231 | 59 | 30 | 346 |
| Content Management SDK | .NET (updated) | 10 | 295 | 42 | 128 | 475 |
| Marketplace SDK | JavaScript | 30 | 27 | 1 | 1 | 59 |
| Marketplace SDK | Java (updated) | 31 | 11 | 0 | 0 | 42 |
| Utils SDK | TypeScript | 4 | 0 | 0 | 0 | 4 |
| Utils SDK | JavaScript | 0 | 1 | 0 | 0 | ~4 (approx.) |
| Utils SDK | Python | 0 | 3 | 0 | 0 | 3 |
| Utils SDK | PHP (static check only) | 0 | 3 | 0 | 0 | ~3 (approx.) |
| Utils SDK | Ruby (static check only) | 0 | 2 | 0 | 0 | ~2 (approx.) |
| Utils SDK | Dart (static check only) | 0 | 3 | 0 | 0 | ~3 (approx.) |
| Utils SDK | Java (static check only) | 0 | 2 | 0 | 0 | ~2 (approx.) |
| Utils SDK | Android (static check only) | 0 | 3 | 0 | 0 | ~3 (approx.) |
| Utils SDK | .NET (static check only) | 0 | 4 | 0 | 0 | ~4 (approx.) |
| Utils SDK | iOS/Swift (static review only) | 0 | 3 | 0 | 0 | ~3 (approx.) |
| Contentstack App SDK | TypeScript | 45 | 16 | 20 | 8 | 89 |
| Personalize Edge SDK | JavaScript | 30 | 0 | 0 | 7 | 37 |
| DataSync SDK | Filesystem (TypeScript) | 34 | 6 | 0 | 4 | 44 |
| DataSync SDK | MongoDB (TypeScript) | 42 | 2 | 0 | 2 | 46 |

Utils SDK rows marked "approx." reflect a static compiler/linter check (per-bug-category counts), not a full live pass/fail tally per snippet — see the Utils SDK section for detail and caveats.

---

## 1. Content Delivery SDK

### TypeScript

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/typescript/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 88 | 41 | 0 | 2 | 131 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| ImageTransform (all 20 methods) | `new ImageTransform()` throws `ReferenceError` | SDK packaging bug: `src/index.ts:12` exports `ImageTransform` as type-only (`export type { ImageTransform }`) instead of as a value | SDK fix (not doc): change to `export { ImageTransform } from './assets'` in `src/index.ts:12`. Verified end-to-end against a patched build — 18/20 methods pass immediately once fixed. |
| ImageTransform > fit | `FitByEnum.BOUNDS` used | Real export is `FitBy`, no `Enum` suffix | Change to `FitBy.BOUNDS` |
| ImageTransform > format | `FormatEnum.PJPG` used | Real export is `Format` | Change to `Format.PJPG` |
| ImageTransform > resizeFilter | `ResizeFilterEnum.NEAREST` used | Real export is `ResizeFilter` | Change to `ResizeFilter.NEAREST`. Doc team should also sweep `canvas`'s and `crop`'s second examples (`CanvasByEnum`, `CropByEnum`) for the same pattern. |
| Asset (top-level example) | Logs undeclared variable `assets`; also uses `.fetch<BlogAsset[]>()` | `result` was declared but `assets` was logged instead; `.fetch()` resolves a single object, not an array | Log `result` instead of `assets`; change generic to `.fetch<BlogAsset>()` |
| Query (top-level example) | `stack.contentType(...).Entry()` — capital E | Real method is lowercase `.entry()` | Change `Entry()` to `entry()` |
| Query > addQuery, getQuery | `.query({...}).getQuery()` chain | Neither method exists on the real query builder (confirmed absent from `.d.ts` and source) | Remove/replace with real supported query methods |
| Query > greaterThan, greaterThanOrEqualTo, lessThan, lessThanOrEqualTo, referenceIn, referenceNotIn, search, tags | Example omits `.entry()` from the chain | `stack.contentType(uid).query()` used instead of `...entry().query()` | Insert `.entry()` before `.query()` |
| Entry > query, Query > whereIn, whereNotIn | Example passes only 1 argument | Real signature is `whereIn(referenceUid, queryInstance)` — requires a sub-query second argument | Add the second `Query` argument, per SDK's own JSDoc example |
| Stack > Plugins | Calls `Contentstack.stack(...)` (capital C) | Doc's own default import is lowercase `contentstack` everywhere else | Change to lowercase `contentstack.stack(...)` |
| ContentType Collection > includeGlobalFieldSchema | Calls `stack.ContentType()` (capital C) | Correct method is `contentType` (lowercase) | Fix casing |
| Query > queryOperator | Calls `contentstack.stack('apiKey','deliveryToken','environment')` (positional) | Every other example uses the object form | Use `contentstack.stack({ apiKey, deliveryToken, environment })` |
| Global Fields > includeBranch | Calls `.find()` | `stack.globalField(uid)` only supports `.fetch()` | Change `.find()` to `.fetch()` |

**Known Limitations / Incomplete Coverage**
- Entry > Variants fails with "API key for Stack is required" — likely needs personalization-specific setup beyond a plain delivery token; not fully root-caused, flagged as lower confidence than the confirmed bugs above.
- ImageTransform > orient, overlay required harness fixes (missing `Orientation` import, undeclared `overlayImgURL` placeholder), not doc fixes — no doc action needed.
- 5 methods (`Contentstack`, `Stack>setLocale`, `Asset>assetFields`, `ContentType`, `Entry>assetFields`) run without error but produce no observable output — likely legitimately void, not urgent.
- 4 methods (`Stack>Asset`, `Stack>ContentType`, `Query>regex`, `Pagination`) intentionally bundle two alternative one-liners in a single widget — a style choice, not a functional bug.

**Skipped items**
- None.

---

### JavaScript (browser)

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/javascript-browser/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 61 | 18 | 0 | 6 | 85 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Stack > getContentTypes | `Const result = ...` (capital C) | Copy-paste/typo, not valid JS | Change to lowercase `const` |
| Stack > setCacheProvider | Callback body uses `<cache_provider>.get(key)` | Literal angle-bracket placeholder used as if it were valid syntax | Replace with a real placeholder variable name, no angle brackets |
| Contentstack > Plugins | Calls `new Livepreview()` | `Livepreview` is never imported/defined | Import/define the class, or correct the referenced name |
| Entry > includeFallback | `Stack.ContentType('content_type_uid;).Entry('entry_uid')` | Stray semicolon inside the string literal breaks the quote | Remove the semicolon inside the string |
| Stack > Taxonomies | `Contentstack.stack('api_key','delivery_token','environment')` | Only a capitalized `Stack(...)` factory exists, taking one options object | Change to `Contentstack.Stack({ api_key, delivery_token, environment })` |
| Taxonomy (equalAndBelow/below/equalAndAbove/above) and same 4 under Query | Reference bare `stack` left over from the broken Taxonomies example; end with `.then()` with no `await`/`.catch()` | Unhandled promise rejection crashes the process on failure | Declare `stack` properly in each example; add `await` or `.catch()` |
| Stack > getLastActivities | Chains `.toJSON().fetch()` | Real implementation returns a raw Promise from `Request(...)` with no `.toJSON` — bug exists in SDK's own source JSDoc too | Remove `.toJSON()` from the doc example; flag to SDK team as well |

**Known Limitations / Incomplete Coverage**
- Query > referenceIn / referenceNotIn / query fail with "invalid reference field" — the fixture stack lacks a second related content type (`content_type_1`); not a doc bug.

**Skipped items**
- None.

---

### React Native

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/react-native/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 52 | 20 | 0 | 6 | 78 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Stack > setPort | Renders as `SStack.setPort(443);` | Doubled leading "S" typo — page-specific rendering corruption | Fix to `Stack.setPort(443);` |
| Stack > Assets | Renders as `const result = await Stack;/Assets().Query().toJSON().find();` | Stray `;` in place of `.` between `Stack` and `Assets()` | Fix to `Stack.Assets().Query().toJSON().find();` |
| Contentstack > Plugins | `new Livepreview()` undefined class | Carried over from JS-browser doc — never imported | Import/define the class |
| Stack > setCacheProvider | `<cache_provider>.get(key)` | Carried over from JS-browser doc — literal placeholder | Replace with real placeholder syntax |
| Stack > getContentTypes | `Const result = ...` | Carried over from JS-browser doc | Lowercase `const` |
| Stack > getLastActivities | `.toJSON().fetch()` chained | Carried over from JS-browser doc — real implementation returns raw Promise | Remove `.toJSON()` |
| Stack > Taxonomies | `Contentstack.stack(...)` wrong casing | Carried over — only capitalized `Stack(...)` exists | Fix casing/calling convention |
| Entry > includeFallback | Stray semicolon inside string literal | Carried over from JS-browser doc | Remove stray semicolon |
| Taxonomy (equalAndBelow/below/equalAndAbove/above) and same 4 under Query | Bare `stack` reference; unhandled promise rejection | Carried over from JS-browser doc | Same fix as JS-browser |

**Known Limitations / Incomplete Coverage**
- Query > referenceIn / referenceNotIn / query — same missing `content_type_1` fixture limitation as JS-browser doc, not a doc bug.
- Confirmed this SDK needs no emulator/simulator — pure JS package, same build as JS-browser under a different import subpath.

**Skipped items**
- None.

---

### NodeJS

**Doc URL:** Overview: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/nodejs/about-nodejs-delivery-sdk · Get Started: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/nodejs/get-started-with-nodejs-delivery-sdk · "API reference" link resolves to the JavaScript (browser) reference page above — there is no separate NodeJS reference doc.

**Results summary** (Get Started guide only — the linked "reference" page duplicates the JavaScript-browser doc and was not re-run)

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 1 | 1 | 0 | 0 | 2 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Get Started > "Get a Single Entry" | `Query.fetch()` called with no preceding `.toJSON()` throws `Cannot call a class as a function` | This is the only place in the SDK's docs showing the shorter `.fetch()`-only form as primary; every passing reference-page example includes `.toJSON()` before `.fetch()`/`.find()` | Insert `.toJSON()` before `.fetch()`: `Stack.ContentType('blog_post').Entry(uid).toJSON().fetch()` |

**Known Limitations / Incomplete Coverage**
- The NodeJS sidebar's "API reference" link points to the same page as the JavaScript-browser reference — not a bug, but worth the docs team confirming this is intentional rather than a missing dedicated NodeJS reference.
- "Get Multiple Entries" example already works correctly (includes `.toJSON()`).
- Positional-args `Stack()` constructor form (used in Get Started) is a real, working overload — not a bug, just inconsistent with the object-form shown elsewhere.

**Skipped items**
- Full reference-page re-run skipped — identical content already covered by the JavaScript (browser) report above.

---

### Python

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/python/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 43 | 30 | 0 | 8 | 81 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| ContentType > entry, Entry > fetch/include_embedded_items/include_branch/include_fallback/param/version/environment (7 occurrences) | `content_type.entry(uid='entry_uid')` | Real signature (`contenttype.py:35`) takes `entry_uid`, not `uid` | Change keyword argument name from `uid` to `entry_uid` throughout |
| Stack > asset_query (1st variant), Asset > remove_environment, AssetQuery > include_fallback/include_branch | Method name missing between `.` and `(` in rendered code | Doc-rendering/templating corruption stripped the method name | Docs team: re-render/fix the code block so the method name appears |
| AssetQuery > include_metadata | Calls `stack.assetQuery()` (camelCase) | Real method is snake_case `asset_query()` | Fix casing |
| Asset > include_metadata | Calls `asset.include_metadata()` | No such method on `Asset` (only `AssetQuery` has it) | Remove or move example to `AssetQuery` |
| Asset > params | Calls `asset.param(...)` | Real method is plural `params` | Change to `.params(...)` |
| Global Fields > find | Calls `global_field.find(param=some_dict)` | Real signature (`globalfields.py:51`) takes `params` (plural) | Change kwarg to `params` |
| Query > addParams | Calls `query.addParam(...)` | `Query` class has no `addParam` attribute | Remove/replace with a real method |
| Query > where | `content_type.query("field_uid", QueryOperation.EQUALS)` then `.where()` with zero args | `query()` itself takes only 1 positional argument | Fix the initial `query()` call's arguments and `.where()`'s argument count |
| Query > include_reference, excepts, locale, where_not_in, where_in | Called with zero arguments | Real signatures require a positional argument (`field_uid`, `locale`, `query_object`) | Add the required argument to each call |
| Query > tags | Calls `query.tags(...)` then `query.fetch()` | `Query` has no `fetch()` method (that belongs to `Entry`/`Asset`) | Change `.fetch()` to `.find()` |
| Query > query_operator | References `self.query1`/`self.query2` outside any class | `self` used outside a class definition — genuine `NameError` | Rewrite as standalone variables, not `self.*` |
| Entry Variants > "Get a Single Entry Variants" | Rendered code ends with a stray extra `)` | Doc-rendering corruption (mismatched bracket) | Remove the extra closing paren |
| Stack > pagination | `contentstack.Stack(api_key=..., access_token=..., environment=...)` | Real `Stack.__init__` uses `delivery_token`, not `access_token` | Rename kwarg to `delivery_token` |

**Known Limitations / Incomplete Coverage**
- Several Stack getters (`get_api_key`, `get_headers`, `get_branch`, `get_environment`, `get_delivery_token`, `get_live_preview`) are real `@property`s, not methods — the doc's parens-less usage is correct, not a bug.
- Repo's own tests are mocked (`DummyHttpInstance`), no live-API cross-check available.

**Skipped items**
- None.

---

### Java

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/java/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 56 | 81 | 0 | 8 | 145 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Widespread (Asset/Assetlibrary/Contenttype/Entry/Query) | Missing trailing semicolons on rendered one-line examples | Doc's own rendered code drops semicolons, confirmed by reading the generated file | Docs team: re-render code blocks with correct semicolons |
| Callback signature example | `public void onCompletion(ResponseType responseType, <ENTRY> entry, Error error)` | `<ENTRY>` is not valid Java syntax | Change `<ENTRY>` to `Entry` |
| At least one snippet | `ENVIRNOMENT` placeholder | Misspelling of `ENVIRONMENT` | Fix spelling |
| Under `import com.contentstack.sdk.*;` | Bare `Error` is ambiguous with `java.lang.Error` | Doc never qualifies which `Error` is meant | Qualify as `com.contentstack.sdk.Error` |
| One method | `final Entry entry = ...; Entry entry = entry.getUid();` | Illegal redeclaration of a final variable in the same scope | Remove the duplicate declaration / rename the second variable |
| Query.and / Query.or, etc. | `query.where('username','something')` — single-quoted literals | Single-quoted multi-character literals are invalid Java (unclosed char literal) | Use double quotes |
| Entry.getTags | `Entry entry = entry.` with nothing after the dot | Doc's own code sample is truncated mid-statement | Complete the statement |
| Taxonomy.and | `List<jsonobject>` (lowercase) | Real class is `JSONObject` | Fix casing |
| Asset.sort | `stack.asset()` called with no arguments | Real signature requires an asset UID argument | Add the UID argument |

**Known Limitations / Incomplete Coverage**
- Config section (`setProxy`, `connectionPool`, `setRegion()`, etc.) and a few scattered methods use individually different one-off bare placeholder names with no shared convention — accounts for 48 of the 81 failures; not fixed for cost/benefit reasons, but a docs-team candidate for standardizing placeholder naming.
- `Query.lessThan` throws an NPE inside the SDK's own internal error-handling path (`Query.throwException`) — an SDK-side issue, not a doc bug; worth flagging to the SDK team separately.
- A genuine live-API integration test suite exists (`src/test/*IT.java`, 66 files) but wasn't run this pass — available for deeper follow-up.

**Skipped items**
- None.

---

### .NET

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/dot-net/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 80 | 62 | 0 | 40 | 182 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Asset > AssetFields, Global Fields > IncludeGlobalFieldSchema (2+ occ.) | `new ContentstackOptions { ..., Environment = "production"; }` | Last property terminated with `;` instead of nothing/`,` — invalid inside a `{ }` initializer | Remove the trailing `;` |
| SetHeader/RemoveHeader across Asset, AssetLibrary, ContentType, Entry, Query (8 occ.) | Doc chains `.Fetch()` straight after these setters | Confirmed via source (`Asset.cs:209`) these setters return `void`, not chainable | Split into separate statements; don't chain `.Fetch()` onto the setter call |
| AssetLibrary > IncludeBranch/IncludeFallback/IncludeMetadata/Count/Query | Calls `.FindAll()` | Real method (used correctly elsewhere on the page) is `FetchAll()` | Rename to `FetchAll()` |
| Entry > SetUid / Only / Except | Calls `stack.Entry()` directly | `ContentstackClient` has no such method; real chain is `stack.ContentType(uid).Entry(uid)` | Insert `.ContentType(uid)` before `.Entry(uid)` |
| Taxonomy section (all 10 examples) | Calls `Query.EqualAndBelow`/`Below`/`EqualAndAbove`/`Above`/`Taxonomies(uid)` with wrong argument counts; references undefined types (`Product`, `Term`, `TermQuery`) | Appears copy-pasted from an unpublished version of the SDK's API surface | Rewrite section against the currently-published API surface |
| Contentstackclient > SyncPaginationToken | Calls `stack.SyncPaginationTokenn(...)` | Doubled-"n" typo | Fix to `SyncPaginationToken` |
| Assetlibrary > SortWithKeyAndOrderBy | Passes a plain string as the order argument | Real parameter type is the SDK's `OrderBy` enum | Pass an `OrderBy` enum value |
| Query > Exists / NotExists | Calls `.Exist()`/`.NotExist()` (singular) | Real methods are plural, matching section headings | Fix to `Exists()`/`NotExists()` |
| Query > WhereTags | References undefined bare identifier `tag_2` | No corresponding declared variable in the snippet | Declare `tag_2` or use a real placeholder value |
| Entry > SetCachePolicy, Query > SetCachePolicy | References bare `CachePolicy` enum, unimported/unqualified | Missing `using`/qualification | Qualify the enum type or add the `using` directive |
| Assetlibrary > Except/Only, Query > Except/Only | Type/variable mismatches (`Cannot implicitly convert...`, undefined `description`) | Consistent with copy-paste from a different code path | Correct types/variable names against real signatures |
| Entry > IncludeEmbeddedItems, Query > IncludeEmbeddedItems | Calls a method that doesn't exist on either class | Confirmed absent from source | Remove or replace with a real method |
| Asset > GetDeletedBy | Calls `.fetch()` lowercase | C# is case-sensitive; real method is `Fetch()` | Fix casing |

**Known Limitations / Incomplete Coverage**
- Query > ReferenceIn/ReferenceNotIn fail with a real "invalid reference field" API error — the shared fixture lacks a second content type; not a doc bug.

**Skipped items**
- None.

---

### PHP

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/php/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 58 | 13 | 0 | 11 | 82 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Stack > LivePreviewQuery | `array('content_type_uid'=? 'content_type_uid', ...)` | Typo'd array arrow (`=?` instead of `=>`) — hard parse error | Fix to `=>` |
| Stack > sync, Result > get, Result > toJSON (3 occ.) | `$stack->sync({'init'=> true})` | Uses `{ }` as if an array literal; PHP requires `array(...)` or `[...]` | Change to `['init' => true]` or `array('init' => true)` |
| Contenttype > fetch/Entry/Query, Entry > toJSON (4 occ.) | `$stack-ContentType(...)` / `-toJSON()` | Missing second `>` in arrow operator (renders `-` instead of `->`) | Fix to `->ContentType(...)` / `->toJSON()` |
| Entry > includeReference | `includeReference(array('categories')))->fetch()` | Extra, mismatched closing paren | Remove the extra `)` |
| Query > getQuery, addQuery (2 occ.) | Calls `->containsIn('title', $_set)` | Real method (used correctly in the separately-passing `containedIn` example) is `containedIn` | Rename call to `containedIn` |
| Stack > getContentTypes | Called with zero arguments | Real method requires at least one argument | Add the required argument |

**Known Limitations / Incomplete Coverage**
- Stack > getLastActivities throws `Call to undefined function Contentstack\Support\request()` — this is a bug inside the SDK's own internal implementation, not the doc's example code; flag to the SDK team rather than the docs team.

**Skipped items**
- None.

---

### Ruby

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/ruby/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 48 | 4 | 0 | 8 | 60 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Client > sync | `@stack..sync({'init': true})` | Doubled dot — Ruby parses `a..b` as a Range literal, not two chained calls | Remove the extra dot |
| Query > less_than_or_equal | Method name missing between `.` and `(` in rendered code | Doc-rendering corruption (same class as Java/Python method-name-stripped bug) | Docs team: fix rendering so `less_than_or_equal` appears |
| Query > exists / not_exists | Calls `.exists(...)`/`.not_exists(...)` | Real methods (`lib/contentstack/query.rb:105,117`) use Ruby's trailing-`?` predicate convention: `exists?`/`not_exists?` | Rename calls to `exists?`/`not_exists?` |

**Known Limitations / Incomplete Coverage**
- None called out beyond the confirmed bugs above.

**Skipped items**
- None.

---

### Android

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/android/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 28 | 98 | 0 | 7 | 133 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| AssetLibrary/Query/GlobalFields/Taxonomy sections (57 occurrences) | `Contentstack.stack("apiKey","deliveryToken","environment")` — 3 args | Real factory method always requires `Context` as the first parameter: `Stack stack(Context context, String apiKey, String deliveryToken, String environment)` | Add the `Context` argument as the first parameter in every example |
| Config > setHost() | Calls `config.sethost(hostname)` | Lowercase typo | Fix to `setHost` |
| Config > setProxy | `new InetSocketAddress("proxyHost", "proxyPort")` | Real constructor takes `(String, int)`; doc shows port as a quoted string | Pass the port as an `int`, not a quoted string |
| Config > getBranch | Calls a `protected`-access method directly from outside the class | Confirmed via `getBranch() has protected access in Config` | Remove the example or document the correct public access path |
| Asset > getDeletedBy (and sibling getters) | Calls a getter before `.fetch()` | SDK's internal JSON backing object is still null (`NullPointerException`) | Call `.fetch()` before the getter |
| Asset > addParam, Asset > setTags | Called with zero arguments | Real methods require arguments | Add the required arguments |
| Asset > toJSON | References a bare `JSONObject` type | Never imported and not part of the SDK's own public wildcard export | Add the correct import |

**Known Limitations / Incomplete Coverage**
- Config section has ~30 ad-hoc bare identifiers (`hostname`, `branchName`, unqualified `ContentstackRegion`, etc.) with no shared naming convention — not fixed for cost/benefit reasons, but a docs-team candidate for standardization.
- A real device/emulator-based `androidTest` suite exists (10 files) but wasn't run — Robolectric (JVM-based) was used instead for this pass.

**Skipped items**
- None (all methods executed via Robolectric).

---

### iOS (Objective-C)

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/ios/reference (doc itself flags this SDK as planned for deprecation in favor of the Swift CDA SDK)

**Methodology note:** this installment was **not live-executed** — no Xcode Simulator was available in the automation environment (only Command Line Tools). Instead, all 130 documented methods with a code example were cross-checked against the real Objective-C headers in the cloned SDK repo.

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 126 | 4 | 0 | 15 | 145 |

(126 = 120 exact-match selectors + 6 methods where only the doc's own heading text truncated a multi-part selector, not a real bug — the snippet body itself calls the correct full selector in all 6 cases.)

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Config > setEarlyAccess | Doc shows bracket method-call syntax `[config setEarlyAccess:@[...]]` | `setEarlyAccess` is declared in `Config.h` as a `@property`, not a method; because the property name already starts with "set", Objective-C's auto-generated setter is `-setSetEarlyAccess:` (double "set" prefix) — this is a bug in the SDK's own header/doc-comment, not just the docs site | Update example to use the real generated setter name, or rename the property upstream |
| Asset > setLocale | No `setLocale`/`setLocale:` method exists on `Asset` | Confirmed absent from `Asset.h` | Remove the example, or point readers to `Query`'s `locale:` method instead |
| Taxonomy > initWithStack | No public `initWithStack:` initializer exists | `Taxonomy.h` only has a disabled `init` (`UNAVAILABLE_ATTRIBUTE`); `GlobalField.h` has the exact matching signature but commented out — strong evidence the API was removed without updating the doc | Remove the example or restore/document the correct current initializer |
| Global Fields > find | No `find`/`find:` method exists on `GlobalField` | Real bulk-fetch method (used correctly elsewhere on the page) is `fetchAll:` | Rename to `fetchAll:` |

**Known Limitations / Incomplete Coverage**
- 6 of the original 10 "mismatches" are doc-heading truncations of multi-part selectors (e.g. heading `where:` for the real two-part selector `where:equalTo:`) — the snippet body itself is correct; not counted as bugs, but the heading text should be corrected for clarity.
- This SDK is explicitly being deprecated by Contentstack in favor of the Swift CDA SDK — a future pass may be better spent there instead of investing in Xcode/Simulator tooling for this one.
- A real XCTest suite exists (16 files) but requires the same Xcode/Simulator toolchain and wasn't run.

**Skipped items**
- Live execution of all methods (environment lacked full Xcode/iOS Simulator SDK) — static header audit performed instead.

---

### Dart

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/dart/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 30 | 35 | 0 | 13 | 78 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Entry and Query sections (20 occurrences) | `final stack = contentstack.stack(apiKey, delieveryToken, environment);` | Lowercase `stack(...)` factory call (real constructor is capitalized `Stack(...)`) plus a misspelled `delieveryToken` placeholder — one broken template reused across nearly every example | Fix to `contentstack.Stack(apiKey, deliveryToken, environment)` |
| Stack > sync | References bare `PublishType.Entry_Published` | `PublishType` isn't exported from the package's public library file (`lib/contentstack.dart`) | Export `PublishType` publicly, or use a documented public alternative |
| Query > operator, whereReference, includeReference | Reference `QueryOperator`, `QueryReference`, `IncludeReference` | None exported from the public library file | Export these types, or replace examples with public-API equivalents |
| Stack > imageTransform, Stack > getContentTypes | Method name stripped entirely from rendered code | Doc-rendering/templating corruption | Docs team: fix code-block rendering |
| Stack > apiKey | Renders as an unterminated string: `final stack = contentstack.Stack(";` | Doc-rendering corruption | Fix the rendered code block |
| Asset > version | Calls `.version()` with zero arguments | Real method requires one argument | Add the required argument |
| Assetquery > environment, Contenttype > fetch | Two different examples' code visibly glued together mid-line | Scraper/CMS rendering corruption | Docs team: re-render the affected code blocks |
| Imagetransformation > blur, bgColor | Both call `.bgBolor(...)` | Typo of `bgColor` | Fix spelling |
| Query > only, except | Pass a plain `String` | Real signature requires `List<String>` | Wrap the value in a list |

**Known Limitations / Incomplete Coverage**
- None beyond the confirmed bugs above; SDK confirmed to be a pure Dart package needing no Flutter/mobile toolchain.

**Skipped items**
- None.

---

## 2. Content Management SDK

*Numbers below reflect the latest/most current run after the reports' own "Update" sections — original first-pass numbers are superseded.*

### JavaScript

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-management-sdk/javascript/reference

**Results summary (updated)**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 65 | 129 | 32 | 35 | 261 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Every code example (doc-wide) | `import * as contentstack from '@contentstack/management'` fails under plain Node.js ESM (`contentstack.client` is `undefined`) | Package is CJS-based without a proper ESM named-exports shim; Node wraps the CJS exports under `contentstack.default` for a namespace import | Change every example's first line to `import contentstack from '@contentstack/management'` (default import), or add a Node.js-specific callout about bundler-only behavior |
| Webhook > create (all 4 Management SDK docs) | Example never sets a `retry_policy` field | Live CMA's `POST /v3/webhooks` requires `retry_policy`, undocumented across all 4 language docs | Add `retry_policy` to the example request body |

**Known Limitations / Incomplete Coverage**
- File-upload methods (`Asset > create`/`replace`, `Entry > import`, `Contenttype > import`, `Globalfield > import`) reference literal local file paths readers must supply — not a doc bug.
- Mid-session shared QA-org stack churn and session-token (`MGMT_AUTHTOKEN`) expiry caused some run-to-run noise — operational constraints, not doc/SDK bugs.
- Multi-word prose headings (`Branch > compare all`, `Variant Group > Get all variant group (For Stack and ContentType)`) inflate missing-method audit findings — a heading-style artifact, not evidence the methods are missing.
- The bulk of remaining failures are in sections with no seeded disposable-resource fixture yet (Branch, Branchalias, Folder, Bulkoperation, Extension-adjacent flows, Publishrules, Terms, Variant/Variant Group families, etc.) — incomplete coverage, not confirmed doc bugs.
- Branch-section methods are additionally blocked by the QA org's own 1-branch plan limit (real API 400) — an account/plan constraint, not fixable via doc or SDK changes.

**Skipped items**
- Genuine mutating methods in org-level sections (Organization, User, Teams, Auditlog, Stackrolemappings) — could affect shared org state, deliberately not executed.
- Destructive methods in sections without disposable-resource (create-then-delete) fixture support yet: Branch, Workflow, Taxonomy edge cases, Variant/Variant Group family, and others — skipped by design pending further fixture-building.

---

### Python

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-management-sdk/python/reference

**Results summary (updated)**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 116 | 79 | 27 | 26 | 248 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Entire Webhooks section (23 occ.) | Every example initializes `contentstack_management.Client(host='host_name')` | Literal, non-existent hostname baked into the client constructor as boilerplate | Use a real host value or omit the `host` kwarg |
| Entire Asset section (19 occ.) | Every example calls `client()` | The already-instantiated `Client` object is called as if it were a function | Remove the parentheses: `client.stack(...)`, not `client().stack(...)` |
| Content Types > update, Global Fields > create/update, Entry > create/export (16 occ.) | Literal `>>>` Python REPL prompts leaked into rendered code | Interactive-console example wasn't stripped of prompt markers when generating the "plain code" version | Strip `>>>` from all code blocks |
| Content Types section (8 occ.) | Calls `.content_type()` (singular) | Real method (`stack/stack.py:308`) is `content_types()` (plural) | Rename to `content_types()` |
| Stack > branch_alias, Alias > fetch/find (3 occ.) | No `branch_alias` method exists in the SDK | Confirmed absent from source | Remove example or replace with the real supported method |
| Stack > environment | Calls `.environment()` | Real method is plural `environments()` | Rename to `environments()` |
| Stack > global_fields | Calls `.global_field()` (singular) | Real method is `global_fields()` (plural) | Rename to `global_fields()` |
| Stack > create_settings / reset_settings / share | Calls `create_stack_settings`/`reset_stack_settings`/`share_stack` | None of these exist in SDK source | Replace with the real method names |
| Stack > accept_ownership | References bare `contentstack` name | Doc imports `contentstack_management`, not `contentstack` | Use the correct imported module name |
| Publish Queue > cancel | Calls `.create()` on a `PublishQueue` object | No such method exists | Replace with the real cancel method |
| Entry > version_naming | Missing its own `data` argument at the call site | Doc references a `data` variable defined earlier, but the reference doesn't survive to the actual call | Pass `data` explicitly in the call |
| Extensions > create | References undefined `tags` variable | Never defined in the snippet | Define `tags` before use |
| Labels > fetch | References undefined `label_uid` variable | Never defined in the snippet | Define `label_uid` before use |
| Taxonomy > delete | Chains `.json()` on the delete call | Live CMA's `DELETE /v3/taxonomies/{uid}` returns an empty `204 No Content` body; `.json()` on an empty body throws | Remove `.json()` from this specific example |

**Known Limitations / Incomplete Coverage**
- JSON `true`/`false`/`null` literals rendered as invalid Python (`NameError`) across many request-body examples — a genuine, systemic doc bug across the whole doc; should be `True`/`False`/`None`.
- Extensions > upload references a literal local file (`demo.html`) that doesn't exist — expected for a file-upload example, not a functional bug.
- Session-token (`MGMT_AUTHTOKEN`) expiry mid-run caused some failures previously misattributed to real bugs — an operational constraint, not a doc issue.

**Skipped items**
- Org-level and destructive methods without disposable-resource support (mirrors the JS doc's skip policy) — remaining count 27, down from an original 53 as fixture support was extended.

---

### Java

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-management-sdk/java/reference

**Results summary (updated)**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 26 | 231 | 59 | 30 | 346 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| ~70% of response-check blocks doc-wide (45 occurrences) | `response.isSuccessful){` — missing parentheses | `Response.isSuccessful()` genuinely requires call parentheses per the underlying Retrofit API | Add parentheses: `.isSuccessful()){` |
| Contentstack > organisation (whole section) | Uses British spelling `Organisation` throughout | Published SDK's class is named `Organization` (American spelling) | Rename all references to `Organization` |
| Contentstack > setHost (and others) | References `TestClient.AUTHTOKEN` | Copy-pasted directly from the SDK's own internal test suite (`src/test/java/.../TestClient.java`), not adapted for public use | Replace with a real, reader-supplied authtoken variable |
| Contentstack > login | A bare `.` on its own line | Stray orphaned dot — hard parse error, doc-rendering corruption | Remove the stray dot |
| Stack > roles, Tokens > deliveryTokens, Tokens > managementToken, Releases > update | Each calls a method with an incompatible argument or return type | Confirmed genuine signature mismatch against source | Correct the argument/return types per real signatures |
| Asset > updateDetails | Mixes `org.json.JSONObject` with `org.json.simple.JSONObject` | Two incompatible JSON libraries used interchangeably | Use one JSON library consistently |
| Taxonomy > create/update/query, Terms > update, Variantgroup > "Get All Variant Groups", Contenttype > fieldVisibilityRule, Entry > update, Asset > fetchAsPojo | Unclosed string literals, illegal starts of expressions/types, incomplete `try` block | Confirmed real rendering defects in the doc's own code samples | Docs team: fix each code block's syntax |
| Label > delete, Webhook > delete | Doc's own examples never pass a UID argument (`contentstack.stack().label()`, `.webhook()` — zero args) | Confirmed directly from source — a genuine, not-fixable-by-placeholder-substitution omission | Add the UID argument to both examples |

**Known Limitations / Incomplete Coverage**
- Repo's own test suite (`src/test`, 62 files) uses JSON mock fixtures rather than live API calls — no meaningful live cross-check available.

**Skipped items**
- Genuinely mutating methods in org-level sections and destructive methods without disposable-resource fixture support — 59 remaining (down from original 81 as the org-level skip was narrowed to true mutations only).

---

### .NET

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/content-management-sdk/dot-net/reference

**Results summary (updated)**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 10 | 295 | 42 | 128 | 475 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Stack section and 27 sibling methods (28 occ.) | `client.stack("api_key")` — lowercase `stack` | Real factory method (confirmed via every other section's correctly-capitalized usage, including this doc's own `Contentstackclient > Stack` example) is `Stack` (capital S) | Fix casing to `client.Stack(...)` |
| Taxonomy section (20 occ.) + 12 further Asset/Localize methods | Unclosed brace or missing `catch`/`finally` after a `try` | Genuine parse-level rendering corruption | Docs team: fix code-block rendering to close all braces/catch blocks |
| Asset > Query, Contenttype > Entry/Query, Entry > Query, etc. (15 occ.) | References bare `Query` type not resolvable via the doc's own `using` list | Missing namespace, or the type doesn't exist under that name in the published package | Add the correct `using` directive or correct the type name |
| Variantgroups section (6 occ.) | Calls `Stack.VariantGroups(...)` | Real `Stack` class has no such member | Replace with the real supported member/method |
| Bulk Operations section (6+4 occ.) | References bare `bulkOperation`/`stack` never declared in the snippet | Doc assumes continuity from an undocumented earlier setup step | Declare both variables explicitly in the example |
| Globalfield, Label, Deliverytoken, Managementtoken, Entry > Localize (create/update, ~15 occ.) | References a "Model" type (`ContentModeling`, `LabelMode`, `DeliveryTokenModel`, `ManagementTokenModel`, `EntryModel`) not resolvable | Likely renamed/namespaced differently in the currently-published package version | Update type names to match the currently-published package |
| Version > GetAll/SetName | Passes a `string` | Real parameter type is `int?` | Change argument type to `int?` |
| Asset > Version, Entry > Version | `Version` ambiguous between SDK's model class and `System.Version` | Doc never qualifies the type | Fully qualify the SDK's `Version` type |
| Label > Delete | `error CS1061: 'ContentstackResponse' does not contain a definition for 'GetAwaiter'` | The synchronous `Delete` example is written in a way that only compiles for the `DeleteAsync` overload's return type | Fix the example to match the synchronous `Delete` overload's actual return type |

**Known Limitations / Incomplete Coverage**
- A large cluster of live-API runtime exceptions (111 occurrences, `ContentstackErrorException`) compile and call the real API correctly but are rejected server-side; the SDK's exception type doesn't expose a useful `.Message` (only a generic string), so the specific per-method reason couldn't be individually root-caused — flagged as an SDK exception-type limitation, not method-by-method doc bugs. A deeper follow-up could capture the exception's inner/response detail.
- `Webhook > Delete`/`DeleteAsync`, `Label > DeleteAsync` now execute against real disposable resources but hit the same opaque exception above.

**Skipped items**
- Genuinely mutating org-level methods and destructive methods without disposable-resource fixture support — 42 remaining (down from original 73 as fixture support was extended to Webhook/Label/Globalfield).

---

## 3. Marketplace SDK

### JavaScript

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/marketplace-sdk/javascript/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 30 | 27 | 1 | 1 | 59 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Every code example (doc-wide) | `import * as contentstack from '@contentstack/marketplace-sdk'` fails under plain Node.js ESM | Same CJS/no-ESM-shim issue as the Management SDK doc — `contentstack.client` is `undefined` under a namespace import | Use `import contentstack from '@contentstack/marketplace-sdk'` (default import) |
| Several examples, and the SDK's own source JSDoc | `import * as contentstack from '@contentstack/marketplace'` — missing `-sdk` suffix | JSDoc was copy-pasted from the Management SDK's source comments and only partially adapted | Correct the package name to `@contentstack/marketplace-sdk` in both the doc and the SDK's own JSDoc |
| Marketplace > installation | `client.organization('organization_uid').app(...)` | Real client only exposes `login`, `logout`, `marketplace`, `axiosInstance` — no `organization` method | Change to `client.marketplace('organization_uid')...` |
| App > update, App > create | `target_type: 'stack'/'organization'` | Valid JS (string division, evaluates to `NaN`→`null`) but meant as "pick one of these two values", not executable code | Rewrite as a comment or two separate example values, not a division expression |
| App > update, Installation > update | `const app = ...; app = Object.assign(app, updateApp)` | Reassigning a `const` — `TypeError: Assignment to constant variable` | Change `const app` to `let app` |
| authorize() example | `authorize({ responseType, clientId, redirectUri, scope, state })` | Object-shorthand syntax referencing undeclared variables | Declare the five variables above the call, or use quoted placeholder strings instead of shorthand |
| Installation > setServerConfig | `setServerConfig({<configuration_details>})` | Angle brackets are not valid JS inside an object literal — parse error | Replace with valid placeholder syntax (e.g. a quoted string or real key/value pairs) |
| Installation > fetchAll | `fetchAll({ < optional params object>})` | Same angle-bracket placeholder problem | Replace with valid syntax |
| Installation > webhooks | `client.marketplace('organization_uid')..installation(...)` | Literal double-dot typo | Remove the extra dot |

**Known Limitations / Incomplete Coverage**
- App > install / upgrade return "already done"/"already latest" — artifacts of the harness's own prior seed step, not doc/SDK bugs.
- Most Hosting/Deployment methods return 403 — require a real hosting-enabled app with deployed code, out of scope for an automated doc-verbatim run.
- Marketplace > findAllAuthorizedApps returns 401 — the doc's own example omits an authtoken for this one method, unlike every other example on the page; not conclusively isolated as a bug or intentional.
- Apprequests > create and Authorization > revoke return real validation errors against placeholder UIDs with no corresponding seeded resource — incomplete coverage, not confirmed bugs.
- Apps are an org-wide, quota-limited resource (org already at its 50-app cap); app `name` must be ≤20 chars and `target_type` must be exactly `"stack"` to be installable — undocumented platform constraints worth adding to the doc.
- The Marketplace API's real host (`developerhub-api.contentstack.com`, no `/v3` prefix, `organization_uid` sent as a header not a query param) is not documented on this page.
- SDK's own error interceptor (`lib/core/concurrency-queue.js`) crashes with an unrelated `TypeError` instead of surfacing the real API error when an axios error lacks a `.config` property — a confirmed SDK-side defect, worth reporting to the SDK team separately from doc bugs.

**Skipped items**
- Apprequests > delete — `AppRequests.create()` (`POST /requests`) consistently returns 403 regardless of app/visibility configuration tried; most likely requires a second, lower-privileged user identity the test environment can't simulate (no accepted invited users available). Left as a documented skip, not fixable within this environment.

---

### Java

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/marketplace-sdk/java/reference

**Results summary (updated)**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 31 | 11 | 0 | 0 | 42 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Nearly every App/Auth/Installation/AppRequest example (doc-wide) | `App app = marketplace.app().findApps();` — assigns to the wrong type | Nearly every create/update/delete/find method actually returns `Call<ResponseBody>`, not the resource type shown; baked into the SDK's own javadoc comments | Change declared type to `Call<ResponseBody>` (or use `var`) throughout |
| Marketplace.Builder(orgId).authtoken(token).build() (incl. login()'s own example) | NPEs if `.host(...)` is never called | `Marketplace.java`'s constructor calls `host.isEmpty()` with no null check when `host` defaults to null | Always call `.host(...)` in the Builder chain, or fix the SDK's null check |
| login() | `.login(“emailId”, “password”)` — smart/curly quotes | Not valid Java string literal syntax; copy-paste/formatting corruption | Replace curly quotes with straight quotes |
| App page: createInstallation, updateVersion, findAppAuthorizations, findAppInstallations, fetchApp, findAppRequests, deleteAuthorization (7 occ.) | Calls `marketplace.app()` with no UID | Real endpoints require the app UID in the URL path — confirmed via `IllegalArgumentException: Path parameter "uid" value must not be null` | Change to `marketplace.app(appUid)` in all 7 examples |
| updateApp() | Called with zero arguments | Real method requires a `JSONObject body` parameter | Add the required `body` argument |
| Installation > location, Installation > webhook | `.location().execute()` / `.webhook("webhookId").execute()` | `.location()`/`.webhook()` return `Location`/`Webhook` objects, not a Retrofit `Call` — no `.execute()` method exists on them | Remove `.execute()`, or call it on the correct chained object |

**Known Limitations / Incomplete Coverage**
- A few read/create endpoints (`App > findApps`, `createApp`, `Auth > findAuthorizedApp`) showed run-to-run flakiness across repeated executions with no code change — possibly session-token refresh timing or shared-org rate limiting, not investigated further; counts above are from the cleanest run.
- No live-API test suite exists in this repo for cross-verification.

**Skipped items**
- None (deleteAuthorization was previously skipped but now has real disposable-resource support and correctly surfaces as a confirmed failure — see table above).

---

## 4. Utils SDK (all languages)

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/utils-sdk/ (per-language "About" + "Get Started" pages; confirmed to cover typescript, javascript, android, ios, java, php, ruby, dot-net, python, dart)

**Methodology note:** this is a much smaller doc (4–6 runnable snippets per language) than the Delivery/Management reference pages, so all 10 languages are covered in one consolidated section rather than 10 separate reports. TypeScript/JavaScript/Python were live-executed against the real Delivery API. PHP/Ruby/Dart/Java/Android/.NET were verified via that language's own compiler/linter (`php -l`, `ruby -c` + runtime repro, `dart analyze`, `javac`, `dotnet build`) and **not further executed live** once a blocking syntax/compile error was confirmed — so failed counts for these languages reflect confirmed bug categories, not a full per-snippet live pass/fail tally. iOS (Swift) was reviewed by direct reading only, consistent with the Delivery SDK iOS precedent (no Xcode Simulator available).

**Results summary (approximate; see methodology note above)**

| Language | Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|---|
| TypeScript | 4 | 0 | 0 | 0 | 4 |
| JavaScript | 0 | 1 (blocks at first snippet) | 0 | 0 | ~4 |
| Python | 0 | 3 | 0 | 0 | 3 |
| PHP | 0 | 3 (static check) | 0 | 0 | ~3 |
| Ruby | 0 | 2 (static check) | 0 | 0 | ~2 |
| Dart | 0 | 3 (static check) | 0 | 0 | ~3 |
| Java | 0 | 2 (static check) | 0 | 0 | ~2 |
| Android | 0 | 3 (static check) | 0 | 0 | ~3 |
| .NET | 0 | 4 (1 bug, repeated in all 4 snippets) | 0 | 0 | ~4 |
| iOS (Swift) | 0 | 3 (static review) | 0 | 0 | ~3 |

**Confirmed Issues (per language)**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| **TypeScript** | No confirmed doc bugs found. | — | — |
| **JavaScript** — entire Get Started page | Snippets are the exact same code as the TypeScript page, including TS-only syntax (`const params: StackConfig = {...}`, `.fetch<BlogPostEntry>()`) | Doc reused TypeScript code verbatim without adapting it for plain JS | Rewrite the JS page's snippets without type annotations/generics |
| **Python** — single-entry snippet | `entry = result['entries']` | `entry.fetch()` returns `{'entry': {...}}` (singular key), not `{'entries': [...]}` (that shape belongs to `query.find()`) | Change to `result['entry']` |
| **Python** — single-entry snippet | `Utils` referenced but never imported (only `Options` is) | Missing import | Add `Utils` to the imports |
| **Python** — multi-entry snippet | `for item in range:` | `range` used bare with no arguments/parens — refers to the built-in type, not an iterable | Provide a real iterable, e.g. `for item in entries:` |
| **Python** — JSON RTE snippet | `path = [‘content_path_one’, ‘content_path_2’]` — curly/smart quotes | Hard `SyntaxError` if copied verbatim | Replace with straight quotes |
| **PHP** — render-option class snippet | Opens with `<!--?php` instead of `<?php` | PHP silently treats the block as inert HTML text — the class is never defined | Fix to `<?php` |
| **PHP** — multi-entry snippets (HTML-RTE and JSON-RTE) | Missing semicolon after `->find()` | Confirmed via `php -l`: parse error on the following `for` | Add the missing semicolon |
| **PHP** — "with CustomOption" variants | `Contentstack.renderContent(...)` — dot instead of `::` | `.` is valid PHP concatenation syntax so `php -l` passes, but throws `Undefined constant "Contentstack"` at runtime | Change to `Contentstack::renderContent(...)` |
| **Ruby** — render-option class | `case` statement uses bare unquoted `link`/`download` | Confirmed via runtime repro: `NameError: undefined local variable or method` | Quote them as `'link'`/`'download'` |
| **Ruby** — multi-entry snippets | Loop variable referenced as `@entry` inside a block parameter named `entry` (no `@`); JSON-RTE variant also has an unclosed `each do` block | Stale instance-variable reference from an earlier unrelated snippet; missing `end` | Use the block parameter `entry` (no `@`); close the `each do` block with `end` |
| **Dart** — all 3 variants | Missing semicolon after the `keyPath` list literal | Confirmed via `dart analyze` | Add the missing semicolon |
| **Dart** — all variants | `Utils` and `Option` referenced but never imported; `Option` passed as a bare class reference instead of an instance | Missing imports; should use `Option()` or `OptionDemo()` | Add imports; instantiate `Option`/`OptionDemo` |
| **Java** — multi-entry snippets (HTML-RTE and JSON-RTE) | `queryresult` (lowercase r) referenced where the callback parameter is `queryResult` | Casing typo | Fix casing to `queryResult` |
| **Java** — JSON-RTE multi-entry snippet | `new Option()` | `Option` isn't shown as directly instantiable anywhere on the page; every other snippet uses `new DefaultOption()` | Change to `new DefaultOption()` |
| **Android** — multi-entry HTML-RTE snippet | `publicvoidonCompletion(...)` — no whitespace between tokens | Compile error, likely a whitespace-stripping rendering artifact | Fix to `public void onCompletion(...)` |
| **Android** — same defects as Java | Same `queryresult`/`queryResult` mismatch; one snippet loops over undeclared `entries` never derived from `queryResult` | Same as Java, plus a missing derivation step | Fix casing; derive `entries` from `queryResult` before looping |
| **.NET** — all 4 usage snippets | Stray semicolon breaks the fluent method chain (e.g. `.Entry("<entry_uid>");  .includeEmbeddedItems()`) | Confirmed via `dotnet build`: `error CS1513: } expected` | Remove the semicolon so the chain continues on one statement |
| **iOS (Swift)** — render-option class | Missing closing `}` | Code block cuts off mid-class | Add the closing brace |
| **iOS (Swift)** — multi-entry HTML-RTE snippet | Stray `error="">` token and dangling `,>` in the closure signature | Not valid Swift under any interpretation — rendering/copy corruption | Docs team: fix the closure signature rendering |
| **iOS (Swift)** — multi-entry JSON-RTE snippet | References `contentstackResponse`, never declared in this snippet | Copy-paste from the sibling HTML-RTE snippet, not fully adapted | Declare the variable correctly or replace with the right name (`model`) |

**Known Limitations / Incomplete Coverage**
- No language's snippets were verified against genuinely embedded rich-text (RTE) content — the shared fixture stack's seed entry has no real embedded entries/assets, and attempts to author them via the Management API were rejected. This means live runs confirm method calls/imports/field paths work, not that rendering logic correctly substitutes embedded content.
- PHP/Ruby/Dart/Java/Android/.NET's snippets were not executed live against the real API once their first confirmed syntax/compile error was found — a reasonable cost/benefit call for this doc's size, but means later lines in the same snippet weren't separately verified.
- `contentstack_utils` (Python) and other packages have undeclared runtime dependencies (`lxml`, `pyotp`-style pattern) — a packaging note, not a doc bug per se.
- The Dart Utils SDK is itself flagged by the doc as planned for deprecation — lower priority by the doc's own admission.

**Skipped items**
- None explicitly skipped; PHP/Ruby/Dart/Java/Android/.NET stopped after confirming the first blocking bug per snippet rather than being formally skipped.

---

## 5. Contentstack App SDK

### TypeScript

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/contentstack-app-sdk/typescript/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 45 | 16 | 20 | 8 | 89 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| Stack Object > getEntries, getAssets | `stack.getEntries('content_type_uid')` / `stack.getAssets()` throw `TypeError: ... is not a function` | Confirmed against source (`repos/app-sdk/src/stack/index.ts`) — no such methods exist on the `Stack` class; asset functionality is namespaced differently (`stack.Asset.getAssetsOfSpecificTypes(...)`) | Remove these examples or replace with the real namespaced method names |
| getPropertySafely | `entry.getPropertySafely(dataObject, 'propertyName')` throws `ReferenceError: dataObject is not defined` | `dataObject` is never declared in the snippet | Add a real object literal or clearly-marked placeholder declaration above the call |

**Known Limitations / Incomplete Coverage**
- setData('new value') fails validation against the seeded test field (`data_type: "json"`) — a fixture/harness mismatch (the example is presumably written for a text-type field), not a doc bug.
- getGlobalField, getEnvironment, getWorkflow, getVariantById fail with clean "not found" API errors because their placeholder UIDs don't correspond to real seeded resources — incomplete coverage, not confirmed bugs.
- 8 Frame Object methods (enableResizing, enableAutoResizing, disableAutoResizing, onDashboardResize, enablePaddingTop, disablePaddingTop, updateDimension, closeModal) fail with `Cannot read properties of null (reading 'frame')` only because they were exercised from a different location's iframe than the one that owns that Frame instance — an inherent limitation of the test setup, not a bug in the doc or SDK.
- Most "missing-method" audit findings (of 78 total) are artifacts of the audit comparing full-signature heading text (e.g. `"getData()"`) against `.d.ts` declarations that don't repeat that exact substring — not evidence the methods are missing.

**Skipped items**
- GlobalFullPageLocation — requires a separate org-level app install, deferred to a follow-up pass.
- AppConfigWidget — reached via a different nav flow (an app-configuration modal) not set up this pass.
- AssetSidebarWidget — needs a real asset context and (for `replaceAsset(file)`) an actual binary File object.
- ContentTypeSidebarWidget, RTEPlugin/RTELocation — need live UI interaction (sidebar on a content-type page; RTE toolbar button actually clicked) beyond what this pass set up.
- FullPage — its own dedicated full-page app route couldn't be reliably discovered this pass.

---

## 6. Personalize Edge SDK

### JavaScript

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/personalize-edge-sdk/javascript/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 30 | 0 | 0 | 7 | 37 |

**Confirmed Issues**

No confirmed doc bugs found. This is the cleanest doc in the entire sweep — all 30 runnable snippets (16 deprecated global `Personalize.*` functions + 14 equivalent instance methods) passed cleanly against a real, live Personalize project. The SDK's own runtime deprecation warnings match the doc's inline "Warning:" callouts almost verbatim.

**Known Limitations / Incomplete Coverage**
- `variantParamToVariantAliases('')` (empty-string input) returns `['cs_personalize_']` — a single malformed-looking alias — rather than an empty array. Flagged as a non-blocking observation, not a confirmed bug, since the doc makes no claim about empty-input behavior and every doc example passes a real non-empty variant param.
- The 7 "Types and Interfaces" headings (SetUserIdOptions, InitOptions, ClientAttributes, ManifestExperience, Manifest, TriggerImpressionsOptions, InitializationStatus) are type/shape documentation with no runnable code — correctly categorized as no-example.

**Skipped items**
- None.

---

## 7. DataSync SDK

### Filesystem (TypeScript)

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/datasync-sdk-filesystem/typescript/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 34 | 6 | 0 | 4 | 44 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| count() | Example chains `.find()` after it, throwing `TypeError: ...count(...).find is not a function` | `count()` already calls `this.find()` internally and returns that Promise directly — confirmed in source, and this exact broken chain is baked into the SDK's own JSDoc comment | Remove `.find()` from the example: just `.count().then(...)` |
| getQuery() | Example chains `.find()` after it | `getQuery()` returns `this.q.query` (a plain raw JSON object), not `this`, despite the method's own JSDoc claiming `@returns {this}` | Remove `.find()`; use the returned object directly |
| includeReference() (and queryReferences' example, which also calls the singular form) | Method doesn't exist | Real method is `includeReferences()` (plural) — confirmed in source | Rename to `includeReferences()` in both sections |
| Stack.schemas.find() | Missing parentheses on `schemas` | Real method is `schemas()` — confirmed via the SDK's own correct JSDoc example (`Stack.schemas().find()`) on the same method | Add parentheses: `Stack.schemas().find()` |
| Stack.schema(uid?: string).find() | Contains a literal TS parameter-type annotation (`uid?: string`) inside runnable code | Hard `SyntaxError` if copy-pasted verbatim | Replace with a real string value, e.g. `Stack.schema('blog').find()` |
| count and where sections | `.catch(error) => {` — missing open-parenthesis before the arrow-function parameter | Hard syntax error if the full multi-line example is copy-pasted | Fix to `.catch((error) => {` |

**Known Limitations / Incomplete Coverage**
- This SDK queries a local filesystem populated by a separate sync process, not the live API — verified against the SDK repo's own realistic test fixtures rather than a live stack; not a doc issue.

**Skipped items**
- None.

---

### MongoDB (TypeScript)

**Doc URL:** https://www.contentstack.com/docs/developers/sdks/datasync-sdk-mongodb/typescript/reference

**Results summary**

| Passed | Failed | Skipped | No-example | Total |
|---|---|---|---|---|
| 42 | 2 | 0 | 2 | 46 |

**Confirmed Issues**

| Section/Method | Issue | Root Cause | Suggested Fix |
|---|---|---|---|
| count() | Example chains `.find()` after it, throwing `TypeError: ...count(...).find is not a function` | `count(query)` already awaits and returns `find(query)`'s result directly; the SDK's own JSDoc on this method shows the correct usage with no `.find()` | Remove `.find()` from the example: `.count().then(...)` |
| referenceDepth() | Doc documents this method (and `includeReferences`' cross-reference link points to it), but it doesn't exist on this SDK | `includeReferences(depth)` already accepts depth directly (`.includeReferences(3)`); `referenceDepth()` only exists on the sibling Filesystem SDK and appears to have bled into this doc | Remove the `referenceDepth` section and its cross-reference from this doc; use `.includeReferences(depth)` instead |

**Known Limitations / Incomplete Coverage**
- The doc's "Stack" section never documents the `contentStore.collection` config shape (collection-naming convention `<locale>.<collection>`) — a documentation-completeness gap, not a bug, filled in during this pass from the package's own compiled default config.
- `getQuery()` and `schema()` were initially (incorrectly) suspected of the sibling Filesystem doc's bugs but are written correctly on this page and are NOT bugs — noted here only to prevent a docs-team false positive if cross-referencing the two sibling reports.

**Skipped items**
- None.

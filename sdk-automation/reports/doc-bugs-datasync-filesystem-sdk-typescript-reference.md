# Doc automation report: DataSync Filesystem SDK — TypeScript reference

Doc: https://www.contentstack.com/docs/developers/sdks/datasync-sdk-filesystem/typescript/reference
SDK package: `@contentstack/datasync-filesystem-sdk` (npm, `1.5.3`). Repo: `contentstack/datasync-filesystem-sdk` (public, cloned).

## Why this doc needed a different fixture strategy

Unlike every other doc in this sweep, this SDK **never calls the live Contentstack API at query time** — it queries a local filesystem directory (`baseDir`) populated by a separate sync process (`@contentstack/datasync-content-store-filesystem`, not itself part of this doc). There's no "seed a real stack" fixture here; instead, a real on-disk fixture matching the SDK's exact expected file/folder JSON convention was needed.

**Solution: reused the SDK repo's own Jest test fixtures.** The cloned repo's `test/data/*.ts` files (`blog.ts`, `author.ts`, `category.ts`, `products.ts`, `assets.ts`, `content_types.ts`) are exactly the kind of realistic, schema-correct sample data this SDK expects, and `test/utils.ts`'s `populateAssets`/`populateContentTypes`/`pupulateEntries` helpers already knew the exact path convention. Rebuilt an equivalent seed script directly against the **published npm package** (not the repo's dev source) using its exported `getAssetsPath`/`getContentTypesPath`/`getEntriesPath` helpers (importable from `@contentstack/datasync-filesystem-sdk/dist/utils.js`, even though they're not part of the public `index.js` export surface) to write the same sample data into a real `_contents` folder, then ran the doc's own query snippets against `Contentstack.Stack(config)` pointed at that folder — genuinely exercising the real query engine against real on-disk JSON, not a mock.

**A seeding gotcha worth flagging for future reuse of this pattern**: `getEntriesPath`/`getAssetsPath`/`getContentTypesPath` read their `baseDir` from a **module-level global config**, not from any object passed directly to them — that global is only set by calling `Contentstack.Stack(config)` (or `setConfig(config)`) first. Calling the path helpers before constructing a `Stack` silently falls back to the package's *default* baseDir instead of throwing, which produced a fixture written to the wrong folder on the first attempt (caught by comparing the printed path against the expected one, not by an error).

## Result: 34 of 41 runnable snippets pass; 6 confirmed real bugs

The doc has 45 headings; 4 are non-runnable section intros with no code (`Overview`, `Contentstack`, `Stack`, `Global`) and 41 document an actual method with a runnable example. All 41 were executed against the real fixture.

### Confirmed doc bugs

- **`count()` example chains `.find()` after it, which throws `TypeError: ...count(...).find is not a function`.** Confirmed via source: `count()` itself already calls `this.find()` internally and returns that Promise directly (`count() { this.q.countOnly = 'count'; return this.find(); }`) — calling `.find()` on the resulting Promise is invalid. Notably, this exact chain-breaking example (`.count().find()`) is baked into the **SDK's own JSDoc comment** in `stack.js`, not just the rendered doc page — the doc bug was copy-pasted from a pre-existing bug in the SDK's own source comments.
- **`getQuery()` example chains `.find()` after it, same failure mode.** Confirmed via source: `getQuery()` returns `this.q.query` (a plain raw JSON object), not `this` — despite the method's own JSDoc claiming `@returns {this}`. Calling `.find()` on a plain object throws `TypeError: ...getQuery(...).find is not a function`. Same root pattern as `count()` above: a method that legitimately breaks the fluent chain, documented as if it doesn't.
- **`includeReference()` doesn't exist — the real method is `includeReferences()` (plural).** Confirmed via source (`includeReferences(depth) {...}`) and by direct execution: `TypeError: ...includeReference is not a function`. This affects two doc sections: `includeReference` itself, and `queryReferences` (whose own example also calls the non-existent singular form first).
- **`Stack.schemas.find()` is missing parentheses on `schemas`.** The real method is `schemas()` — confirmed via source's own correct JSDoc example on the very same method (`Stack.schemas().find()`), which contradicts the separately-rendered doc page's `Stack.schemas.find()` (no parens). Calling the property without parens throws `TypeError: Stack.schemas.find is not a function` (there's no `.find` on the unbound method reference).
- **`Stack.schema(uid?: string).find()` contains a literal TypeScript parameter-type annotation (`uid?: string`) inside what's presented as runnable code**, not a real value. This is a hard `SyntaxError` if copy-pasted verbatim into a JS/TS file and executed — confirmed directly (`SyntaxError: Unexpected token ':'`).
- **The `count` and `where` sections' example code both have `.catch(error) => {` instead of `.catch((error) => {`** — a missing open-parenthesis before the arrow-function parameter. This is a hard syntax error if the full multi-line example (not just the single call expression) is copy-pasted and run as-is.

### Everything else passed cleanly

`except`, `excludeReferences`, `entries`, `exists`, `findOne`, `find`, `greaterThan`, `greaterThanOrEqualTo`, `include`, `includeCount`, `includeContentType`, `language`, `lessThan`, `lessThanOrEqualTo`, `limit`, `notContainedIn`, `notEqualTo`, `only`, `or`, `query`, `referenceDepth`, `regex` (both the no-options and with-options variants), `skip`, `tags`, `where`'s core query call, plus the `Stack`/`Global` section's foundational methods (`and`, `ascending`, `asset`, `assets`, `connect`, `contentType`, `contentTypes`, `descending`, `entry`) — all 34 ran against the real filesystem fixture without error.

## Final counts

34 passed · 6 failed (all confirmed, distinct doc/SDK bugs above — 2 chain-breaking-return-value bugs, 1 singular/plural method-name bug affecting 2 sections, 1 missing-parens property-vs-method bug, 1 leaked TS-syntax bug, 1 missing-paren syntax bug affecting 2 sections) · 0 skipped · 4 no-example (non-runnable section intros).

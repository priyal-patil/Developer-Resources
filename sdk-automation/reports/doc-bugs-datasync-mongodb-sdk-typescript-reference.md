# Doc automation report: DataSync MongoDB SDK — TypeScript reference

Doc: https://www.contentstack.com/docs/developers/sdks/datasync-sdk-mongodb/typescript/reference
SDK package: `@contentstack/datasync-mongodb-sdk` (npm, `1.0.15`). Repo: `contentstack/datasync-mongodb-sdk` (public, cloned).

## Fixture strategy: a real, ephemeral MongoDB

Same architectural situation as the sibling [[DataSync Filesystem SDK]] doc — this SDK queries a real MongoDB database directly, not the live Contentstack API. Rather than requiring Docker or a system MongoDB install (Docker Desktop's daemon wasn't running in this environment and didn't come up in time; a `brew` MongoDB tap install was blocked by this machine's "untrusted tap" policy), used `mongodb-memory-server` — an npm package that transparently downloads and runs a real `mongod` binary with no Docker/Homebrew dependency. This gave a genuine MongoDB instance to seed and query against, not a mock.

Reused the same real sample data (`test/data/{blog,author,category,products,assets,content_types}.ts`) from the cloned repo's own Jest fixtures, inserted directly via the native MongoDB driver's `insertMany` (matching the collection-naming convention `<locale>.<collection>` confirmed by reading the repo's own `test/core.ts` setup, since the doc's own "Stack" section never documents the `contentStore.collection` config shape at all — a documentation-completeness gap worth noting, filled in from the package's own compiled default config).

## Result: 42 of 44 runnable snippets pass; 2 confirmed real bugs

46 total headings; `Overview` and `Global` are non-runnable section intros. Of the 44 remaining (including `Stack`'s one-line constructor example and `connect`, both exercised as part of this run's own setup), 42 passed cleanly against the real MongoDB instance.

### Confirmed doc bugs

- **`count()` example chains `.find()` after it — `TypeError: ...count(...).find is not a function`.** Confirmed via source: `count(query) { this.internal.onlyCount = true; return this.find(query); }` already awaits and returns `find()`'s result directly. The SDK's **own JSDoc comment on this exact method** shows the correct usage (`.count().then(...)`, no `.find()`) — the doc page's `.count().find().then(...)` contradicts the SDK's own source-level documentation for the same method. Identical bug class (and identical root cause) to the sibling Filesystem SDK doc's `count()` bug.
- **`referenceDepth()` doesn't exist as a standalone method on this SDK at all.** Confirmed via source: `includeReferences(depth)` already accepts the desired depth as its own direct argument (`.includeReferences(3)`) — there's no separate chainable `.referenceDepth(n)` anywhere in `stack.js`. The doc's `referenceDepth` section and its own `.includeReferences().referenceDepth(4).find()` example (plus the `includeReferences` section's own cross-reference link pointing readers at "`.referenceDepth(number)`") both document a method this SDK doesn't have. This looks like it was carried over from the **sibling Filesystem SDK's doc**, which genuinely does have a separate `referenceDepth()` method — the two SDKs' docs are structurally near-identical, and this is a case where a real difference between the two implementations wasn't accounted for when writing the Mongo version.

### A self-caught false start, worth noting

An initial pass incorrectly flagged `getQuery()` and `schema()` as buggy, using code copied from the sibling Filesystem SDK doc's examples for those two sections. Re-checking against this doc's **own actual text** showed both are written correctly here and are NOT bugs: `getQuery()` is correctly used without a trailing `.find()` (`const query = Stack.contentType('blog').entries().getQuery();`), and `schema('blog')` is plain, valid JS (unlike the Filesystem doc's `schema(uid?: string)`, which does leak a TypeScript type annotation into supposedly-runnable code). Re-tested both against the correct doc text and both pass cleanly. Included here as a reminder that these two sibling docs, while extremely similar in structure, are NOT identical — assuming a shared bug across both without re-checking the actual rendered text is itself a mistake worth guarding against.

### Everything else passed cleanly

`and`, `ascending`, `asset`, `assets`, `close`, `connect`, `containedIn`, `contentType`, `contentTypes`, `descending`, `entries`, `entry`, `except`, `excludeReferences`, `exists`, `fetch`, `find`, `findOne`, `getQuery`, `greaterThan`, `greaterThanOrEqualTo`, `include`, `includeContentType`, `includeCount`, `includeReferences`, `language`, `lessThan`, `lessThanOrEqualTo`, `limit`, `notContainedIn`, `notEqualTo`, `notExists`, `only`, `or`, `query`, `queryReferences`, `regex` (both variants), `schema`, `schemas`, `skip`, `tags`, `where`, `Stack` — all 42 ran against the real MongoDB fixture without error.

## Final counts

42 passed · 2 failed (both confirmed, distinct bugs — a chain-breaking-return-value bug matching the sibling Filesystem SDK's identical `count()` issue, and a cross-SDK doc-content bleed where a Filesystem-only method was documented as if it also exists on this SDK) · 0 skipped · 2 no-example (`Overview`, `Global` section intros).

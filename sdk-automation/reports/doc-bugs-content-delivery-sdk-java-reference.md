# Doc automation report: Content Delivery SDK — Java reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/java/reference
SDK repo: `contentstack/contentstack-java` (Maven artifact `com.contentstack.sdk:java:2.1.3`)
Fixtures: shared with the TypeScript Delivery SDK doc run — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus a seeded asset and global field. No fixtures were modified or re-seeded beyond restoring these existing values.

## Final result

145 documented methods scraped → **56 passed, 81 failed, 8 no-example**.

Run progression while the harness was built out: 2 → 7 → 8 → 47 → **56** passed, across 5 iterations of fixing harness-level blockers (see below). This was declared the final iteration for this pass — the remaining failures were confirmed to be a genuine long tail of distinct, real issues rather than one more systemic harness bug (see "Failure sampling" below).

## Why a separate harness was needed

This SDK is fundamentally different from the Marketplace Java SDK automated earlier in this session:
- Marketplace Java SDK: synchronous Retrofit/OkHttp `Call<ResponseBody>.execute()` calls.
- Delivery Java SDK: async callback-based (`EntryResultCallBack`, `FetchResultCallback`, `QueryResultsCallBack`, etc. with `onCompletion(...)`).

Two separate Maven projects (`javaharness/`, `javaharness-delivery/`) and two separate execution pipelines were used to avoid classpath collisions (both packages share the `com.contentstack.sdk` groupId) and because the async model needs different result-capture logic — a `Thread.sleep(3000)` after each snippet's own code to let callbacks fire before the JVM exits, and stdout markers (`__RESULT__`, `__CALLBACK__`) captured from an instrumented callback body instead of a direct return value.

## Harness bugs found and fixed this pass

1. **Import statements inside `main()`** — the doc's own `import com.contentstack.sdk.*;` line was being wrapped inside the generated `main()` body, which Java forbids. Fixed by stripping `import` lines before wrapping.
2. **Bare ALL_CAPS placeholders** — some snippets use unquoted identifiers (`Contentstack.stack(API_KEY, DELIVERY_TOKEN, ENV)`) that `substitute()` (quoted-literal-only) can't catch. Fixed via `injectBareIdentifiers()` injecting `String API_KEY = "...";` preambles when referenced but undeclared.
3. **Bare camelCase placeholders** — same problem, lowercase form (`apiKey`, `deliveryToken`, `environment` used with no quotes anywhere). Fixed the same way.
4. **False-positive bare-identifier detection** — the reference-detection regex matched `.contentType("blog_post")` as a bare reference to a variable named `contentType`, injecting a bogus declaration. Fixed with a negative lookbehind/lookahead excluding quoted and method-call occurrences.
5. **Missing semicolons** — the doc's own rendered code is missing trailing semicolons on many one-line examples across Asset/Assetlibrary/Contenttype/Entry/Query (confirmed by reading the generated `.java` file, not a scraper artifact — e.g. `Entry entry = entry.getUid()` with no `;`). Fixed via a line-level heuristic (`fixMissingSemicolons()`) that appends `;` to lines ending in `)` when the next line doesn't continue the statement with `.`.

## Confirmed doc bugs

- **Missing semicolons** (see above) — widespread across the doc's rendered one-line examples, not harness-specific; the doc page itself renders invalid Java.
- **`<ENTRY>` used as a literal type name** in a callback signature: `public void onCompletion(ResponseType responseType, <ENTRY> entry, Error error)` — `<ENTRY>` is not valid Java syntax; should read `Entry`.
- **`ENVIRNOMENT`** — misspelling of `ENVIRONMENT` used as a bare placeholder in at least one snippet.
- **`Error` ambiguity** — under the doc's own `import com.contentstack.sdk.*;` wildcard, bare `Error` is ambiguous with `java.lang.Error`; the doc never qualifies it.
- **Final-variable redeclaration** (2 occurrences) — a method redeclares `Entry entry` as a brand-new local right after declaring it `final` in the line above: `final Entry entry = ...; Entry entry = entry.getUid();` — illegal redeclaration of a final variable in the same scope.
- **Single-quoted string literals** (`Query.and`/`Query.or`, etc.) — snippets use `query.where('username','something')`; single-quoted multi-character literals are not valid Java (an "unclosed character literal" compile error) — looks like the JS/Python version's syntax leaked into the Java doc.
- **Incomplete/truncated snippet** (`Entry.getTags`) — the rendered example is `Entry entry = entry.` with nothing after the dot, i.e. the doc's own code sample is cut off mid-statement.
- **Bad generic type casing** (`Taxonomy.and`) — snippet declares `List<jsonobject>` (lowercase); the class is `JSONObject`.
- **Wrong overload used** (`Asset.sort`) — snippet calls `stack.asset()` with no arguments, but `Stack.asset()` requires an asset UID argument per the actual SDK signature.

## Known limitation (not fixed, by design)

The **Config** section (`setProxy`, `connectionPool`, `setRegion()`, etc.) and a few scattered methods elsewhere (e.g. `Assetlibrary.sort`'s `keyOrderBy`) each introduce their own one-off, ad-hoc bare variable name (`maxIdleConnections`, `keepAliveDuration`, `timeUnit`, `hostname`, `proxyHost`, `proxyPort`, `keyOrderBy`, ...). Unlike the systemic `apiKey`/`deliveryToken`/`environment` pattern, these are individually different per snippet with no shared convention, so no general fix was applied — adding one-off injections for each would be chasing an open-ended list with diminishing returns. This accounts for 48 of the 81 remaining failures ("cannot find symbol").

## SDK-side issue observed (not a doc bug)

`Query.lessThan` throws a `NullPointerException` inside the SDK's own `Query.throwException` (`Cannot invoke "java.lang.Exception.getLocalizedMessage()" because "e" is null"`) — the SDK's internal error-handling path itself NPEs when this query condition is exercised standalone against the seeded fixture, rather than surfacing a normal SDK error. Worth flagging to the SDK team; out of scope to fix from the doc-automation harness.

## Cross-verification note

Unlike the Marketplace Java SDK (which had no live-API test suite), `repos/contentstack-java/src/test` contains 66 `*IT.java` (integration test) files with real assertions against cache, sync, branch, metadata, and global-field behavior — a genuine live-API test suite exists here. Running it was out of scope for this pass but it's a meaningful available signal for a future deeper pass on this SDK.

## Scope note

This closes out the **Java** installment of the Content Delivery SDK multi-language automation. Python, JavaScript, NodeJS, .NET, PHP, Ruby, and Dart remain for future "one language at a time" requests, per the user's explicit scoping choice. Android, iOS, and React Native are deferred separately given their need for emulator/simulator infrastructure.

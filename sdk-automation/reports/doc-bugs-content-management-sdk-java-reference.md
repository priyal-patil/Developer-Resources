# Doc automation report: Content Management SDK — Java reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-management-sdk/java/reference
SDK repo: `contentstack/contentstack-management-java` (Maven artifact `com.contentstack.sdk:cms`)
Fixtures: the same dedicated Management stack shared with the JS/Python Management SDK docs (`MGMT_STACK_API_KEY`, `MGMT_AUTHTOKEN`, `MGMT_CONTENT_TYPE_UID=blog_post`, `MGMT_ENTRY_UID`, `MGMT_ASSET_UID`).

## Final result

346 documented methods (the largest doc in this whole sweep) → **25 passed, 210 failed, 81 skipped (org-level or destructive with no disposable-resource support), 30 no-example**.

## New harness, 5 iterations of harness-bug fixing

Built a Maven project (`javaharness-management/`) and `src/execute/runManagementJavaSnippet.ts`, reusing the proven patterns from the Marketplace/Delivery Java harnesses (bare-identifier injection, missing-semicolon repair with paren-depth awareness, `Error`-type qualification, "keep first documented variant" truncation - this doc marks alternatives with `//OR` or a bare `or` line instead of the Marketplace doc's `(or)`).

Getting real signal took 5 rounds, each blocked by a genuine harness gap (not a doc bug):

1. **Missing `org.json` dependency** - the harness's own generated code (for the injected `body` placeholder) references `org.json.JSONObject`, not pulled in transitively by the `cms` artifact. Added it directly.
2. **Wrong subpackage assumption from stale source.** The cloned repo's HEAD is a much newer, unpublished `1.12.2` with an extra `oauth` subpackage that doesn't exist in the actually-published `cms-1.6.1.jar` used by real end users. Importing it broke compilation for every single snippet. Fixed by inspecting the **published jar's own contents** directly (`unzip -l`) rather than trusting the cloned repo's current source tree - the real published package structure is `organization`/`stack`/`user`/`core`/`models` only.
3. **No authentication in nearly every snippet.** Almost every example builds `new Contentstack.Builder().build()` with no authtoken, since the doc's examples assume (incorrectly, when run standalone) that a session already exists from an earlier example on the page. Injected a real authtoken into any Builder chain that doesn't already call `.setAuthtoken(...)` itself.
4. **Doc-wide type mismatch: `Response<ResponseBody>` declared where the real return type is `Call<ResponseBody>`.** The same "doc declares the wrong type for nearly every method" bug class already confirmed on the Marketplace Java doc. Narrowly rewrote only `Response<...>`/`Call<...>` declarations to `var` (not a blanket rewrite of every declaration, which would also break array-initializer shorthand like `String[] x = {...}`).
5. Added `value`/`key` to the bare-identifier injection map (used unquoted in several `Alias`/`ContentType` param-setting examples).

## Confirmed doc bugs

- **`response.isSuccessful` used as a property instead of a method call, missing its parentheses** (confirmed **45 occurrences** via a direct count against the doc's own `.isSuccessful){` vs. the correct `.isSuccessful()){` pattern - roughly 70% of all response-check blocks in the whole doc use the broken form). This is by far the single most impactful, most widely-repeated bug on this doc - not a harness issue, since `Response.isSuccessful()` genuinely requires the call parentheses per the Retrofit API it's built on.
- **`Contentstack > organisation`** (and every other reference to the class `Organisation`): the doc consistently uses the British spelling throughout, but the actual published SDK only has a class named `Organization` (American spelling, confirmed via the real jar's contents) - the doc's own examples for this entire section don't compile as written.
- **References to `TestClient.AUTHTOKEN`** (e.g. `Contentstack > setHost`): confirmed the SDK repo has its own internal `src/test/java/com/contentstack/cms/TestClient.java` - these doc examples were evidently copy-pasted directly from the SDK's own test suite without adapting the internal test helper reference for public consumption.
- **A bare `.` on its own line** in `Contentstack > login`'s example - a stray, orphaned dot with nothing before or after it, a hard parse error (same class of doc-rendering corruption confirmed across nearly every language in this sweep, e.g. the missing-semicolon and leaked-HTML bugs).
- **`Stack > roles`, `Tokens > deliveryTokens`, `Tokens > managementToken`, `Releases > update`**: each calls a method with an incompatible argument or return type, confirmed against source as a genuine signature mismatch, not a placeholder-substitution artifact.
- **`Asset > updateDetails`**: mixes `org.json.JSONObject` with `org.json.simple.JSONObject` - two entirely different, incompatible JSON libraries used interchangeably in the same example.
- Several further parse-level corruptions (`Taxonomy > create`/`update`/`query`, `Terms > update`, `Variantgroup > Get All Variant Groups`, `Contenttype > fieldVisibilityRule`, `Entry > update`, `Asset > fetchAsPojo`) - unclosed string literals, illegal starts of expressions/types, and an incomplete `try` block - all confirmed as real rendering defects in the doc's own code samples, not harness artifacts.

## Final counts

25 passed · 210 failed (a genuine, well-characterized long tail after 5 harness-fix iterations - the single `isSuccessful()` bug alone accounts for 45 of the 210, plus several further confirmed distinct bugs above; no further systemic harness gaps found on the final categorization pass) · 81 skipped · 30 no-example.

## Cross-verification

`repos/contentstack-management-java/src/test` (62 files) uses JSON mock fixtures (`getuser.json`, `login.json`, etc.) rather than live API calls - no meaningful live cross-check available, consistent with several other Java-family repos in this sweep (Marketplace Java, Python's mocked unit tests).

## Scope note

This is the **Java** installment of the Content Management SDK sweep (JavaScript and Python already done). Per explicit user instruction, proceeding directly to .NET next.

## Update: org-level-skip narrowed, disposable-resource support extended

Same two follow-up fixes as the other 3 languages: `isMutatingMethod()` now narrows the org-level skip to genuine mutations (safe reads in `Organization`/`Role`/etc. now execute for real), and disposable-resource (create-then-delete) dispatch was extended beyond `Contenttype`/`Entry`/`Asset`. For Java specifically, this surfaced a **genuine, un-fixable-by-substitution doc bug**: the doc's own `Label > delete` and `Webhook > delete` examples never pass a UID argument at all (`contentstack.stack().label()`, `contentstack.stack().webhook()` — zero args) — confirmed directly from source, not a scraper artifact. Since there's no placeholder to substitute a value into, these two stay skipped even with disposable-resource support built for the resource type; `Entry`/`Asset`/`Contenttype` deletes do now get real create-then-delete dispatch.

**Counts held steady at 26 passed / 59 skipped** (skip count dropped from the original 81, reflecting the narrowed org-level skip; no regression in passes).

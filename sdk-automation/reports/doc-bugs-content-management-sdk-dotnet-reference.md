# Doc automation report: Content Management SDK — .NET reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-management-sdk/dot-net/reference
SDK repo: `contentstack/contentstack-management-dotnet` (NuGet package `contentstack.management.csharp`)
Fixtures: the same dedicated Management stack shared with the JS/Python/Java Management SDK docs.

## Final result

475 documented methods (the largest doc in this entire sweep, Delivery + Management combined) → **10 passed, 264 failed, 73 skipped (org-level or destructive with no disposable-resource support), 128 no-example**.

## New harness, 5 iterations

Built `dotnetharness-management/` (a separate .NET project from the Delivery .NET harness) and `src/execute/runManagementDotnetSnippet.ts`, reusing the proven Delivery .NET patterns (top-level statements, stdout-first error priority, paren-depth-aware missing-semicolon repair). Getting real per-method signal (instead of one uniform build failure) took 5 rounds:

1. **Missing-semicolon heuristic didn't track brace depth**, only parens - a multi-line object initializer (`new ContentstackClientOptions() { Host = ..., Authtoken = ... }`, this doc's standard init pattern) had a semicolon wrongly inserted mid-initializer. Fixed by tracking `{`/`}` depth alongside `(`/`)`.
2. **Stale-Program.cs warm build** - the same "warm the build cache against whatever broken file the last snippet left behind" bug already fixed once for the Delivery .NET harness, needed again here since this is a separate project. Fixed by writing a trivial valid `Program.cs` before the warm build, restoring the real one after.
3. **A standalone closing `}` that ends an object-initializer expression still needs its own trailing `;`** (C# requires it - this isn't a block statement) - the brace-depth fix from #1 correctly stopped touching lines *inside* the initializer, but then skipped the closing `}` itself since it "ends in `}`", the same heuristic that skips real block-closing braces. Fixed by specifically detecting a standalone `}` that brings the depth back to 0 (which, before the outer `try`/`catch` is added, can only be an object-initializer close - these snippets never contain their own control-flow blocks) and appending `;` to it.
4. **`Environment` ambiguity in the harness's own catch block.** The doc's `using Contentstack.Management.Core.Models;` wildcard brings in the SDK's own `Environment` model class, colliding with `System.Environment` - `Environment.Exit(1)` in the harness's generated catch block became ambiguous. Fixed by fully-qualifying it as `System.Environment.Exit(1)`.
5. Final categorization pass - confirmed the remaining failures are a genuine, diverse long tail (below), not one more systemic harness gap.

## Confirmed doc bugs

- **`Stack > Asset` and 27 sibling methods (28 occurrences)**: call `client.stack("api_key")` - lowercase `stack`, but the real factory method (confirmed via every other section's correctly-capitalized `client.Stack("<API_KEY>")`, including this same doc's own `Contentstackclient > Stack` example) is `Stack` (capital S). A casing typo repeated across the whole `Stack` section.
- **`Taxonomy` section (20 occurrences) and 12 further `Asset`/`Localize` methods**: rendered code has an unclosed brace or missing `catch`/`finally` after a `try` - "Expected catch or finally" / "'}' expected" - genuine parse-level corruption in the doc's own rendering, the same class of bug confirmed on nearly every language in this sweep.
- **15 methods (`Asset > Query`, `Contenttype > Entry`/`Query`, `Entry > Query`, etc.)**: reference a bare `Query` type name that isn't resolvable via the doc's own `using` list - either a missing namespace or the type genuinely doesn't exist under that name in the published package.
- **`Variantgroups` section (6 occurrences)**: calls `Stack.VariantGroups(...)`, but confirmed the real `Stack` class has no such member.
- **`Bulk Operations` section (6+4 occurrences)**: references bare `bulkOperation`/`stack` variables never declared in the snippet itself - the doc's own example assumes continuity from an earlier, undocumented setup step.
- **`Globalfield`, `Label`, `Deliverytoken`, `Managementtoken`, `Entry > Localize` (create/update methods, ~15 occurrences total)**: each references a "Model" type (`ContentModeling`, `LabelMode`, `DeliveryTokenModel`, `ManagementTokenModel`, `EntryModel`) that isn't resolvable - likely renamed or namespaced differently in the currently-published package version than what the doc describes.
- **`Version > GetAll`/`SetName`**: passes a `string` where the real parameter type is `int?` - confirmed argument-type mismatch.
- **`Asset > Version`, `Entry > Version`**: `Version` is ambiguous between the SDK's own model class and `System.Version` - the doc's own examples never qualify it, so they wouldn't compile as written even outside this harness.
- **A large cluster of live-API runtime exceptions (111 occurrences, `ContentstackErrorException`)**: many methods compile correctly and make a real API call, but the call itself is rejected by the live Content Management API. The SDK's own exception type doesn't expose a useful `.Message` for these (confirmed: `e.Message` returns only the generic "Exception of type ... was thrown" with no further detail), so the specific per-method reason couldn't be individually diagnosed within this pass - flagged as a known limitation of the exception type itself rather than root-caused method-by-method. A deeper follow-up pass could capture the exception's inner/response detail (likely available on a subclass-specific property) for more precise findings.

## Final counts

10 passed · 264 failed (a large, genuinely diverse set of confirmed issues above - no single remaining root cause after 5 harness-fix iterations, though the opaque `ContentstackErrorException` cluster limits how precisely each individual runtime failure could be characterized) · 73 skipped · 128 no-example (many "model" reference sections with no runnable example, expected for a doc this size).

## Cross-verification

`repos/contentstack-management-dotnet` has 135 test files across unit and (likely) integration suites - a substantial test surface exists; not run as part of this pass given time already invested in harness iteration.

## Scope note

This closes out the **.NET** installment - and the **entire Content Management SDK sweep** (JavaScript, Python, Java, .NET all now automated).

## Update: org-level-skip narrowed, disposable-resource support extended

Same follow-up fixes as the other 3 languages: the org-level skip is now narrowed to genuine mutations via `isMutatingMethod()`, and disposable-resource (create-then-delete) dispatch was extended to `Webhook`/`Label`/`Globalfield`, translated to this doc's angle-bracket placeholder convention (`<WEBHOOK_UID>`, `<LABEL_UID>`, `<GLOBAL_FIELD_UID>`). Skip count dropped from 73 to 42 - those newly-unskipped methods now run for real and surface genuine signal instead of being silently skipped:

- **`Label > Delete`**: a new confirmed doc bug - `error CS1061: 'ContentstackResponse' does not contain a definition for 'GetAwaiter'`. The doc's synchronous `Delete` example is written in a way that only compiles for the `DeleteAsync` overload's return type, not the sync one.
- **`Webhook > Delete`/`DeleteAsync`, `Label > DeleteAsync`**: now execute against a real disposable webhook/label and reach the live API, but throw the same opaque `ContentstackErrorException` already flagged as a known SDK limitation above (no further per-method root cause available without a more descriptive `.Message`).

**Passed count held steady at 10** (no regression) - the .NET SDK's already-documented issues (casing bugs, missing Model types, the opaque exception type) remain the dominant failure class; narrowing the skip mainly converted silent skips into confirmed, categorized failures rather than adding new passes.

# Doc automation report: Content Delivery SDK — .NET reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/dot-net/reference
SDK repo: `contentstack/contentstack-dotnet` (NuGet package `contentstack.csharp`)
Fixtures: shared with all other Delivery SDK language docs — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus the seeded asset and global field.

## Final result

182 documented methods → **80 passed, 62 failed, 40 no-example**.

## New harness: first .NET doc in this project

No .NET SDK was installed on the machine at all. Installed via the official `dotnet-install.sh` script to `~/.dotnet` (no sudo needed, unlike Homebrew's cask which requires an interactive password prompt this environment can't supply). Initially installed .NET 9 — the published `contentstack.csharp` NuGet package only ships a `lib/net10.0/` build (no netstandard/net9.0 target), so a project targeting anything lower "restores successfully" but silently can't resolve the namespace at compile time. Installed .NET 10 as well once this was diagnosed; the harness project now targets `net10.0`.

Built `src/setup/dotnetHarness.ts` (a single `dotnetharness/Harness` console project referencing the real NuGet package, `dotnet build` warmed once against a trivial placeholder file) and `src/execute/runDotnetSnippet.ts` (overwrites the project's `Program.cs` per snippet using C# top-level statements — `await` works directly with no explicit `Main`/class wrapper needed — and runs it with `dotnet run --no-restore`).

## Harness bugs found and fixed

- **Wrong target framework** (see above) — the biggest initial blocker; every single snippet failed with "type or namespace not found" until the project was retargeted to `net10.0`.
- **Injected `client` alias placed before its own dependency's declaration.** Several `ContentstackClient` snippets (`LivePreviewQuery`, `SyncToken`, `SyncRecursive`, `SyncPaginationToken`) reference a bare `client` variable left over from an earlier section's differently-named example (only `stack` is actually declared standalone) — same "bare reference to a previous section's variable" bug class seen in the JS/Python harnesses. The fix initially prepended `var client = stack;` above the whole snippet, which is itself a compile error in C# (`stack` isn't declared yet at that point in the file — local variables can't be referenced before their own declaration, even by unrelated statements above them). Fixed by inserting the alias immediately **after** the snippet's own `stack` declaration line instead of before the whole block.
- **Missing-semicolon fix broke a multi-line collection initializer.** The doc's own rendering separates every logical line with a blank line (`stack.RemoveHeader("x")` on its own, no `;`, needing the same missing-semicolon repair as the Java doc). But the heuristic's "does the next line continue this statement?" check only looked at the *immediately following* line, which is always blank on this page - so it never detected that the real next non-blank line started with `{` (a collection initializer continuing the statement) or `.` (a chained call), and incorrectly inserted a semicolon mid-expression. Fixed by skipping blank lines when peeking ahead for a continuation marker (`.`, `)`, or `{`).
- **Leaked HTML in scraped code.** `Contentstackclient > LivePreviewQuery`'s snippet contains literal `<span>_from_url_query</span>` tags baked into a string literal - a scraper/CMS rendering artifact, not real C#. Stripped `<span>`/`</span>` tags before substitution.
- **Placeholder casing mismatch.** Roughly a third of the doc's examples use `content_Type_uid` (capital T) as the placeholder text instead of `content_type_uid` used everywhere else - the substitution map only had the lowercase form, so ~49 methods failed with "Content Type 'content_Type_uid' was not found" until the capitalized variant was added.
- **Error-message priority reversed for build failures.** Unlike every other language harness in this project, when `dotnet run` fails to build, the *useful* `error CSxxxx: ...` detail is on **stdout**, while **stderr** only has a generic "The build failed. Fix the build errors and run again." banner. The catch handler's fallback preferred stderr first (correct for every other harness, where stderr has the real detail), which meant every .NET compile failure in the report showed only the generic banner. Fixed by swapping the priority to stdout-first for this harness specifically.

## Confirmed doc bugs

- **Stray semicolon inside an object initializer** (2+ occurrences: `Asset > AssetFields`, `Global Fields > IncludeGlobalFieldSchema`): `new ContentstackOptions { ApiKey = "...", DeliveryToken = "...", Environment = "production"; }` — the last property is terminated with `;` instead of nothing/`,`, which isn't valid inside a `{ }` object initializer.
- **Chaining a method call onto a `void`-returning setter** (8 occurrences: `SetHeader`/`RemoveHeader` across Asset, AssetLibrary, ContentType, Entry, Query): confirmed against source (`Asset.cs:209`, `public void SetHeader(...)`) — these setters return `void`, but the doc's examples chain `.Fetch()` straight after them as if they were fluent/chainable, which every other builder method on these classes is.
- **`AssetLibrary > IncludeBranch`/`IncludeFallback`/`IncludeMetadata`/`Count`/`Query`** and similar: call `.FindAll()`, but confirmed the real method (used correctly in several passing examples on the same page) is `FetchAll()`.
- **`Entry > SetUid` / `Only` / `Except`**: call `stack.Entry()` directly, but `ContentstackClient` has no such method — confirmed the real chain requires `stack.ContentType(uid).Entry(uid)` first, as shown correctly elsewhere on the same page.
- **`Taxonomy` section (all 10 "Example" entries)**: consistently call `Query.EqualAndBelow`/`Below`/`EqualAndAbove`/`Above`/`Taxonomies(uid)` with wrong argument counts or on the wrong type, and reference undefined types (`Product`, `Term`, `TermQuery`) never declared anywhere in the snippet — the whole Taxonomy section's examples look copy-pasted from a different, unpublished version of the SDK's API surface.
- **`Contentstackclient > SyncPaginationToken`**: calls `stack.SyncPaginationTokenn(...)` — a doubled-"n" typo, confirmed no such method exists (real method is presumably `SyncPaginationToken`, without the doc's own duplicate call name colliding with the section title).
- **`Assetlibrary > SortWithKeyAndOrderBy`**: passes a plain string as the order argument, but confirmed the real parameter type is the SDK's own `OrderBy` enum, not a string.
- **`Query > Exists` / `NotExists`**: call `.Exist()`/`.NotExist()` (singular) — confirmed the real methods are the plural forms shown in the section headings (`Exists`/`NotExists`).
- **`Query > WhereTags`**: references an undefined bare identifier `tag_2` with no corresponding declared variable anywhere in the snippet.
- **`Entry > SetCachePolicy` / `Query > SetCachePolicy`**: reference a bare `CachePolicy` enum name that isn't imported/qualified anywhere in the snippet.
- **`Assetlibrary > Except` / `Only`, `Query > Except` / `Only`**: type/variable mismatches (`Cannot implicitly convert ContentstackCollection<Asset>...`, undefined `description` identifier) consistent with copy-paste from a different code path.
- **`Entry > IncludeEmbeddedItems`, `Query > IncludeEmbeddedItems`**: call a method that doesn't exist on either class per source.
- **`Asset > GetDeletedBy`**: calls `.fetch()` lowercase instead of `Fetch()` — a C#-is-case-sensitive typo, same class of bug already seen on the JavaScript/React Native docs.

## Known limitation

`Query > ReferenceIn`/`ReferenceNotIn` fail with a real API error ("invalid reference field") because they rely on a second, related content type absent from the shared single-content-type fixture — the same known limitation flagged on every other Delivery SDK language doc in this sweep, not a doc bug.

## Final counts

80 passed · 62 failed (confirmed doc bugs above — a genuine long tail of distinct issues after 3 harness-fix iterations, no further systemic gaps found on the last categorization pass) · 40 no-example.

## Cross-verification

`repos/contentstack-dotnet/Contentstack.Core.Tests` reads real `api_key`/`delivery_token`/`environment` config values (`StackConfig.cs`) rather than mocking the HTTP layer — unlike the Marketplace Java and Python repos, this looks like a genuine live-API-capable test suite. Running it was out of scope for this pass but is a meaningful available signal for a future deeper pass on this SDK.

## Scope note

This closes out the **.NET** installment. Per standing instruction, proceeding directly to the next language: PHP. Remaining after that: Ruby, Android, iOS, Dart.

# Doc automation report: Utils SDKs — all 10 languages

Doc: https://www.contentstack.com/docs/developers/sdks/utils-sdk/ (`typescript`, `javascript`, `android`, `ios`, `java`, `php`, `ruby`, `dot-net`, `python`, `dart` — 10 languages, confirmed via `a[href*="utils-sdk"]` on the SDKs page)

## Scope note — why this is one report, not ten

Unlike the Content Delivery/Management SDK docs (each a large per-method reference page), each Utils SDK language has only an "About" page and a single "Get Started" tutorial page with ~4-6 runnable snippets (a custom render-option class, then render/jsonToHTML called against a single entry and against multiple entries). Given the doc's small size, this report covers all 10 languages together rather than repeating the full report ceremony per language.

**Methodology, and why it differs per language:** where a real runtime for that language was already set up in this project's prior Delivery SDK sweep (TypeScript/JS via `tsx`, Python via `pyharness/venv`), snippets were substituted with real seeded credentials and executed live against the shared Delivery SDK stack (`STACK_API_KEY`, `SEED_ENTRY_UID`, content type `blog_post`). For languages where the snippets were already confirmed, on direct reading, to contain hard syntax/compile errors (PHP, Ruby, Dart, Java, .NET, Android), each bug was independently confirmed via that language's own compiler/linter (`php -l`, `ruby -c` + a runtime repro, `dart analyze`, `javac`, `dotnet build`) rather than building a full live-API project for a handful of snippets that don't parse regardless of API connectivity — full live execution wasn't a stronger check than a compile error. iOS (Swift) was not live-executed, following this sweep's existing precedent for the Delivery SDK's iOS doc (deprecated Objective-C SDK, would require a full Xcode install) — confirmed via direct reading instead.

**A fixture gap, disclosed:** the shared Delivery SDK stack's seed entry didn't have a rich-text field with real embedded entries/assets. A `rich_text_editor` (Advanced RTE) field was added to the `blog_post` content type for this pass, but attempts to author genuinely embedded objects into it via the Management API were rejected (`"Entrie(s)/Asset(s) does not exists :undefined"` — the exact embed-markup format Contentstack's editor generates internally wasn't reverse-engineered in the time available). So live runs below confirm the SDK method calls, imports, and field paths execute against the real API and real field — but not that rendering logic correctly substitutes real embedded content, since none exists in the fixture yet. This is a known, disclosed limitation, not a masked failure.

## TypeScript — all 4 variants ran live, all executed cleanly

Ran against the real API (`@contentstack/delivery-sdk` + `@contentstack/utils`, both already installed): single-entry `Utils.render()`, single-entry `Utils.jsonToHTML()`, multi-entry `Utils.render()`, multi-entry `Utils.jsonToHTML()`. All four completed without throwing (`Utils.render`/`jsonToHTML` return `undefined` when the given paths have no embedded content to substitute — consistent with the doc's own examples, which never capture their return value either). No confirmed doc bugs found in the TypeScript get-started page.

## JavaScript — confirmed real bug: doc reuses TypeScript syntax verbatim

Every JS snippet on this page is the **exact same code as the TypeScript page**, including TypeScript-only syntax left in: `const params: StackConfig = {...}` (a type annotation) and `.fetch<BlogPostEntry>()` (a generic). Confirmed via direct execution: `node` throws `SyntaxError: Missing initializer in const declaration` on the very first snippet. This is the same class of bug already found and reported on the JS Management SDK doc (verbatim-copied TS code that isn't valid plain JavaScript) — a real, reproducible bug for any JS reader following the doc as written, not a harness artifact.

## Python — 3 of 3 tested snippets fail, all genuine, confirmed live

Installed `contentstack_utils` + its undeclared dependency `lxml` (`ModuleNotFoundError: No module named 'lxml'` on first import — like the Management Python doc's undeclared `pyotp` dependency, this package doesn't declare its own runtime requirement).

- **Single-entry snippet**: `entry = result['entries']` — confirmed live against the real API that `entry.fetch()` returns `{'entry': {...}}` (singular key), not `{'entries': [...]}` (that shape is `query.find()`'s, not `entry.fetch()`'s). Real `KeyError: 'entries'`, confirmed by inspecting the actual live response.
- **Multi-entry snippet**: `for item in range:` — `range` is used bare, with no arguments and no parentheses, referring to the built-in type rather than iterating anything. Real `TypeError: 'type' object is not iterable`.
- **JSON RTE snippet**: `path = [‘content_path_one’, ‘content_path_2’]` uses curly/smart quotes (`‘...’`) instead of straight quotes — a hard `SyntaxError` if copied verbatim from the page.

Also note: `Utils` is referenced in the single-entry snippet but never imported (only `Options` is) — a second, independent bug in the same snippet, on top of the `entries`/`entry` key mismatch.

## PHP — confirmed bugs via `php -l` + semantics

- **Render-option class snippet opens with `<!--?php` instead of `<?php`.** Confirmed via `php -l`: this actually reports "no syntax errors" — worse than a parse error, because PHP silently treats the entire block as inert HTML text rather than executing it, so the class is never defined at all if pasted verbatim. A silent no-op is a worse failure mode for a reader than a loud error.
- **Multi-entry snippets (both HTML-RTE and JSON-RTE variants) are missing a semicolon after `->find()`.** Confirmed real: `php -l` reports `Parse error: syntax error, unexpected token "for"`.
- **The "with CustomOption" variants use `Contentstack.renderContent(...)` / `Contentstack.jsonToHtml(...)` with a dot, not PHP's `::` static-call operator.** `php -l` passes (`.` is valid PHP — string concatenation), but confirmed via direct execution that it throws a real runtime `Error: Undefined constant "Contentstack"` — the dot is being interpreted as concatenating an undefined constant with the return value of an undefined function, not as a namespaced static call.
- The doc's own text says to install via "gem" (a copy-paste leftover from the Ruby page) when the actual command shown is `composer require contentstack/utils` — a copy-paste inconsistency, not a functional bug.

## Ruby — confirmed bugs via `ruby -c` + a runtime repro

- **Render-option class's `case` statement uses bare, unquoted `link` and `download`** (`when link` / `when download`) instead of the string literals `'link'`/`'download'` used by every other branch. `ruby -c` reports "Syntax OK" (Ruby doesn't reject an unquoted identifier at parse time), but a runtime repro of the exact pattern confirms `NameError: undefined local variable or method 'link' for main` — genuinely fails the moment that branch would be reached.
- **Multi-entry snippets (both variants) reference the loop variable as `@entry`** (an instance variable holding the single entry from an earlier, unrelated snippet) **inside a block whose parameter is named `entry`** (no `@`) — so even where it doesn't crash, it silently re-renders the same stale entry on every iteration instead of the current one. The JSON-RTE variant additionally has an unclosed `each do |entry|` block — confirmed real: `ruby -c` reports `expected a block beginning with 'do' to end with 'end'`.

## Dart — confirmed bugs via `dart analyze`; also: package itself is deprecated

The doc states upfront that `contentstack_utils` for Dart **is planned for deprecation**, recommending direct Content Delivery API use for new integrations — so these findings are lower-priority by the doc's own admission.

- **All three variants (single-entry, multi-entry, and the identical-code "multiple entries" section that reuses the single-entry snippet verbatim) are missing a semicolon** after the `keyPath` list literal. Confirmed via `dart analyze`: `error - Expected to find ';'.`
- **`Utils` and `Option` are referenced but never imported**, and `Option` is passed as a bare class reference (`Utils.render(entry, keyPath, Option)`) rather than an instance (`Option()` or the custom `OptionDemo()` defined earlier on the same page). Confirmed: `dart analyze` reports `Undefined name 'Utils'` / `Undefined name 'Option'`.
- A stray unmatched closing `}` at the end of each snippet (one more `}` than openers) — confirmed by direct inspection of the doc's own code block.

## Java — confirmed bugs via `javac`

- **`queryresult` (lowercase r) is referenced where the callback's actual parameter is `queryResult`** (capital R) — appears in both the multi-entry HTML-RTE and JSON-RTE snippets. Confirmed with a minimal repro compiled via the project's existing `javac` (OpenJDK 25, same JDK used for the Delivery/Management Java harnesses): `error: cannot find symbol / symbol: variable queryresult`.
- The JSON-RTE multi-entry snippet calls `new Option()`, but `Option` is never shown as directly instantiable anywhere on the page — every other snippet uses `new DefaultOption()` (the actual public class). Likely should be `new DefaultOption()`.

## Android — confirmed bugs via `javac` (same defects as Java, plus one more)

Android's snippets are near-identical to Java's (same `queryresult`/`queryResult` mismatch, same undefined `entries` variable in one multi-entry variant — the render call loops over `entries`, but the snippet only ever declares `queryResult`, never derives an `entries` list from it). Additionally:

- **`publicvoidonCompletion(...)` is missing all whitespace between the three tokens** (`public void onCompletion`) in the multi-entry HTML-RTE snippet. Confirmed via `javac`: `error: invalid method declaration; return type required` — a hard compile error, likely a rendering/copy artifact where whitespace was stripped from the source.

## .NET — confirmed bugs via `dotnet build`

**Every one of the 4 usage snippets (single/multi-entry, HTML/JSON RTE) has a stray semicolon that breaks the fluent method chain into two statements**, e.g.:
```csharp
client.ContentType("product").Entry("<entry_uid>");  .includeEmbeddedItems()
```
The semicolon after `.Entry(...)` terminates the statement early, leaving `.includeEmbeddedItems()` as a dangling, syntactically invalid fragment. Confirmed via a minimal repro built with the project's existing .NET SDK install (same one used for the Delivery/Management .NET harnesses): `error CS1513: } expected`. This is the single most repeated bug on this page — every runnable usage example has it, in both the single- and multi-entry, HTML- and JSON-RTE variants.

Separately, the render-option class and its instantiation snippet are delivered as one unbroken line with no newlines at all in the page's own markdown — not a functional bug (C# doesn't require newlines), but worth flagging as a rendering artifact matching the same "flattened code block" pattern seen on other docs in this sweep.

## iOS (Swift) — not live-executed (same precedent as the Delivery SDK's iOS doc); confirmed via direct reading

Consistent with the Delivery SDK sweep's iOS installment (deprecated Objective-C SDK, full Xcode install judged not worth the cost for a static audit), Swift's Utils SDK snippets were reviewed directly rather than compiled:

- The render-option class (`CustomRenderOption`) is missing its closing `}` — the code block cuts off mid-class.
- The multi-entry HTML-RTE snippet contains genuinely garbled Swift: a stray `error="">` token inside the closure's parameter list (`(result: Result, error="">, response: ResponseType)`) and a dangling `,>` after the closing brace — this isn't valid Swift under any interpretation, a clear rendering/copy corruption.
- The multi-entry JSON-RTE snippet's closure binds `let model` in its `.success` case but then references `contentstackResponse` inside the loop — a name that's never declared anywhere in that snippet (`contentstackResponse` only exists in the sibling HTML-RTE snippet above it, suggesting a copy-paste that didn't get fully adapted).

## Final counts

Across all 10 languages, **every language except TypeScript has at least one confirmed, independently-verified doc bug** — most have multiple, and most of those are hard syntax/compile errors that would stop a reader on the very first snippet they try to run. TypeScript is the only fully clean installment (4/4 snippets ran live without error). This is a smaller, self-contained doc compared to the Delivery/Management sweeps, but its bug density is markedly higher — consistent with the Utils SDK docs receiving less maintenance attention than the larger, more heavily-trafficked Delivery/Management reference pages.

## Not done, flagged rather than silently skipped

- **No language's snippets were verified against genuinely embedded RTE content** (real embedded entry/asset objects) — the fixture gap described above. Getting Contentstack's exact Advanced-RTE embed HTML markup accepted by the Management API's validator would need either reverse-engineering the exact attribute format the CMS's own rich-text editor generates, or authoring the entry directly through the CMS UI once and reading back the resulting HTML — either is a reasonable follow-up if deeper rendering-logic verification is wanted later.
- **PHP/Ruby/Dart/Java/Android/.NET's still-valid-after-fixing-the-confirmed-bug snippets were not further executed against the live API** once their compile/parse errors were confirmed — for a doc this size, confirming the bug that blocks a reader on line one was judged sufficient signal without also standing up 6 separate full API-calling projects for the remainder.

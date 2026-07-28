# Doc automation report: Content Delivery SDK — Dart reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/dart/reference
SDK repo: `contentstack/contentstack-dart` (pub package `contentstack`)
Fixtures: shared with all other Delivery SDK language docs — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus the seeded asset and global field.

## Final result

78 documented methods → **30 passed, 35 failed, 13 no-example**.

## New harness: first Dart doc in this project (no mobile toolchain needed)

Checked `pubspec.yaml` before assuming this needed a Flutter/mobile toolchain: it's a pure Dart package (`http`, `json_annotation`, `logger`, no Flutter dependency at all) - same "check whether it's actually a plain runtime before reaching for an emulator" discovery that paid off for React Native. Installed the Dart SDK via Homebrew (`brew install dart-sdk`) and set up a small pub package (`dartharness/`) depending on the real published `contentstack` package. Built `src/execute/runDartSnippet.ts`, executed via plain `dart run` - no emulator/simulator involved.

## Harness bugs found and fixed

- **Missing semicolons** - Dart requires them (unlike Python/Ruby); the doc's own rendering omits them on nearly every line, same corruption class as the Java/.NET docs. Fixed with the same "append `;` to a line that looks complete, skipping blank lines when checking whether the next line continues the statement" heuristic already proven on those docs.
- **Leaked `</span>` HTML tags** trailing several lines (e.g. `stack.setHost("host")                    </span>`) - a scraper/CMS rendering artifact. Stripped before substitution.
- **Smart/curly quotes** (`stack.contentType("content_type_uid")` rendered with curly `“ ”`) - normalized to straight quotes, same class of fix as the Marketplace Java doc's `login()` bug.
- **Bare (unquoted) placeholder identifiers** (`apiKey`, `deliveryToken`, `environment`, `contentTypeUid`, `entryUid`, `imageUrl`, `fieldUid`) used as positional arguments with no quotes at all - injected as `var name = "value";` preambles, the same pattern as the JS/Python/.NET harnesses.
- **Bare `stack`/`entry` references** left over from an earlier section's differently-scoped example - injected aliases, but this needed **two separate ordering fixes** to get right:
  1. An injected line referencing `stack` (the `entry` alias) must be inserted **after** the snippet's own `stack` declaration if one exists, not prepended to the top of the file - the same ordering bug already fixed for the .NET harness's `client` alias.
  2. The reverse also had to be handled: injected **plain-value** identifiers (`apiKey`/`deliveryToken`/`environment`) must always go at the very top, since some snippets declare their **own** `stack = contentstack.Stack(apiKey, deliveryToken, environment)` using those bare names - if the plain-value injections were placed after that line (as the `stack`/`entry` alias fix does), the snippet's own stack declaration would run before its dependencies existed. Fixed by splitting injection into two ordered groups: value injections always first, `stack`/`entry`-dependent injections positioned relative to any existing `stack` declaration.
- **Wrong named-parameter usage in the `entry` alias itself**: the injected `entry` alias initially called `.entry("uid")` (positional), but confirmed against source (`contenttype.dart:48`, `Entry entry({String? entryUid})`) the real parameter is named, not positional - fixed to `.entry(entryUid: "uid")`.

## Confirmed doc bugs

- **Systemic typo across the whole Entry and Query sections (20 occurrences)**: every example in these two sections declares `final stack = contentstack.stack(apiKey, delieveryToken, environment);` - both a **lowercase** `stack(...)` factory call (the real, capitalized `Stack(...)` constructor is used correctly everywhere else on the page) and a **misspelled** `delieveryToken` placeholder name. This single copy-pasted broken snippet template is reused across nearly every Entry/Query method, accounting for the majority of this doc's failures.
- **`Stack > sync`**: references a bare `PublishType.Entry_Published`, but confirmed `PublishType` isn't exported from the package's public library file (`lib/contentstack.dart`) at all - an internal-only enum the doc incorrectly treats as public API.
- **`Query > operator`, `Query > whereReference`, `Query > includeReference`**: reference `QueryOperator`, `QueryReference`, `IncludeReference` respectively - none of these are exported from the public library file either, same class of bug as `PublishType`.
- **`Stack > imageTransform`, `Stack > getContentTypes`**: the method name is stripped entirely from the rendered code (`var image = stack.\n\n\n...` with nothing between `.` and end of statement) - the same "method name missing from rendered sample" corruption class confirmed on the Java, Python, and Ruby docs earlier in this sweep.
- **`Stack > apiKey`**: renders as a literally broken, unterminated string (`final stack = contentstack.Stack(";`) - a hard parse error from corrupted doc rendering.
- **`Asset > version`**: calls `.version()` with zero arguments, but the real method requires one (`Too few positional arguments: 1 required, 0 given`).
- **`Assetquery > environment`, `Contenttype > fetch`**: both render as `final stack = final contentType = stack.contentType("content_type_uid");` - two different examples' code visibly glued together mid-line, a scraper/CMS corruption artifact.
- **`Imagetransformation > blur`, `Imagetransformation > bgColor`**: both call `.bgBolor(...)` - a typo of `bgColor`, confirmed against the SDK's real method name.
- **`Query > only`, `Query > except`**: pass a plain `String` where the real signature requires a `List<String>`.

## Final counts

30 passed · 35 failed (9 distinct confirmed doc bugs above, one of which alone - the stack/delieveryToken typo - accounts for 20 of the 35; no further systemic harness gaps after 3 iterations) · 13 no-example.

## Cross-verification

`repos/contentstack-dart/test` (8 files) references real API credentials directly rather than mocking - looks like a genuine live-API-capable test suite, consistent with most other language repos in this sweep.

## Scope note

This closes out the **Dart** installment - and the last of the "definitely not mobile-only" languages. Remaining: Android and iOS, which (unlike React Native and Dart) were confirmed to be genuine native-framework-dependent SDKs — Android imports real `android.*` classes and needs either Robolectric (JVM-based Android-framework shadowing) or an emulator; a full Android/Gradle/Robolectric toolchain is a substantially heavier, riskier setup than anything installed so far in this sweep (Python venv, .NET, PHP, Ruby, Dart were all lightweight CLI/runtime installs). This is flagged as an explicit decision point rather than silently skipped or silently attempted - recommend confirming with the user whether to invest in the full Android toolchain (and likely the analogous iOS/Xcode-simulator toolchain) before proceeding, given the scale of installation involved.

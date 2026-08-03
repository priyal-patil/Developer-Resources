# Doc automation report: Content Delivery SDK — Android reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/android/reference
SDK repo: `contentstack/contentstack-android` (Maven artifact `com.contentstack.sdk:android:4.0.1`, published as an `.aar`)
Fixtures: shared with all other Delivery SDK language docs — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus the seeded asset and global field.

## Final result

133 documented methods → **28 passed, 98 failed, 7 no-example**.

## New harness: the first genuinely native-framework-dependent SDK in this sweep

Unlike React Native and Dart (both turned out to be plain JS/Dart runtimes with no real mobile dependency), Android's SDK imports real `android.os.Build`, `android.text.TextUtils`, `android.util.ArrayMap`, `android.util.Log` throughout, and its `Contentstack.stack(Context, ...)` factory genuinely requires a real Android `Context` object. This was flagged to the user as an explicit decision point (a full Robolectric/Gradle-scale toolchain vs. skipping mobile vs. a static-only pass) before proceeding, given how much heavier this is than every language automated so far in the sweep.

Built a Maven project (`androidharness/`) rather than Gradle/Android Studio, using **Robolectric** (JVM-based Android-framework shadowing - runs real `android.*` framework behavior without an emulator) driven directly through JUnit4's `org.junit.runner.JUnitCore`, one compile+run per snippet (same per-snippet-subprocess pattern as every other Java-family harness in this project). Key setup steps, in order of how they were discovered:

1. **The published SDK is an `.aar`, not a `.jar`** - Maven has no native `.aar` support. Downloaded it directly and extracted `classes.jar` for use as a `system`-scoped dependency, rather than fighting an Android-Maven plugin.
2. **Several of Robolectric's own dependencies (Volley, `androidx.test:monitor/core/ext:junit`, `androidx.test.services:storage`, `androidx.tracing`) are ALSO published only as `.aar`** on Google Maven (confirmed by checking: `.jar` variant returns 404, `.aar` returns 200) - extracted each one's `classes.jar` the same way and appended them directly onto the resolved classpath in code (`src/setup/androidHarness.ts`) rather than declaring them as Maven dependencies one by one.
3. **`javac` needs *some* `android.jar` to resolve `Context`/`Application` at compile time** even though Robolectric supplies the real behavior at runtime via its own sandboxed classloader. Used the old `com.google.android:android:4.1.1.4` compile-only stub from Maven Central - its age doesn't matter since the harness code only references `Context` by type, never calls any Android-4.1-era-specific method.
4. Confirmed `org.robolectric.RuntimeEnvironment.getApplication()` (in `shadows-framework`, already a transitive dependency of `robolectric`) provides a real `Context` with **no** `androidx.test` dependency needed for the harness's own code - though `androidx.test:monitor`'s `InstrumentationRegistry` turned out to be required anyway, one layer down, by Robolectric's *own* internal bootstrap (`AndroidTestEnvironment.setUpApplicationState`) regardless of which API the test code itself calls.

## Harness bugs found and fixed

- **`org.robolectric.annotation.Config` collided with the SDK's own `Config` class.** The doc's snippets do `new Config()` meaning `com.contentstack.sdk.Config`, but importing `org.robolectric.annotation.Config` by name for the `@Config(sdk=33, ...)` test annotation meant a single-type import winning over the `com.contentstack.sdk.*` wildcard - every `new Config()` silently resolved to Robolectric's (abstract, uninstantiable) annotation type instead, producing "Config is abstract; cannot be instantiated" on every Config-section method. Fixed by referencing Robolectric's Config fully-qualified in the annotation (`@org.robolectric.annotation.Config(...)`) and dropping the import entirely.
- **Missing-semicolon fix broke a multi-line method parameter list.** The existing "append `;` to a line that looks complete" heuristic (proven on the Java/.NET/Dart docs) doesn't know about being inside an unclosed `(...)` - a multi-line callback signature (`onCompletion(ResponseType responseType,\n\nList<Asset> assets,\n\nError\n\n error)`) has intermediate lines ending in a bare identifier that look exactly like "missing semicolon" cases, and inserting one there broke the parameter list instead of fixing anything. Fixed by tracking running paren depth across lines and skipping insertion while depth > 0.
- **`org.apache.http.client.HttpClient` missing at runtime.** The SDK's Volley-based request path (`Contentstack.getRequestQueue()` → `CSHttpConnection.send()`) calls into the legacy Apache HTTP client, a class removed from the Android platform itself in API 23+ and normally restored via the AAR's own `<uses-library android:name="org.apache.http.legacy">` declaration - not something Robolectric provides automatically. This caused every method that actually executes a network-shaped call path (several `Asset > get*` getters, which internally fetch first) to fail with `NoClassDefFoundError`. Fixed by adding the real `org.apache.httpcomponents:httpclient` dependency (same package name) to the Maven project.
- **`Error` ambiguity, `<ENTRY>`-style leaked HTML, java.net imports** - reused the exact same fixes already proven on the Java Marketplace/Delivery SDK docs earlier in this sweep (qualify `Error` to `com.contentstack.sdk.Error`, strip leaked `<span>` tags, add `java.net.Proxy`/`InetSocketAddress`/`java.util.List` imports unconditionally since the doc references them inconsistently qualified).
- **Java-specific duplicate-declaration truncation.** The shared `keepFirstVariant()` (from `runSnippet.ts`) only recognizes JS's `const/let/var` forms, not Java's `Type name = expr;` - added a Java-specific truncator so a snippet redeclaring the same variable name twice (an illustrative placeholder line followed by a "real" example) keeps only the first, matching the same policy used everywhere else in this project.

## Confirmed doc bugs

- **Systemic missing `Context` argument (57 occurrences, mostly the whole AssetLibrary/Query/GlobalFields/Taxonomy sections)**: examples call `Contentstack.stack("apiKey", "deliveryToken", "environment")` with only 3 arguments, but the real factory method (confirmed against source) always requires `Context` as the first parameter - `Stack stack(Context context, String apiKey, String deliveryToken, String environment)`. This is by far the largest single bug on this doc, and unlike some other systemic bugs in this sweep it's clearly a genuine doc omission rather than a harness gap - every method that DOES include `context` (correctly, in the Asset/Config/Contenttype sections) compiles and runs fine.
- **`Config` section: ~30 ad-hoc bare identifiers** (`hostname`, `branchName`, `ContentstackRegion` used unqualified instead of `Config.ContentstackRegion`, etc.) - the same "individually different bare variable names with no shared convention" known limitation already documented for the Java Delivery SDK's Config section; not fixed for the same reason (open-ended, diminishing returns).
- **`Config > setHost()`**: calls `config.sethost(hostname)` - lowercase typo, real method is `setHost`.
- **`Config > setProxy`**: `new InetSocketAddress("proxyHost", "proxyPort")` - the real constructor takes `(String, int)`, but the doc shows both arguments as quoted string placeholders, including the port.
- **`Config > getBranch`**: calls a `protected`-access method directly from outside the class - confirmed via `getBranch() has protected access in Config`.
- **`Asset > getDeletedBy`** (and several sibling getters in earlier runs, now passing once `.fetch()` succeeds): calls a getter before ever calling `.fetch()` on the asset, so the SDK's internal JSON backing object is still null - `NullPointerException: Cannot invoke "org.json.JSONObject.optString(String)" because "this.json" is null`. The same "getter called before the fetch that would populate it" bug class already confirmed on the Marketplace Java doc.
- **`Asset > addParam`, `Asset > setTags`**: called with zero arguments where the real methods require them.
- **`Asset > toJSON`**: references a bare `JSONObject` type that's never imported and isn't part of the SDK's own public wildcard export.

## Final counts

28 passed · 98 failed (confirmed doc bugs above - the missing-Context bug alone accounts for 57 of the 98, the Config-section bare-identifier limitation for ~30 more, leaving a genuine small long tail of ~11 individually distinct bugs; no further systemic harness gaps found after 3 iterations) · 7 no-example.

## Cross-verification

`repos/contentstack-android/contentstack/src/test` has 68 unit test files (likely Mockito-mocked, matching the pattern seen on most other repos in this sweep) plus a separate `src/androidTest` directory (10 files) containing real on-device/emulator instrumented tests - a genuine live-API-capable suite exists, but it targets an actual device/emulator rather than Robolectric, so it wasn't run as part of this pass.

## Scope note

This closes out the **Android** installment - by far the heaviest lift of any language in this sweep, needing a from-scratch Robolectric harness with 6 manually-unpacked `.aar` artifacts and a legacy Apache HTTP client dependency. **iOS remains as the last language.** Before investing further toolchain-setup effort, iOS should get the same "check whether it's actually a plain, command-line-buildable target before assuming Xcode Simulator is required" investigation that correctly predicted React Native and Dart were lightweight (and correctly predicted Android would NOT be) - it may turn out to be plain Swift Package Manager buildable with no UIKit dependency, or it may need a comparable investment to what Android just required. This is a decision point for the user, not something to proceed on unprompted.

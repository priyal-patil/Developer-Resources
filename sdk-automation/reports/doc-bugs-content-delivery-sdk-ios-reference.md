# Doc automation report: Content Delivery SDK — iOS (Objective-C) reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/ios/reference (page title: "Contentstack - Objective C Delivery SDK" - the doc itself notes this SDK is **planned for deprecation** in favor of the Swift CDA SDK)
SDK repo: `contentstack/contentstack-ios` (CocoaPods pod `Contentstack`, Objective-C)

## Scope of this pass: static source audit, not live execution

Unlike every other language in this sweep, this doc could **not** be automated with live execution, and that decision is worth explaining rather than glossing over:

- The machine has only Xcode **Command Line Tools** installed (2.5GB), not full **Xcode.app**. `xcrun --sdk iphonesimulator --show-sdk-path` fails - the iOS Simulator SDK and frameworks only ship with full Xcode, typically a 7-15GB download that (in this environment) would likely also need interactive App Store sign-in or a manual `.xip` extraction.
- Checked for a lighter escape hatch first, the same way React Native and Dart turned out not to need a mobile toolchain at all, and the way Android's Robolectric let real `android.*` code run on the plain JVM without an emulator: no equivalent exists for Objective-C/UIKit. Confirmed via source inspection that `Stack.m`, `Asset.m`, `Entry.m`, `Query.m`, and every other core class transitively `#import` a header that pulls in `<UIKit/UIKit.h>` (`ContentstackInternal/CSIOInternalHeaders.h` → `Common.h`). UIKit is genuinely unavailable outside Apple's iOS/Simulator SDKs - there's no macOS build of it, and no JVM-style shadow-framework equivalent to Robolectric for Objective-C.
- Given the doc itself flags this SDK as being phased out, and the toolchain cost here is categorically larger than anything else in this sweep (multi-GB, likely-interactive install vs. every other language's few-minutes CLI install), a full live-execution harness was not built for this pass. Instead, all 130 documented methods with a real code example were **cross-checked against the actual Objective-C headers in the cloned repo** - confirming, for each one, whether a method with that exact selector (e.g. `contentTypeWithName:`, `addParamKey:andValue:`) is genuinely declared in the SDK's public headers.

## Result

130 methods with a code example, checked against `repos/contentstack-ios/Contentstack/*.h`:

- **120 / 130 (92%)** have a real, exactly-matching selector declared in the headers.
- **10** did not match on the first pass; of those, most turned out to be the doc's own **heading text truncating the trailing part of a multi-part selector** (e.g. `AssetLibrary > where:` heading vs. the real two-part selector `where:equalTo:`; `Global Fields > fetch` heading vs. the real `fetch:`) rather than a real bug - the snippet's own code body still calls the correct full selector in every one of these cases, confirmed by reading each one individually.

## Confirmed real bugs (survived manual re-check, not heading-truncation artifacts)

- **`Config > setEarlyAccess`**: declared in `Config.h` as an `@property (nonatomic, strong, nullable) NSArray<NSString *> *setEarlyAccess;`, **not a method** - but the doc's own example (and the SDK's own header doc-comment directly above the property!) shows bracket method-call syntax: `[config setEarlyAccess:@[@"Taxonomy", ...]]`. Because the property is named `setEarlyAccess` (already looking like a setter), Objective-C's auto-generated setter is actually `-setSetEarlyAccess:` (double "set" prefix) - not `-setEarlyAccess:`. As written, this example would fail to compile with "no visible @interface... declares the selector setEarlyAccess:". This is a bug in the SDK's own header/doc-comment, not just the docs site.
- **`Asset > setLocale`**: no `setLocale` (or `setLocale:`) method exists anywhere in `Asset.h` - confirmed absent, not just renamed. (A `locale:` method does exist on `Query`, which may be what the doc meant to document instead.)
- **`Taxonomy > initWithStack`**: no public `initWithStack:` initializer exists on `Taxonomy`. Only a disabled `- (instancetype)init UNAVAILABLE_ATTRIBUTE;` is declared. Notably, `GlobalField.h` has the *exact* signature the doc describes, but **commented out**: `//- (instancetype)initWithStack:(Stack*)stack;` - strong evidence this was a real API that was deliberately removed/disabled without the doc being updated.
- **`Global Fields > find`**: no `find` or `find:` method exists on `GlobalField` - the real bulk-fetch method (confirmed present and correctly used elsewhere on the same page) is `fetchAll:`.

## Final counts

120 confirmed real / matching · 10 initially flagged, of which 4 are genuine confirmed bugs (above) and 6 are doc-heading truncations of an otherwise-correct example (not counted as bugs) · 15 no-example.

## Cross-verification

`repos/contentstack-ios/ContentstackTest` contains 16 Objective-C test files - a real XCTest suite exists, but running it has the exact same Xcode/Simulator requirement described above, so it wasn't executed for this pass.

## Scope note

This closes out the Content Delivery SDK **iOS** installment - and, along with Android, the two mobile platforms in this sweep. Given this SDK is explicitly being deprecated by Contentstack in favor of the Swift CDA SDK, a future pass might be better spent on that Swift SDK (`contentstack-swift` repo) instead of investing in the Xcode/Simulator toolchain for this Objective-C one - noting that possibility here rather than deciding it unilaterally. This is the last language in the "one at a time, don't wait for confirmation between languages" Delivery SDK sweep - all 12 languages listed on the SDKs page (TypeScript, Java, JavaScript, React Native, NodeJS, Python, .NET, PHP, Ruby, Dart, Android, iOS) have now been automated or (for iOS) audited to the extent the environment reasonably allows.

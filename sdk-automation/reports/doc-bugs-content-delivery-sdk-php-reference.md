# Doc automation report: Content Delivery SDK — PHP reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/php/reference
SDK repo: `contentstack/contentstack-php` (Composer package `contentstack/contentstack`)
Fixtures: shared with all other Delivery SDK language docs — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus the seeded asset and global field.

## Final result

82 documented methods → **58 passed, 13 failed, 11 no-example**.

## New harness: first PHP doc in this project

No PHP or Composer was installed on the machine at all. Installed both via Homebrew (`brew install php composer`) - a plain CLI formula install, no sudo prompt (unlike the .NET SDK's Homebrew cask). Built `src/execute/runPhpSnippet.ts`: wraps each snippet in a runnable `.php` script requiring `phpharness/vendor/autoload.php` (the real published `contentstack/contentstack` Composer package, installed once), executed with the system `php` CLI.

This is the cleanest first pass of any language in this sweep so far - **zero harness bugs were needed**; the doc's own examples were consistently quoted-string placeholders with no bare identifiers, no missing-semicolon corruption, and no casing collisions to work around.

## Confirmed doc bugs

- **`Stack > LivePreviewQuery`**: `array('content_type_uid'=? 'content_type_uid', ...)` - a typo'd array arrow (`=?` instead of `=>`), a hard PHP parse error.
- **`Stack > sync`, `Result > get`, `Result > toJSON`** (3 occurrences, same root cause): `$stack->sync({'init'=> true})` - uses `{ }` curly braces as if they were an array literal; PHP array literals require `array(...)` or `[...]`, not `{ }`. A hard parse error in all 3 examples.
- **`Contenttype > fetch` / `Entry` / `Query`, and `Entry > toJSON`** (4 occurrences, same root cause): `$stack-ContentType(...)` / `$result = ...-toJSON()` - missing the second `>` in the arrow operator (`->` rendered as `-`), which PHP parses as subtraction instead of a method call, producing "call to undefined function ContentType()"/"toJSON()". The same class of rendering corruption seen across nearly every language doc in this sweep (missing semicolons on Java, broken arrows here), just PHP's variant.
- **`Entry > includeReference`**: `includeReference(array('categories')))->fetch()` - an extra, mismatched closing paren.
- **`Query > getQuery` / `addQuery`** (2 occurrences): call `->containsIn('title', $_set)`, but the real method (used correctly in the separately-passing `Query > containedIn` example on the same page) is `containedIn` - a naming/typo mismatch.
- **`Stack > getContentTypes`**: called with zero arguments, but the real method signature requires at least one - confirmed via "Too few arguments to function ... getContentTypes()".
- **`Stack > getLastActivities`**: throws `Call to undefined function Contentstack\Support\request()` - this is an error inside the SDK's own internal implementation, not the doc's example code; the doc's usage is correct, but the method itself appears to reference an undefined internal helper function. Worth flagging to the SDK team as a real library bug rather than a docs bug.

## Final counts

58 passed · 13 failed (8 distinct confirmed doc bugs above, one of which - `getLastActivities` - is an SDK-internal bug rather than a docs bug; no harness gaps found) · 11 no-example.

## Cross-verification

`repos/contentstack-php/test` contains a real live-API test suite (`EntriesTest.php`, `SyncTest.php`, `AssetsTest.php`, etc.) that initializes a real `Contentstack::Stack(...)` via a `REST` helper reading actual API key/access token/environment - a genuine, meaningful cross-check available for a future deeper pass, unlike several other language repos in this sweep (Marketplace Java, Python) which only had mocked unit tests.

## Scope note

This closes out the **PHP** installment. Per standing instruction, proceeding directly to the next language: Ruby. Remaining after that: Android, iOS, Dart.

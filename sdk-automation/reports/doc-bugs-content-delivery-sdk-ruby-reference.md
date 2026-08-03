# Doc automation report: Content Delivery SDK — Ruby reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/ruby/reference
SDK repo: `contentstack/contentstack-ruby` (gem `contentstack`)
Fixtures: shared with all other Delivery SDK language docs — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus the seeded asset and global field.

## Final result

60 documented methods → **48 passed, 4 failed, 8 no-example**. Best pass ratio (92%) of any language automated in this sweep so far.

## New harness: first Ruby doc in this project

System Ruby was 2.6.10 (from 2022) - the gem's own gemspec requires `>= 3.3` (aligned with a transitive `nokogiri` dependency). Installed a current Ruby via Homebrew (`brew install ruby`, landed 4.0.6); the system `ruby`/`gem` binaries shadow the Homebrew ones on PATH, so the harness invokes `/opt/homebrew/opt/ruby/bin/ruby` explicitly rather than relying on `PATH` order. `gem install contentstack` installed cleanly against the newer Ruby with no further issues.

Built `src/execute/runRubySnippet.ts`: wraps each snippet in a `begin...rescue...end` block, printing the last top-level `@instance_variable = ...` assignment's value.

## Harness bug found and fixed (this was the big one)

**Ruby's leading-dot method-chain continuation breaks across a blank line.** Confirmed with a 4-line repro: `x = 1` on its own line, followed by a *blank* line, followed by `.to_s` - this is a `SyntaxError` ("unexpected '.'"), even though the identical code with no blank line in between is valid Ruby (leading-dot continuation is a real, common Ruby idiom, but requires the continuation line to immediately follow with no blank line). This doc's own rendering separates *every* logical line of every snippet with a blank line - which broke every single multi-line chained-call example on the page (roughly 35 of the doc's 60 methods on the first run). Not a doc bug: the exact same code compiles and runs fine once the blank lines are removed. Fixed generically in the harness by dropping a blank line whenever the next non-blank line starts with `.` or `&.` - this alone took the pass count from 16/52 to 48/52 in one fix.

## Confirmed doc bugs

- **`Client > sync`**: `@stack..sync({'init': true})` - a doubled dot. Ruby parses `a..b` as a Range literal rather than two chained calls, so this doesn't even reach `@stack`'s `sync` method - it tries to evaluate `sync(...)` as a bare top-level function call instead, producing the distinctive `undefined method 'sync' for main` (not `for an instance of Contentstack::Client`), which independently confirms the double-dot is being parsed as a Range rather than simply calling the wrong thing.
- **`Query > less_than_or_equal`**: the rendered code is `@entries = @stack.content_type("blog_post").query\n\n\t.\n\n('age', 20)\n\t.fetch;` - the method name itself is missing between the `.` and `(`, leaving an empty call. The same "method name stripped from the rendered sample" corruption class already confirmed on the Java and Python docs earlier in this sweep, here on Ruby too.
- **`Query > exists` / `not_exists`**: call `.exists(...)`/`.not_exists(...)`, but confirmed against source (`lib/contentstack/query.rb:105,117`) the real methods are `exists?`/`not_exists?` - Ruby's idiomatic trailing-`?` predicate-method naming convention, omitted in the doc.

## Final counts

48 passed · 4 failed (3 distinct confirmed doc bugs above; no further harness gaps after the leading-dot fix) · 8 no-example.

## Cross-verification

`repos/contentstack-ruby/spec` (11 files, RSpec) uses a `create_client` helper reading real credentials (`.env.test.example` present) rather than mocking - a genuine live-API test suite, consistent with most of the other language repos checked later in this sweep.

## Scope note

This closes out the **Ruby** installment. Per standing instruction, proceeding directly to the next language. Remaining: Android, iOS, Dart - the two mobile platforms will each get the same "check if it's really just a JVM/Swift wrapper before assuming an emulator/simulator is needed" treatment that paid off for React Native.

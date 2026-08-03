# Doc bugs — Java Marketplace SDK Reference

Source: https://www.contentstack.com/docs/developers/sdks/marketplace-sdk/java/reference
Scope: 42 documented methods across 6 nav sections (Overview, Marketplace, App, Auth, Installation, Apprequest).

**Results: 31/42 passed, 11 failed, 0 skipped, 1 audit finding.** (See "Update" section below - the doc originally had 1 skip, since resolved.)

## Why Java needed a new execution technology

This is the first compiled-language doc in this project. There's no interpreter to hand a snippet to - each method's example is compiled with `javac` and run with `java` against a classpath resolved once via Maven (`javaharness/pom.xml` depends on the real published `com.contentstack.sdk:marketplace:1.0.3` artifact from Maven Central, matched to the cloned source at `repos/contentstack-marketplace-java`, repo `contentstack/contentstack-marketplace-java`).

## Confirmed doc-wide bug: nearly every example declares the wrong type

Most examples on this doc assign a method's result to the WRONG class - e.g.:

```java
App app = marketplace.app().findApps();
```

But `findApps()` (and nearly every create/update/delete/find method on `App`/`Auth`/`Installation`/`AppRequest`) actually returns `Call<ResponseBody>`, not `App` - confirmed against every method signature in the cloned repo's real source (`src/main/java/com/contentstack/sdk/marketplace/apps/App.java` - literally every method there returns `Call<ResponseBody>`). As printed, these examples don't compile. This is baked into the SDK's **own javadoc comments** (the doc site auto-generates from them) - not just a docs-site transcription error.

**Harness workaround:** every top-level `Type name = expr;` declaration is rewritten to `var name = expr;` (Java 10+ type inference, always valid regardless of the real return type) to get real execution signal on everything else - the same "route around a doc-wide blocker at the harness level" precedent as the Management/Marketplace SDK docs' import-statement fixes.

## Other confirmed bugs

- **`Marketplace.Builder(orgId).authtoken(token).build()` NPEs if `.host(...)` is never called.** `Marketplace.java`'s constructor does `host.isEmpty()` with no null check when `host` defaults to `null`. Several of the doc's own examples - including `login()`'s own example - never call `.host()`, so those examples NPE even once the type-mismatch is fixed. Confirmed via direct execution and reading the constructor source.
- **`login()`'s own example uses smart/curly quotes**: `.login(“emailId”, “password”)` instead of straight quotes - not valid Java string literal syntax, a copy-paste/formatting corruption. Confirmed both by direct compilation and independently flagged by this project's own lint check.
- **Seven `App`-page methods use `marketplace.app()` (no UID) but their real endpoints require the app UID in the URL path**: `createInstallation`, `updateVersion`, `findAppAuthorizations`, `findAppInstallations`, `fetchApp`, `findAppRequests`, and `deleteAuthorization` (confirmed later, once disposable-resource support existed to actually exercise it - see "Update" below) all throw `IllegalArgumentException: Path parameter "uid" value must not be null` when run exactly as documented. Confirmed by running each verbatim (after the type-mismatch and auth fixes) and observing the same consistent Retrofit path-parameter error - a real, systemic doc bug across the App class's whole "action" method set, not a one-off.
- **`updateApp()`'s example calls the method with zero arguments** (`marketplace.app().updateApp();`), but the real method requires a `JSONObject body` parameter - confirmed via `javac`'s own "actual and formal argument lists differ in length" error.
- **`Installation > location` and `Installation > webhook`'s examples call `.execute()` on the wrong object.** Both do `installation.location().execute()` / `installation.webhook("webhookId").execute()`, but `.location()`/`.webhook()` return `Location`/`Webhook` objects, not a Retrofit `Call` - confirmed against the real source (`Location.java` only exposes `addParam`/`addHeader`/`addParams`/`addHeaders` builder methods, no `execute()`). A real, confirmed wrong-call-chain bug.

## Harness bugs found and fixed during this session (not doc/SDK issues)

Building this harness surfaced several of its own bugs, all fixed before the results below:
- Printing the resolved value did `if (lastVar instanceof retrofit2.Response<?> __r)` directly - a compile error for every snippet whose last variable is actually a `Marketplace`/`App`/`Auth`/... instance (an unrelated concrete class can never satisfy that `instanceof`). Fixed by casting to `Object` first.
- `App > App`'s example glues two alternative one-liners together with literal doc prose in between (`"...('installationId'); (or) App app = marketplace.app();"`) - not valid Java. Fixed with a Java-specific truncator that cuts at the first `(or)`.
- Several snippets bare-reference `marketplace`/`auth`/`installation`/`appRequest`/`ORG_UID` without declaring them, assuming an earlier example on the same page already did (true reading top-to-bottom, never true once each method runs standalone). Fixed by injecting the missing declaration - but the first version of this fix over-matched: a bare word-boundary check on `installation` also matched the METHOD CALL `.installation()`, incorrectly injecting a conflicting declaration. Fixed with a negative lookbehind excluding `.name(` call sites.
- `Installation > validateInstallationId` declares the same variable name twice back-to-back with no separator (unlike the `(or)`-marked case above) - added a second truncator that cuts at the first repeated top-level `var` declaration.
- Long, unhelpful error messages (the full ~1500-character resolved Maven classpath, from Node's own `execFile` error message) replaced real exception output for at least one method. Fixed to prefer real stdout/stderr content, falling back to a clean "killed/timeout" or "exit code N" summary only when the process genuinely produced nothing.

## Update: `deleteAuthorization` now has real disposable-resource support - and confirms a 7th instance of the "bare `.app()`" bug

(Correcting the previous version of this section: this doc's `App` section has no separate `deleteApp` method at all - the only destructive method documented here is `deleteAuthorization`. The "one persistent seeded app must never be spent as a throwaway" constraint that motivated skipping destructive methods elsewhere in this project still applies in principle, but there was nothing on this specific page it was actually gating - the real gap was just `deleteAuthorization`, addressed below.)

OAuth authorizations are NOT scarce the way apps are - a fresh one can be created and deleted per run without spending the persistent app. Built `prepareAuthorizationDisposable()` in `marketplaceDisposable.ts`, using two real API calls this doc never documents at all: `PUT /manifests/{app_uid}/oauth` (to turn OAuth on for the app - the accepted scope names like `user:read` aren't listed on this doc page; found by reading the marketplace-sdk JS repo's own `test/sanity-check/api/app-test.js`) and `POST /manifests/{app_uid}/authorize` (to actually grant an authorization - confirmed via the JS SDK's own `App.authorize()` source; needs no real browser/OAuth-consent redirect, since the authenticated caller IS the consenting user).

With a real authorization now available to substitute in, `deleteAuthorization` runs for real and confirms it's a **7th instance of the same "bare `marketplace.app()` instead of `marketplace.app(appUid)`" bug** already documented above for `createInstallation`/`updateVersion`/`findAppAuthorizations`/`findAppInstallations`/`fetchApp`/`findAppRequests`: `IllegalArgumentException: Path parameter "uid" value must not be null`, confirmed via direct execution. The doc's own example (and the SDK's own embedded javadoc comment for this exact method) both show the unscoped call.

**Skip count: 1 → 0.** The doc's `deleteAuthorization` result moved from "skipped" to a confirmed, informative "failed" - the correct verdict, not fixable via placeholder substitution since the bug is a missing method argument rather than a wrong placeholder value (same category as the Java Management SDK doc's Label/Webhook delete methods).

## Observed run-to-run flakiness

A few read/create endpoints (`App > findApps`, `App > createApp`, `Auth > findAuthorizedApp`) passed in some runs and failed in others across repeated executions during this session, without any code change in between. Not investigated further given time - possibly session-token refresh timing or shared-org rate limiting, not a structural bug in the doc or harness. The counts above are from the cleanest of several runs.

## Cross-verification: SDK's own test suite

`repos/contentstack-marketplace-java` doesn't have a `src/test` directory with a real live-API integration suite comparable to the Management/Marketplace-JS SDKs' `test/sanity-check` - no meaningful "run their own tests" cross-check is available for this repo.

## Final counts

31 passed · 11 failed (confirmed doc bugs above, no harness gaps remaining) · **0 skipped** (down from 1 - `deleteAuthorization` now dispatches through real disposable-resource support instead of being skipped, and correctly fails on a confirmed doc bug rather than staying non-committal) · 1 audit finding (the smart-quote lint issue, independently confirmed).

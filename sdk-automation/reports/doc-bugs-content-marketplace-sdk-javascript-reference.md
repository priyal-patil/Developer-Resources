# Doc bugs — JavaScript Marketplace SDK Reference

Source: https://www.contentstack.com/docs/developers/sdks/marketplace-sdk/javascript/reference
Scope: 59 documented methods across 9 nav sections (Overview, Marketplace, App, OAuth, Hosting, Deployment, Apprequests, Authorization, Installation) - much smaller than the Delivery/Management SDK docs, but with its own distinct init convention, host, and a scarce shared-resource constraint that shaped the harness design (see below).

**Results: 30/59 passed, 27 failed, 1 no-example, 1 skipped (by design), 17 audit findings.**

## Confirmed real bug #1 — same CJS/ESM import issue as the Management SDK doc

Every code example on this doc opens with `import * as contentstack from '@contentstack/marketplace-sdk'`. Verified directly (same method used for the Management SDK doc):

```
import * as contentstack from '@contentstack/marketplace-sdk';
console.log(typeof contentstack.client); // undefined
console.log(typeof contentstack.default.client); // function
```

Same root cause: the package is CJS-based with no proper ESM named-exports shim, so `import contentstack from '@contentstack/marketplace-sdk'` (default import) is the working form in plain Node.js. Confirmed real, not a harness artifact.

## Confirmed real bug #2 — several examples (and the SDK's own source JSDoc) import the wrong package name

A number of the doc's own examples - and, more surprisingly, the JSDoc comments inside the SDK's **own source code** (`lib/marketplace/app/index.js`, `lib/marketplace/index.js`, `lib/contentstack.js`) - use:

```js
import * as contentstack from '@contentstack/marketplace'
```

missing the `-sdk` suffix. `@contentstack/marketplace` is not the published package (`@contentstack/marketplace-sdk` is) - this import fails to resolve entirely. It's clear from the source that this SDK's JSDoc was copy-pasted from the Management SDK's source comments (`@contentstack/management`) and only partially adapted - many other JSDoc blocks in the same files still say `import * as contentstack from '@contentstack/management'` verbatim. This is a confirmed, source-level documentation bug that has propagated onto the live doc site.

## Confirmed real bug #3 — `client.organization(...)` doesn't exist on this SDK's client

One of the `Marketplace > installation` examples reads:

```js
client.organization('organization_uid').app('manifest_uid').installation().findAll()
```

Running this throws `client.organization is not a function`. Confirmed by reading `lib/contentstackClient.js`: the client this SDK returns only exposes `login`, `logout`, `marketplace`, and `axiosInstance` - there is no `organization` method. This example should read `client.marketplace('organization_uid')...` like every other example on the page. Real, confirmed doc bug.

## Confirmed real bug #4 — `target_type: 'stack'/'organization'` is not valid example syntax

The `App > update` and `App > create` examples both show:

```js
const updateApp = {
  name: 'APP_NAME',
  description: 'APP_DESCRIPTION',
  target_type: 'stack'/'organization',
}
```

`'stack'/'organization'` is valid *JavaScript* - string division - but it doesn't throw; it silently evaluates to `NaN`. Running the `App > create` snippet verbatim and inspecting the actual outgoing request body proves this:

```
"data":"{\"target_type\":null, ...}"
```

(`NaN` serializes to `null` via `JSON.stringify`.) The API then correctly rejects it: `"target_type must be one of the following values: stack, organization"`. This is meant to show "pick one of these two literal values" but is written as if it were executable code - a real, confirmed doc-writing bug, not a harness artifact.

## Confirmed real bug #5 — `App > update`/`Installation > update` reassign a `const`

Both examples declare the object with `const` and then reassign it:

```js
const app = client.marketplace('organization_uid').app('manifest_uid');
app = Object.assign(app, updateApp)   // TypeError: Assignment to constant variable.
app.update()
```

Running this verbatim throws `Assignment to constant variable.` immediately - it never reaches the actual `.update()` call the example is trying to demonstrate. Should be `let app = ...`. Confirmed via direct execution.

## Confirmed real bug #6 — `authorize()` references undeclared bare identifiers

```js
client.marketplace('organization_uid').app('app_uid').authorize({ responseType, clientId, redirectUri, scope, state })
```

This is object-shorthand syntax (`{ responseType }` means "use the variable named `responseType`"), but the example never declares any of these five variables. Running it verbatim throws `responseType is not defined`. The example needs either real assignments above it or non-shorthand placeholder strings.

## Confirmed real bug #7 — two more broken/malformed examples found while running verbatim

- `Installation > setServerConfig`: `setServerConfig({<configuration_details>})` - `<configuration_details>` is not valid inside an object literal (angle brackets aren't JS syntax); this is a parse error, not a runtime error.
- `Installation > fetchAll`: `fetchAll({ < optional params object>})` - same angle-bracket placeholder problem.
- `Installation > webhooks`: `client.marketplace('organization_uid')..installation('installation_uid').webhooks('webhook_uid')` - a literal double-dot typo (`)..installation`), a parse error.

All three fail before the SDK is ever invoked - genuine doc-formatting bugs, confirmed by generating the exact harness file and observing the parser reject it.

## Harness design note: apps are a scarce, org-wide, quota-limited resource

Unlike ContentType/Entry/Asset in the Management SDK doc (cheap and effectively unlimited per stack), Marketplace apps ("manifests") are scoped to the **whole organization**, and the org has a hard cap on how many can exist - discovered directly via a real `"you have reached the maximum number of allowed apps"` 400 response (the shared QA org already had **50** pre-existing apps from years of other teams'/automations' work, unrelated to this project). Two other undocumented real constraints were found the same way: app `name` must be ≤ 20 characters (`"name must be shorter than or equal to 20 characters"`), and `target_type` must be exactly `"stack"` (not `"organization"`) for the app to be installable onto a stack at all (`"Installation target not supported"`).

Given this, the harness design deliberately differs from the Management SDK doc's create-then-delete-immediately pattern:
- **One persistent app** ("SDK Auto App") is created once (find-or-reuse by name, same pattern as the dedicated stacks) and reused across every read/update/oauth/hosting/install snippet in the run.
- **`App > delete` is the one destructive method exercised**, and it's reordered to run **last** in the whole doc run - after every other App-section snippet that depends on the app still existing - reusing that same persistent app rather than spinning up a separate throwaway one. This confirmed the delete snippet genuinely works (verified via a follow-up GET, same pattern as the Management SDK doc's ContentType/Entry/Asset checks) while touching the org's app quota only once.
- A separate, small dedicated stack ("SDK Automation - Marketplace JS") was created purely as an **install target** for `App > install`/`upgrade` - isolated from the Delivery/Management docs' own stacks.
- Every other destructive-looking method (`Apprequests > delete`) has no disposable-resource support yet and is skipped by design, same policy as the Management SDK doc.

Also discovered along the way (not a doc bug, but undocumented on this page): the Marketplace API lives on **`developerhub-api.contentstack.com`**, not the regular CMA host (`api.contentstack.io`) - confirmed via `lib/contentstack.js`'s `client()`, which resolves `developerHub` as the default host. Paths have **no `/v3` prefix** (unlike the CMA), and `organization_uid` is sent as an **HTTP header**, not a query parameter (confirmed via `lib/marketplace/index.js`'s `this.params = { organization_uid }`, passed to axios as `headers`).

## Known, not-a-bug results

- `App > install` failed with `"Installation for app is already done"` and `App > upgrade` with `"You are already using the latest version."` - both are artifacts of the harness's own seed step already having installed the app onto the target stack beforehand (needed so `Installation`-section snippets have a real installation to read), not doc or SDK bugs.
- Most `Hosting`/`Deployment` methods (`enable`, `disable`, `createUploadUrl`, `latestLiveDeployment`, `Deployment > fetch/logs/findAll`) return `403 Forbidden` - these require a real hosting-enabled app with actual deployed code, which is out of scope for an automated doc-verbatim run (no code bundle to deploy). Not investigated further.
- `Marketplace > findAllAuthorizedApps` returned `401` - the doc's own example calls `contentstack.client()` with **no** `authtoken` for this one method (unlike every other example on the page), which is either intentional (a public-ish endpoint that behaves differently in some auth context this project didn't have) or itself a doc inconsistency - not conclusively isolated either way in this pass.
- `Apprequests > create` and `Authorization > revoke` returned real API-level validation errors (403/400) against placeholder UIDs (`target_uid`, `authorization_uid`) that don't correspond to real seeded resources - incomplete coverage, not confirmed bugs, same category as the Management SDK doc's unseeded sections.

## Audit findings (17 total)

- **4 missing-method**: `App > upgrade`, `App > getRequests`, `Apprequests > AppRequests`, `Installation > webhooks` don't appear in the installed package's `.d.ts` files (cross-checked against the cloned repo's source too, for `AppRequests` and `webhooks` - genuinely absent, not just an audit false-positive).
- **13 output-mismatch**: mostly container/constructor-style methods (`Marketplace > Marketplace`, `App > App`, `OAuth > Oauth`, `Hosting > Hosting`, `Authorization > Authorization`, `Installation > Installation`, and a few chained-getter methods like `App > oauth`/`App > hosting`/`App > authorization`) that ran cleanly but don't return an observably-loggable value in the doc's own example (they return a chainable object, not data) - a harness-capture limitation for this specific example style, not a real doc/SDK defect.

## Final counts

30 passed · 27 failed (7 confirmed doc bugs above + known-limitation Hosting/Deployment/auth-context cases + incomplete-coverage unseeded sections) · 1 no-example (`Deployment` section heading itself) · 1 skipped (`Apprequests > delete` - destructive, no disposable-resource support built for it) · 17 audit findings (4 missing-method, 13 output-mismatch).

## Update: `Apprequests > delete` investigated - stays skipped, blocked by a real platform permission wall

After the sibling Java Marketplace doc's `deleteAuthorization` skip was fixed via a real OAuth-authorize API call (see that report), the same "can we build a real disposable fixture instead of skipping" question was tried here for `Apprequests > delete`.

`AppRequests.create({appUid, targetUid})` (`POST /requests`) consistently returned `403 Forbidden` ("You don't have the permission to perform this operation") across every variant tried: the existing stack-scoped persistent app, a fresh org-scoped app, and after attempting to flip the app's `visibility` to `public`. `AppRequests.findAll()` (`GET /requests`) works fine with the same credentials, ruling out a basic auth/org-access problem - the rejection is specific to creating a request.

The most likely explanation, based on what "app request" conceptually means (a user with only stack-level access requesting an org admin's approval to install an app) is that this call requires the requester to be a **different, lower-privileged user** than the app's own creator/org admin - a scenario this project's single QA test account can't simulate. The org has several invited users on file, but all are `"status": "pending"` (invite never accepted) - there's no way to authenticate as any of them without email access to complete the invite flow.

**Conclusion: this specific skip is not fixable without a second, already-active real user identity in the org** - a genuine external dependency, not a fixture-engineering gap the way `deleteAuthorization` turned out to be. Left as a documented skip rather than forcing a fix that doesn't actually work.

## Cross-verification: SDK's own sanity test suite

Same parity treatment as the Delivery and Management SDK docs: ran the cloned `contentstack-marketplace-sdk` repo's **own** test suite (`test/sanity-check/`) against the shared QA org, as an independent check on the SDK itself, separate from the doc-snippet harness above. The suite covers, in order: user-session login (5 tests), App CRUD (create/fetch/update/search/install), OAuth fetch/update, Installation configuration/server-config/data lookups, Hosting details, org-wide Installation listing, AppRequest create/list/delete, Authorization fetch/revoke, then App uninstall+delete as its own cleanup step.

**Setup bug found in the test harness itself (not a doc bug):** the suite's own `ContentstackClient.js` test helper hardcodes both `client({ host, defaultHostName })` to the same `DEFAULTHOST` env value. Login (`/v3/user-session`) only works on the standard CMA host (`api.contentstack.io`); Marketplace calls need the DeveloperHub host (`developerhub-api.contentstack.com`) - forcing both onto one host made every single test fail at login with a 401 on the first attempt. Fixed by leaving `HOST`/`DEFAULTHOST` blank in the repo's test `.env`, letting the SDK's own internal defaults correctly split the two hosts. This is a real bug in the repo's own test config, not the doc - the doc never tells readers to call `client.login()` this way; every doc example instead passes a pre-obtained `authtoken` directly to `contentstack.client({ authtoken })`, sidestepping this entirely (which is exactly what this project's own harness does too).

**Results after the host fix:**

| Metric | Count |
|---|---|
| Total tests | 36 |
| Passing | 5 |
| Failing | 31 |

All 5 passes are the login/logout suite - confirming basic SDK authentication works correctly end-to-end against the real API. Every test from `Apps api Test` onward failed, all cascading from a single root cause: **`Create app test` itself failed**, and every later test in the file depends on the app it should have created.

**Root cause of the cascade - the same org-wide app quota hit earlier in this pass:** a direct check of `GET /manifests` immediately after the run confirmed the org is still sitting at exactly 50 apps (unchanged), and none of ours - meaning `Create app test` never actually created anything; it was rejected before creation.

**A second, genuine SDK bug surfaced by this rejection:** rather than surfacing the API's real error (the same clean `"you have reached the maximum number of allowed apps"` 400 this project's own harness saw earlier), the SDK's response-error interceptor itself crashes:

```
TypeError: Cannot read properties of undefined (reading 'retryCount')
  at responseErrorHandler (lib/core/concurrency-queue.js:12:410)
```

`lib/core/concurrency-queue.js`'s `responseErrorHandler` unconditionally reads `error.config.retryCount` as its very first line, with no null-check. When an axios error arrives without a `.config` property attached (as apparently happens for this particular rejection shape), the interceptor throws its own unrelated `TypeError` instead of the real backend error - masking the actual, informative message from every caller, not just this test suite. This is a genuine, confirmed defect in the SDK's own error-handling code, independent of the doc entirely - worth reporting upstream separately from the doc-bugs above.

**Cleanup:** since `Create app test` never got past the quota rejection, no app was ever created by this run - nothing to delete on that front. The temporary stack ("SDK Marketplace Repo Test") created solely to supply a valid `API_KEY` value for the `installation.js` test file was deleted afterward and confirmed gone.

**Bottom line:** the parity check confirms the SDK's core login/auth path works correctly, and independently surfaced two more real findings beyond the doc itself - a host-config bug in the repo's own test harness, and a defensive-coding bug in the SDK's error interceptor that swallows real API errors behind a misleading crash. Full App-CRUD-level cross-verification remains blocked by the shared QA org's app quota, an environmental constraint outside this project's control (deleting other teams' 50 pre-existing apps to make room was not attempted, for the same reason destructive actions on shared resources generally aren't).

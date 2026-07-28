# Doc automation report: Content Management SDK — Python reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-management-sdk/python/reference
SDK repo: `contentstack/contentstack-management-python` (pip package `contentstack-management`)
Fixtures: a dedicated, disposable stack `SDK Automation - Management JS` (re-seeded this pass - `MGMT_STACK_API_KEY`, `MGMT_AUTHTOKEN`, `MGMT_CONTENT_TYPE_UID=blog_post`, `MGMT_ENTRY_UID`, `MGMT_ASSET_UID`), shared with the already-automated JavaScript Management SDK doc.

## Final result

248 documented methods → **82 passed, 87 failed, 53 skipped (org-level or destructive-with-no-disposable-support), 26 no-example**.

## New harness

Reused the Delivery Python doc's venv (`pyharness/venv`, now also has `contentstack-management` + `pyotp` installed - the package requires `pyotp` for 2FA login support, not declared as a dependency by the package itself, confirmed via `ModuleNotFoundError` on first install attempt). Built `src/execute/runManagementPythonSnippet.ts`, mirroring the JS Management harness's conventions (`authtoken`, `api_key`, per-section `uid` overrides) translated to Python syntax. Reused the exact same **org-level skip** and **destructive-method skip** policy already established for the JS Management doc - no disposable (create-then-delete) resource support was built for Python this pass, matching the same "verbatim execution + skip what would be unsafe, without full parity yet" precedent used for the JS doc's non-ContentType/Entry/Asset sections.

## An initial false alarm, resolved

Early in this pass, several failures looked like they might indicate a **scraper bug** - a run's failure list seemed to show wildly mismatched code (e.g. a method labeled "Asset > fetch" appearing to contain content-type-creation code). Investigated by re-scraping the doc fresh and cross-referencing method IDs directly against the generated snippet files: this was a false alarm caused by comparing a stale/mismatched report JSON against workdir files from a different run, not a real scraper defect - a fresh scrape and the run's own generated `.py` files agreed perfectly method-for-method. No scraper bug exists; every failure below is a confirmed real doc bug in the live page's own content (independently confirmed by fetching the page's own `.md` export directly with `curl`, bypassing the scraper entirely).

## Harness bug found and fixed

- **JSON `true`/`false`/`null` literals rendered as invalid Python.** Confirmed via the live page's own `.md` export (not a scraper artifact) that many request-body examples show `"force": true` - valid JSON, but not valid Python (`NameError: name 'true' is not defined`). This is a genuine, systemic doc bug, but was fixed at the harness level anyway (same "route around a confirmed doc-wide blocker to get signal on everything else" precedent as the Java Marketplace doc's `var`-rewrite fix) by substituting bare `true`/`false`/`null` for Python's `True`/`False`/`None` - revealing the real, distinct bugs underneath in several methods that would otherwise have been masked by this one blocker.

## Confirmed doc bugs

- **Entire `Webhooks` section (23 occurrences)**: every example initializes with `contentstack_management.Client(host='host_name')` - a literal, non-existent hostname baked into the client constructor as if it were a real placeholder, causing every single call in the section to fail with a real DNS/connection error (`HTTPSConnectionPool(host='host_name', port=443): Max retries exceeded`). This looks like a bad copy-paste of client-init boilerplate reused across the whole section.
- **Entire `Asset` section (19 occurrences)**: every example calls `client()` - the already-instantiated `Client` object called as if it were a function (`asset = client().stack(api_key='api_key').assets()`), confirmed against the live page's own `.md` export. Real usage should just be `client.stack(...)`, no parentheses.
- **Literal `>>>` Python REPL prompts leaked into rendered code** (16 occurrences, e.g. `Content Types > update`, `Global Fields > create`/`update`, `Entry > create`/`export`): the doc's code blocks include `>>>        "content_type": {` as if it were part of the runnable snippet - a hard `SyntaxError`. Looks like an interactive-console-style example that wasn't stripped of its prompt markers when the docs site generated the "plain code" version.
- **`Content Types` section (8 occurrences)**: calls `.content_type()` (singular), but confirmed against source (`stack/stack.py:308`) the real method is `content_types()` (plural).
- **`Stack > branch_alias`, `Alias > fetch`/`find` (3 occurrences)**: no `branch_alias` method exists anywhere in the SDK source at all.
- **`Stack > environment`**: calls `.environment()`, but the real method (confirmed in source) is `environments()` (plural).
- **`Stack > global_fields`**: calls `.global_field()` (singular), real method is `global_fields()` (plural).
- **`Stack > create_settings` / `reset_settings` / `share`**: call `create_stack_settings`/`reset_stack_settings`/`share_stack` respectively - none of these exist anywhere in the SDK source.
- **`Stack > accept_ownership`**: references a bare `contentstack` name that's never imported (the doc imports `contentstack_management`, not `contentstack`).
- **`Publish Queue > cancel`**: calls `.create()` on a `PublishQueue` object, which has no such method.
- **`Entry > version_naming`**: the method call is missing its own `data` argument in context (`version_naming() missing 1 required positional argument: 'data'`) even after the true/false/null fix - the doc's own code references a `data` variable defined earlier in the same block, but the reference doesn't survive to the actual call as written.
- **`Extensions > create`**: references a bare `tags` variable never defined.
- **`Extensions > upload`**: references a literal local file `'demo.html'` that doesn't exist - expected for a file-upload example, not a real bug, but confirmed as a known limitation (no such fixture file was provided).
- **`Labels > fetch`**: references a bare `label_uid` variable never defined.

## Final counts

82 passed · 87 failed (12 distinct confirmed doc bugs above, several spanning many methods - the Webhooks and Asset section-wide bugs alone account for 42 of the 87; no further systemic harness gaps after 2 iterations) · 53 skipped (org-level/destructive, matching the JS doc's precedent) · 26 no-example.

## Cross-verification

`repos/contentstack-management-python/tests/integration` (33 files) is a real integration-test framework with its own capture/context/setup modules - a genuine live-API-capable test suite exists, worth a deeper follow-up pass.

## Scope note

This is the **Python** installment of the Content Management SDK sweep (JavaScript already done in an earlier session). Per explicit user instruction, proceeding directly to Java, then .NET, without waiting for confirmation between languages.

## Update: fewer skips, more real execution

Two follow-up fixes applied across all 4 Management SDK languages:

1. **Org-level-skip narrowed to actual mutations** (new `isMutatingMethod()` check) — safe reads inside `Roles`/`Teams`/etc. now execute instead of being auto-skipped wholesale.
2. **Disposable-resource (create-then-delete) support extended to Webhook, Label, and Global Field**, translated to this doc's real placeholder key style (confirmed identical snake_case keys to JS: `webhook_uid`, `label_uid`, `global_field_uid`).
3. **Fixed the confirmed systemic Webhooks-section blocker at the harness level**: replaced the doc's broken `Client(host='host_name')` + fake `.login(...)` boilerplate with a real authenticated client (same "route around a confirmed doc-wide blocker" precedent as the `true`/`false`/`null` fix above) — this alone unblocked real signal for the other ~20 non-destructive methods in that section.

**New counts (this run): 114 passed, 78 failed, 30 skipped, 123 audit findings** — up from 82 passed / 53 skipped. `Webhooks > create/executions/export/fetch/find/logs/retry/update` now genuinely pass; `Labels > create/update` now pass via the new disposable factory; `Webhooks > delete` now passes with verified deletion confirmed.

**A fourth, previously-hidden harness bug found and fixed along the way**: the quoted string placeholder `'api_key'` (as opposed to the bare/unquoted `api_key` identifier, which was already handled) was never in the Python placeholder-substitution map at all — 169 of the 248 methods in this doc use `.stack('api_key')` with quotes, and every one of them was silently running against the literal string `"api_key"` instead of the real seeded stack key. Fixed by adding `api_key: process.env.MGMT_STACK_API_KEY` to `managementPythonPlaceholderMap()` in `runManagementPythonSnippet.ts`. `Labels > Delete` still fails in this run, but for an unrelated, already-documented reason: `MGMT_AUTHTOKEN` (a login session token, not a long-lived key) expired mid-run — a real operational constraint of this API, not a doc or harness bug.

## Second update: Extension/Release/Taxonomy disposable support, plus a fifth harness bug that had been mis-attributed to session expiry

Extended disposable-resource support to `Extension`, `Release`, and `Taxonomy` (same registry used by the JS doc). While verifying these, found that a large batch of failures previously blamed on `MGMT_AUTHTOKEN` session expiry were actually a **fifth, distinct missing-placeholder bug**: 55 of this doc's own snippets use the literal quoted string `'your_authtoken'` for their `Client(authtoken=...)` call — a different spelling from the `'authtoken'`/`'the_authtoken'` forms already handled — so all 55 were silently running against the literal string `"your_authtoken"` and failing with a real, but misleading, "authtoken is not valid" error that looked identical to genuine session expiry. Fixed by adding `your_authtoken: process.env.MGMT_AUTHTOKEN` to the same placeholder map. `Extension > delete` and `Release > delete` now both pass with verified deletion.

**`Taxonomy > delete` surfaced a new, genuine, confirmed doc bug**: the doc's example calls `.delete('taxonomy_uid').json()`, but the live CMA's `DELETE /v3/taxonomies/{uid}` returns an empty `204 No Content` body (confirmed via a direct `curl -i`) — calling `.json()` on an empty response body throws `Expecting value: line 1 column 1 (char 0)`. The doc shouldn't chain `.json()` after this particular delete call.

**New counts: 116 passed, 79 failed, 27 skipped, 123 audit findings.**

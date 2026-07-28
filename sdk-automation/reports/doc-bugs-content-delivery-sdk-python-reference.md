# Doc automation report: Content Delivery SDK — Python reference

Doc: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/python/reference
SDK repo: `contentstack/contentstack-python` (pip package `contentstack`)
Fixtures: shared with all other Delivery SDK language docs — stack `blt63205a44a56ee96f`, delivery token `csea3b44e05e5c55667ae5112c`, environment `production`, entry `blt4e3a3a29a2fd9219` (content type `blog_post`), plus the seeded asset and global field.

## Final result

81 documented methods → **43 passed, 30 failed, 8 no-example**.

## New harness: first Python doc in this project

Built `src/setup/pythonHarness.ts` (a `pyharness/venv` virtualenv, created once and reused, with the real published `contentstack` pip package installed) and `src/execute/runPythonSnippet.ts` (wraps each snippet in a runnable `.py` script, executed with the venv's `python`). Key differences from the Node/Java harnesses:
- No missing-semicolon problem — Python tolerates a trailing `;` as a harmless empty statement, so none of the doc's own `;`-terminated lines needed fixing (unlike Java).
- Significant whitespace means the "wrap in a function" step has to re-indent every line of the snippet by exactly 4 spaces rather than just adding braces — implemented in `buildHarness()`.
- Several Stack getters (`get_api_key`, `get_headers`, `get_branch`, `get_environment`, `get_delivery_token`, `get_live_preview`) are real `@property`s in the source, not methods — confirmed against `contentstack/stack.py` before assuming the doc's parens-less `stack.get_api_key` (no `()`) was a bug. It isn't.

## Harness bugs found and fixed

- Bare (unquoted) placeholder identifiers `api_key`, `delivery_token`, `environment`, `content_type_uid`, `entry_uid`, etc. — same class of fix as the other language harnesses, needed here too since most Python examples pass these as bare positional arguments rather than quoted strings.
- `stack.live_preview_query(**kwargs)` / `stack.image_transform(url, **kwargs)` reference a bare `kwargs` dict-unpack that's never defined anywhere in the snippet — injected an empty `kwargs = {}` so the call is at least runnable.
- `Query > where`'s example references `QueryOperation.EQUALS` without importing it — injected `from contentstack.basequery import QueryOperation` when referenced but not imported by the snippet itself.

## Confirmed doc bugs

- **Widespread wrong keyword-argument name on `entry()`** (7 occurrences: `ContentType > entry`, `Entry > fetch`/`include_embedded_items`/`include_branch`/`include_fallback`/`param`/`version`/`environment`): every example calls `content_type.entry(uid='entry_uid')`, but the real signature (`contenttype.py:35`, `def entry(self, entry_uid: str)`) takes `entry_uid`, not `uid`. Confirmed via `entry() got an unexpected keyword argument 'uid'` and reading the source directly. This is the single largest, most systemic bug found on this doc.
- **Doc-rendering corruption: method name stripped from the sample** (3 occurrences: `Stack > asset_query` first variant, `Asset > remove_environment`, `AssetQuery > include_fallback`/`include_branch`): the rendered code shows `asset.\n\n('production')` or `stack.asset_query().\n\n()` — the actual method name between the `.` and `(` is missing entirely, leaving an empty line where the doc's templating apparently failed to substitute the method name. Same class of doc-page-rendering corruption as the Java "missing semicolon" and RN "SStack"/"Stack;/Assets()" bugs found earlier in this sweep, just a new failure mode.
- **`AssetQuery > include_metadata`**: calls `stack.assetQuery()` (camelCase) instead of the real `stack.asset_query()` (snake_case) used consistently everywhere else on this same page.
- **`Asset > include_metadata`**: calls `asset.include_metadata()`, but confirmed against source: `Asset` has no such method (only `AssetQuery` does).
- **`Asset > params`**: calls `asset.param(...)`, but confirmed against source the real method is plural (`params`, not `param`) — or vice versa; either way, a naming mismatch between doc and implementation.
- **`Global Fields > find`**: calls `global_field.find(param=some_dict)`, but the real signature (`globalfields.py:51`) takes `params` (plural), not `param`.
- **`Query > addParams`**: calls `query.addParam(...)` — confirmed the `Query` class has no `addParam` attribute at all.
- **`Query > where`**: builds `query = content_type.query("field_uid", QueryOperation.EQUALS)` then calls `query.where()` with zero args — confirmed `query()` itself only takes 1 positional argument, not the 2 shown, so the example's own initial call is already wrong before `.where()` is even reached.
- **`Query > include_reference` / `excepts` / `locale` / `where_not_in` / `where_in`**: each calls its method with zero arguments (`query.include_reference()`, `query.excepts()`, `query.locale()`, `query.where_not_in("brand")` with only 1 of 2 needed, etc.) where the real signature requires a positional argument (`field_uid`, `locale`, or `query_object`) — confirmed via `missing 1 required positional argument`.
- **`Query > tags`**: calls `query.tags(...)` then `query.fetch()` — confirmed `Query` has no `fetch()` method (that's an `Entry`/`Asset` method; the Query equivalent is `find()`).
- **`Query > query_operator`**: the example references `self.query1`/`self.query2` — `self` outside any class definition, a genuine `NameError`. Looks like a snippet copy-pasted from inside the SDK's own internal class/test code rather than real standalone usage.
- **`Entry Variants > Get a Single Entry Variants`**: rendered code ends with a stray extra `)` with no matching open paren — the same class of doc-rendering corruption as above, just a mismatched-bracket variant.
- **`Stack > pagination`**: calls `contentstack.Stack(api_key=..., access_token=..., environment=...)`, but the real `Stack.__init__` doesn't accept an `access_token` kwarg (it's `delivery_token` everywhere else in this same SDK) — confirmed via `unexpected keyword argument 'access_token'`.

## Final counts

43 passed · 30 failed (12 distinct confirmed doc bugs above, several appearing multiple times; 3 harness bugs found and fixed) · 8 no-example.

## Cross-verification

`repos/contentstack-python/tests` (13 files) uses `pytest` fixtures with a `DummyHttpInstance` mock rather than live API calls — no meaningful "run their own tests" cross-check available for this repo, same conclusion as the Marketplace Java SDK.

## Scope note

This closes out the **Python** installment. Per standing instruction, proceeding directly to the next language. Remaining: .NET, PHP, Ruby, Android, iOS, Dart.

# Doc automation report: Content Delivery SDK — NodeJS

Doc entry points:
- Overview: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/nodejs/about-nodejs-delivery-sdk
- Get Started: https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/nodejs/get-started-with-nodejs-delivery-sdk
- "API reference" link (as labeled in the NodeJS sidebar section): https://www.contentstack.com/docs/developers/sdks/content-delivery-sdk/javascript-browser/reference

SDK repo: `contentstack/contentstack-javascript` (same repo/package as JavaScript-browser and React Native — npm package `contentstack`, imported via `import Contentstack from 'contentstack'`, no subpath).

## Key finding: NodeJS has no separate reference doc

Before building anything, the actual link behind the NodeJS section's own "JavaScript Delivery API Reference" sidebar entry was checked (via the rendered page's real DOM `<a>` tag, not a guessed slug) — it resolves to `content-delivery-sdk/javascript-browser/reference`, i.e. the **exact same page** already fully automated and reported in `doc-bugs-content-delivery-sdk-javascript-reference.md`. There is no separate 85-method NodeJS reference to re-run; running it again would be pure duplicate work with zero new signal, so it was skipped.

The only content genuinely unique to the NodeJS doc is its 2-example "Get Started" guide, which was checked directly instead.

## Confirmed doc bug: "Get a Single Entry" example throws in the current SDK version

The Get Started guide's "Get a Single Entry" example is:

```js
const Query = Stack.ContentType('blog').Entry("entry_uid")
Query.fetch()
   .then(function success(entry) { ... })
```

Run verbatim (with real fixture values) against the currently published `contentstack@3.27.1`, `.fetch()` called without a preceding `.toJSON()` throws:

```
Cannot call a class as a function
```

Confirmed via isolation: the identical call chain succeeds the instant `.toJSON()` is inserted before `.fetch()` (`Stack.ContentType('blog_post').Entry(uid).toJSON().fetch()`), returning the real entry JSON. Every method-reference-page example that passed in the JavaScript-browser/React Native runs also always included `.toJSON()` before `.fetch()`/`.find()` — this Get Started guide is the only place in the whole SDK's docs that shows the shorter, currently-broken `.fetch()`-only form as the primary "getting started" example, which is exactly the code a first-time reader is most likely to copy.

## Get Started guide's other example — confirmed working

"Get Multiple Entries" already includes `.toJSON()` in its own chain (`.includeSchema().includeCount().toJSON().find()`) and runs successfully against the fixture stack, returning `[schema-or-empty, entries[], count?]` per the doc's own description.

## Positional-args `Stack()` constructor — confirmed working, not a bug

The Get Started guide initializes the stack with positional string arguments (`Contentstack.Stack(apiKey, deliveryToken, environment)`) rather than the options-object form (`Contentstack.Stack({api_key, delivery_token, environment})`) shown everywhere else in the docs. Verified directly: both forms work identically — this is a real, supported overload, not a bug, just an inconsistency in which form different pages choose to show.

## Final counts

Reference content: fully covered by the JavaScript-browser report (61/85 passed there) — not re-run. Get Started guide: 2 unique examples checked directly, 1 confirmed bug (missing `.toJSON()` in "Get a Single Entry").

## Scope note

This closes out the **NodeJS** installment. Per standing instruction, proceeding directly to the next language: Python.

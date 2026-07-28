# Doc automation report: Personalize Edge SDK — JavaScript reference

Doc: https://www.contentstack.com/docs/developers/sdks/personalize-edge-sdk/javascript/reference
SDK package: `@contentstack/personalize-edge-sdk` (npm, `1.0.23`). Repo (`contentstack/personalize-edge-sdk-js`, per the package's own `package.json`) is **private** — not publicly clonable, confirmed via a 404 on GitHub and a repo search under the `contentstack` org turning up nothing. Cross-checking was done directly against the installed package's own `.d.ts` files instead of cloned source.

Fixtures: a real, disposable Personalize project (`SDK Auto Personalize`, uid persisted as `PERSONALIZE_PROJECT_UID`) created via the live Personalize Management API (`POST https://personalize-api.contentstack.com/projects`, body `{name, description, connectedStackApiKey}`, headers `Authtoken`/`Organization_uid`) and connected to the existing shared Delivery SDK stack. The exact request shape wasn't in this doc at all — found by reading the Management SDK JS repo's own sanity-test setup (`test/sanity-check/utility/testSetup.js`), which creates a throwaway Personalize project the same way for its own test suite.

## Result: 30/30 runnable snippets pass against the real, live API

This doc's 30 code examples split into two mirrored sections: the (deprecated) global `Personalize.*` namespace functions (16: `init`, `setEdgeApiUrl`, `getExperiences`, `triggerImpression`, `triggerImpressions`, `triggerEvent`, `set`, `setUserId`, `getUserId`, `getActiveVariant`, `getInitializationStatus`, `addStateToResponse`, `getVariants`, `getVariantAliases`, `getVariantParam`, `variantParamToVariantAliases`, `reset`) and the equivalent instance methods on the object `Personalize.init()` returns (14, everything above except `setEdgeApiUrl`/`getInitializationStatus`/`reset`/`init` itself, which the doc doesn't repeat in the SDK-instance section). Every one of these 30 ran cleanly against the real API with a real, empty-audience Personalize project — no crashes, no confirmed doc bugs.

The remaining 7 headings (`SetUserIdOptions`, `InitOptions`, `ClientAttributes`, `ManifestExperience`, `Manifest`, `TriggerImpressionsOptions`, `InitializationStatus`) are the "Types and Interfaces" section — pure type/shape documentation with no runnable code, correctly categorized as no-example rather than failures.

This is the cleanest doc in the entire sweep so far (Delivery/Management/Marketplace/Utils SDKs all had at least one confirmed bug per language). The deprecation warnings the SDK prints at runtime for every global-namespace call (e.g. `"Calling the Personalize.getExperiences as a global function ... has been deprecated ..."`) match the doc's own inline "Warning:" callouts on each deprecated method almost verbatim — a nice, confirmed instance of the doc and the runtime agreeing with each other.

## One observation, not a confirmed bug

`variantParamToVariantAliases('')` (called with the empty-string variant param our zero-experience test project naturally produces) returns `['cs_personalize_']` — a single malformed-looking alias with a trailing underscore and no actual UIDs — rather than an empty array. This might be a genuine edge-case gap (empty input isn't special-cased), or might simply be undefined/unsupported behavior for an input the doc doesn't say anything about (every doc example passes a real, non-empty variant param). Flagged for awareness, not counted as a confirmed bug given the doc makes no claim about the empty-input case.

## Methodology note

Given this doc's small size (30 runnable snippets, similar order of magnitude to the Utils SDK docs) and the private/inaccessible repo (no signature-audit cross-check possible against real source), this was run via a direct, hand-authored Node.js execution script against the real API rather than being wired into the project's full generic scrape-and-audit pipeline (`index.ts`/`config/docs.json`) — the same lightweight approach already used for the Utils SDK sweep. `setEdgeApiUrl` was tested in a separate, isolated process (its own file) since it mutates module-level state for the rest of that process's lifetime with no way to reset it — confirmed real behavior when pointed at the EU region for a project that only exists in the default AWS-NA region: a clean `Error: Project not found: <uid>`, correctly surfaced, not a bug.

## Final counts

30 passed · 0 failed · 0 skipped · 7 no-example (Types and Interfaces, no runnable code) · 1 non-blocking observation (empty-input edge case, not a confirmed bug).

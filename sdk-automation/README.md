# sdk-automation

Reads each Contentstack **SDK reference doc**, runs every code snippet verbatim
against a seeded QA stack, and reports any snippet that fails to run, any
documented method that doesn't actually exist on the SDK, and any resolved
output that disagrees with what the doc claims.

Sibling of `kickstart-automation`, `building-websites-automation`, and
`cli-automation` in this workspace — same verbatim-execution contract (run the
doc exactly as written, substitute only placeholder→real seeded value, never
silently fix a broken snippet, record every gap and keep going).

## Setup

```bash
npm install
cp .env.example .env   # fill in the shared QA org credentials
npm run seed            # creates/reuses a persistent stack for this project
npm run run-one -- content-delivery-sdk-typescript-reference
npm run report
```

`reports/index.html` shows a pass/fail pill per method section after each run,
with filter buttons (All / Fail / Pass / No example) to jump straight to
failures.

## Re-running just the failures

```bash
npm run run-one -- content-delivery-sdk-typescript-reference --only-failures
```

Reads the previous run's `reports/<docName>-latest.json` (or `reports/latest.json`
as a fallback), re-executes only the methods that failed, and carries over every
already-passing/no-example result unchanged — the new report still covers the
whole doc, not just the retried subset. Useful after a harness tweak or once an
upstream doc/SDK fix lands, without waiting on everything that already passes.

## Comparing against the SDK's actual source

Add a `repoName` to a `config/docs.json` entry (see below) and clone the
matching repo from `config/sdk-repos.json` into `repos/<repoName>` (gitignored):

```bash
git clone --depth 1 https://github.com/contentstack/contentstack-typescript.git repos/contentstack-typescript
```

When present, `npm run run-one` cross-checks every "missing method" finding
against the repo's actual source (not just the installed npm package), which
can upgrade a vague "doesn't appear in the installed package" into a precise,
cited root cause — e.g. it caught `ImageTransform` being a fully-implemented
class that `src/index.ts` accidentally re-exports as type-only, breaking every
documented `new ImageTransform()` call. It also caught this project's own
`package.json` being pinned to a stale major version (`^4.0.0` instead of the
actual latest `^5.4.0`) - always confirm the installed package version matches
the repo's `package.json` before trusting a "missing method" finding.

## Scraping the doc: DOM scrape vs `.md` fetch

Contentstack's docs-site markdown/LLM-export (`<url>.md`, the "View as Markdown"
feature) has a real bug: it flattens separate per-example code-tab widgets into
one text blob, dropping every line break between them. Confirmed by checking
the live rendered pages directly — the content itself is fine; only the export
is corrupted. Set `"scrapeMode": "dom"` on a `config/docs.json` entry to scrape
the rendered page instead, via a headless browser
(`src/parse/parseDocDom.ts`, Playwright) - this is what
`content-delivery-sdk-typescript-reference` uses, and it's the reason its pass
rate is meaningfully higher and its findings meaningfully cleaner than a
`.md`-based run. Omit `scrapeMode` (or set it to `"md"`) to use the older
`parseDoc.ts` markdown-fetch path for docs where DOM scraping hasn't been set
up yet.

## Cross-verifying with the SDK's own API test suite

Once a repo is cloned (see below) and its dependencies installed
(`cd repos/<repoName> && npm install`), you can run its own live-API tests
against the same seeded stack as a second opinion, independent of this
project's doc-scraping pipeline:

```bash
cd repos/contentstack-typescript
cp ../../.env.example .env   # or hand-fill: HOST, API_KEY, DELIVERY_TOKEN, ENVIRONMENT, IMAGE_ASSET_UID
npx jest test/api/asset.spec.ts   # or any other test/api/*.spec.ts
```

If the SDK's own test for a method passes, the method is confirmed correct at
the implementation level - any doc-side failure for that method is then very
likely a doc bug, not an SDK bug. This is how the `Asset` class's two doc bugs
(wrong variable name, wrong generic type argument) got confirmed rather than
just suspected.

## Why this stack isn't torn down

`cli-automation` tears its stack down after every run because it exercises
export/import/migration commands that mutate state. This project's snippets
are read-heavy SDK calls (`fetch`, `find`, query filters), so the seeded stack
is created once and reused — `STACK_API_KEY`/`DELIVERY_TOKEN` get written back
into `.env` by `npm run seed`. Only `sdkKind: "management"` docs (added later)
will need create→run→delete handling around individual write snippets.

## Adding another SDK doc

Add an entry to `config/docs.json`:

```json
{ "name": "...", "url": "...", "sdkPackage": "...", "sdkKind": "delivery" | "management", "runtime": "node-ts", "scrapeMode": "dom" }
```

No code changes needed unless the doc introduces a genuinely new `sdkKind` or
`runtime` (e.g. a Python/Java SDK doc, or a management-write-heavy doc that
needs its own cleanup strategy).

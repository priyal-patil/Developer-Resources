# Building Websites Automation

Executes the **Building Websites** docs verbatim — terminal commands and Contentstack
dashboard actions — verifies the promised result, and reports gaps. Standalone
subproject (own deps, `.env`, schedule); same contract as `../kickstart-automation`:
**execute exactly as written, report gaps, never self-heal.**

First target: [Get Started With Building a Website](https://www.contentstack.com/docs/headless-cms/get-started-with-building-a-website).

Second target: [Build and Deploy a Website with Contentstack and Launch](https://www.contentstack.com/docs/headless-cms/build-and-deploy-website-contentstack-launch) — added to `config/docs.json` and fully wired into `execute/*`/`parse/*` (see below). It runs on the same daily schedule as the first doc via `run-all` in `.github/workflows/kickstart-docs.yml`'s `run-building-websites` job. It was also manually verified end-to-end earlier (see `../launch-deploy-trial/reports/` and `../launch-deploy-retest/reports/`), which is where the confirmed workaround this harness now applies (Framework Preset "Other") came from.

### Adapting the harness for a second, structurally different doc

The first doc clones a starter repo and imports a content-model zip; this one scaffolds a fresh `create-next-app`, builds its content model via the Management API, and validates a curl call — different enough that several parser/executor gaps had to be fixed (not just doc-specific config):

- **Parser now sees the doc's `raw` prose, not just pre-filtered "shell-like" lines.** `classify()` previously only looked at already-filtered commands, so a step whose identifying text lives in prose (e.g. "Open `app/page.tsx` and add the following") was invisible to it. Fixed by threading `rawText` into `classify()`.
- **Fence delimiters (` ``` `) are now kept in `step.raw`** (previously stripped during line-scanning) — needed so a step's fenced code can be found and extracted at all (the new `file`-kind handler, and the curl-script detector, both search for fenced blocks in `raw`).
- **New `file` step kind** — writes a doc's labelled code block verbatim to the project file it names (`next.config.ts`, `lib/contentstack.ts`, `app/page.tsx`). Doc-agnostic; any future doc with this "open `<path>` and add" pattern gets it for free.
- **Multi-line shell scripts stay as ONE command.** The curl-validation step sets several shell variables then references them in one `curl` call — splitting it into separately-run lines (the existing per-line model) would lose the variables between subprocess calls. Detected via `hasCurlInFence()` (curl must be *inside* a fence, not just doc prose mentioning the word "curl" near an unrelated diagram — an earlier version of this check false-matched the doc's Architecture Overview section for exactly that reason).
- **`shellLike()`'s bare `export` match was too broad** — it's meant for `export NAME=value` (bash), but was also swallowing TypeScript's `export default nextConfig;` / `export async function ...`. Narrowed to require the bash assignment form.
- **New dashboard branches**: "Create a (New) Stack" regex broadened to match this doc's "Create a Stack" heading; a new "Create Environments" (plural, no token in the same step) branch that loops over every environment name the doc's own text lists; new content-type/entry creation via the Management API (`execute/launchDoc.ts`) since this doc has no CLI seed/zip to lean on.
- **`KickstartConfig.environment`** — the environment name was hardcoded to `"development"` in `index.ts` for the first doc; now configurable per doc (this one uses `"staging"`).
- **`KickstartConfig.navRoutes`** — the verify stage's nav-route screenshot pass (checking `/menu`, `/about-us`, `/contact`) was hardcoded for the first doc's known gap; now opt-in per doc so the second doc (which has no such routes) doesn't get false "gap" results.
- **Bonus fix, unrelated to this doc:** regression-testing the first doc surfaced a real, separate break — its zip-download link's markdown format changed (now wrapped in `<...>` with a literal space, e.g. `(<https://.../Stack Data.zip>)`), which the existing regex didn't handle. Fixed alongside this work since it was trivial and left the shared pipeline correctly working end-to-end again.
- **Launch deployment itself is intentionally still never executed by this harness** — Step 7 continues to hit the pre-existing `/deploy.*launch/i` → "report-only by design" branch. This isn't a gap to close; it's the quota-safe design this needs (a scheduled job that created a real Launch project every run would exhaust the org's project quota within days, as seen firsthand in `../launch-deploy-retest/`).

Both docs were re-run through the full pipeline for real after these changes (`npx tsx src/index.ts <name>`) to confirm no regression: the first doc's report is unchanged (same 5 documented findings, same PASS on the home page render); the second doc now passes Steps 2–6 for real (real stack/content-type/entry/token creation, real curl `HTTP 200`, real file writes, real dev-server render of "My Company Website") with Step 7 correctly staying report-only.

## Pipeline (inherited from kickstart-automation)

```
parse → execute (shell / dashboard / env, verbatim) → cross-check → verify app → report
```

Doc-specific adaptations in this copy:
- Sections split on `##` **and** `###` (this doc's steps are `###` sub-sections); FAQ entries filtered.
- Region codes per this doc: `US, EU, AZURE_NA, AZURE_EU, GCP_NA`.
- Starter repo `.env.sample` (not `.env.example`); environment name `development`.
- The doc's placeholder clone (`your-username/your-repo-name`) is fulfilled by cloning the
  upstream starter (`contentstack-getting-started-react-app`) — the *fork* step itself is
  reported as adapted, since the harness has no QA GitHub account.

## Status

### get-started-building-a-website

- ✅ Parse — 10 steps, all classified correctly
- ✅ Shell / env / verify / report / teardown — inherited, typechecks
- ✅ Create a New Stack (UI) — proven headless; asserts the doc's promised redirect
- ✅ Create Environment (`development`) + Delivery Token ("PlateStack") — both via UI
- ✅ Import Content Types — downloads the doc's zip, imports all 4 JSONs in doc order
- ✅ Create Entries — doc's exact values (Header, Footer, Page "Home" + 3 assets),
  published to development; performed via Management API (reported as [api])
- ⏭ Deploy via Launch — report-only by design
- ✅ **End-to-end outcome verified: the PlateStack home page renders as promised** (screenshot in reports/)

### build-and-deploy-website-contentstack-launch

- ✅ Parse — 13 steps, all classified correctly (curl-validation script kept as one
  multi-line command; 3 code-block steps classified as the new `file` kind)
- ✅ Create a Stack / Environments (`staging`, `production`) — both via UI
- ✅ Create the Homepage Content Type + Entry — via Management API (`execute/launchDoc.ts`)
- ✅ Create a Delivery Token — via UI (existing branch reused as-is)
- ✅ Validate API Access with curl — real `HTTP 200` against the real entry
- ✅ Create the Next.js App, static export config, fetch helper, page component —
  scaffolded for real, doc's exact code blocks written verbatim
- ✅ Configure Environment Variables — all 6 vars (incl. `_CDN_HOST`, `_CONTENT_TYPE_UID`,
  `_ENTRY_UID`) written from real captured values
- ⏭ Deploy via Launch — report-only by design (see above; quota-safety, not a gap)
- ✅ **End-to-end outcome verified: the homepage renders "My Company Website" as promised** (screenshot in reports/)

## Doc findings so far

### get-started-building-a-website

1. 🔴 **Create Entries never covers "Dishes"** — the Import step imports the Dishes
   content type and the zip ships dish images, but no Dishes entries are ever created;
   the Menu page's content is unaccounted for.
2. 🟠 The "Configure Contentstack" env code block is **empty in the markdown/"Copy for
   LLM" export** — variable names only visible on the webpage (same export-pipeline
   issue as the Nuxt kickstart).
3. 🟡 The doc says "Click on the **Import Content Type** button" — the actual UI control
   is an unlabeled icon (aria-label "Import List").
4. 🟡 **Stale bug note:** the doc says "The URL for the Home page will be empty after
   publishing… This is a bug that will be fixed soon" — the bug did NOT reproduce
   (url="/" survived publishing); the workaround note appears outdated.
5. 🟠 Nav links point to /menu, /about-us, /contact but the doc never creates Page
   entries for them (part of finding 1) — those routes have no content.

### build-and-deploy-website-contentstack-launch

All findings below were confirmed via manual verbatim runs (`../launch-deploy-trial/`,
`../launch-deploy-retest/`) **and have since been fixed by the doc's own authors** —
kept here as a record of what this harness's Launch-step workaround (Framework
Preset "Other") exists to guard against, in case the doc regresses:

1. ✅ *(fixed in the doc)* Following the doc's literal first-draft instructions
   (auto-detected Framework Preset "NextJs" + Output Directory `out`) made the real
   Launch deployment fail with `Invalid output directory: out`, even though the local
   build succeeded. The doc now explicitly warns to select "Other" instead.
2. ✅ *(fixed in the doc)* "Enable Contentstack Authentication" defaults ON and would
   gate the deployed site behind a login wall; undocumented in the first draft. The
   doc now explicitly instructs turning it off for a public site.
3. ✅ *(fixed in the doc)* Output Directory auto-populates as `./.next` for the
   NextJs preset, not `out`; the doc now calls this out explicitly.
4. ✅ *(fixed in the doc)* The doc's described "Create New Project modal with an
   Import from a Git Repository button" didn't match the real UI (a direct
   GitHub/BitBucket/File Upload dropdown); the doc's wording now matches.

## Run

```bash
npm install
cp .env.example .env   # same QA-org credentials as kickstart-automation
npm run run-one        # executes what's implemented; UI flows report as planned
```

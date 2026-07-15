# Building Websites Automation

Executes the **Building Websites** docs verbatim — terminal commands and Contentstack
dashboard actions — verifies the promised result, and reports gaps. Standalone
subproject (own deps, `.env`, schedule); same contract as `../kickstart-automation`:
**execute exactly as written, report gaps, never self-heal.**

First target: [Get Started With Building a Website](https://www.contentstack.com/docs/headless-cms/get-started-with-building-a-website).

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

- ✅ Parse — 10 steps, all classified correctly
- ✅ Shell / env / verify / report / teardown — inherited, typechecks
- ✅ Create a New Stack (UI) — proven headless; asserts the doc's promised redirect
- ✅ Create Environment (`development`) + Delivery Token ("PlateStack") — both via UI
- ✅ Import Content Types — downloads the doc's zip, imports all 4 JSONs in doc order
- ✅ Create Entries — doc's exact values (Header, Footer, Page "Home" + 3 assets),
  published to development; performed via Management API (reported as [api])
- ⏭ Deploy via Launch — report-only by design
- ✅ **End-to-end outcome verified: the PlateStack home page renders as promised** (screenshot in reports/)

## Doc findings so far

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

## Run

```bash
npm install
cp .env.example .env   # same QA-org credentials as kickstart-automation
npm run run-one        # executes what's implemented; UI flows report as planned
```

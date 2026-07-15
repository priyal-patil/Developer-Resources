# Kickstart Automation

Reads each Contentstack **Kickstart** doc, performs the steps, verifies the resulting
app works, and flags any step that is **broken**, **missing**, or **ambiguous**.

Standalone subproject — own deps, `.env`, and schedule.

## CI (GitHub Actions)

`.github/workflows/kickstart-docs.yml` (repo root) runs this project on every push
to `kickstart-automation/**`, every Monday, and on manual dispatch (pick specific
kickstarts or `all`). Reports (JSON/HTML/screenshots/.docx) are uploaded as a
workflow artifact — nothing is committed back to the repo.

Requires these **repository secrets** (Settings → Secrets and variables → Actions),
never committed to the repo:

| Secret | Value |
|---|---|
| `CONTENTSTACK_EMAIL` | QA-org account email |
| `CONTENTSTACK_PASSWORD` | QA-org account password |
| `CONTENTSTACK_REGION` | e.g. `AWS-NA` |
| `CONTENTSTACK_ORG_NAME` | e.g. `Contentstack QA` |
| `SLACK_CHANNEL_EMAIL` | *(optional)* the Slack channel's email address (Slack → channel → Integrations → "Send emails to this channel") |
| `ALERT_FROM_EMAIL` | *(optional)* the sending mailbox, e.g. a Google Workspace address |
| `ALERT_EMAIL_PASSWORD` | *(optional)* an **app password** for that mailbox (not the account password) |

If all three are set, every run emails a pass/fail summary + a link to the full
report/screenshots/.docx to that Slack channel (Slack posts emails sent to a
channel's address as a message). Skipped silently if any of the three is unset.
Uses Gmail/Google Workspace SMTP (`smtp.gmail.com:465`) — swap the `server_address`
in the workflow if your mailbox is on a different provider.

## Pipeline

```
parse  →  execute  →  verify  →  report
 │          │           │          │
 │          │           │          └─ flags broken / missing / ambiguous steps
 │          │           └─ npm run dev, HTTP 200, page renders, screenshot
 │          └─ shell / cli / dashboard(Playwright) / env
 └─ doc → ordered, classified DocStep[]  (uses "Copy for LLM" markdown)
```

## Setup

```bash
cd kickstart-automation
npm install
cp .env.example .env      # fill in test-org credentials (see note below)
```

## Run

```bash
npm run run-one           # first kickstart in config (dry run today — stages are stubs)
npm run run-one -- nuxt   # a specific kickstart
npm run run-all           # every kickstart in config/kickstarts.json
```

Adding a kickstart = one entry in `config/kickstarts.json`, usually just:

```json
{ "name": "astro", "doc": "https://www.contentstack.com/docs/headless-cms/astro" }
```

`repo`, `port`, `envKeys`, and `stackName` are **derived from the doc** (the
`git clone` command, the env block, the `localhost:PORT` mention). Add a `variant`
+ `stepRange` only when one page documents multiple guides (like Nuxt standard + SSR),
and set any field explicitly only to override what's derived.

## Status

1. ✅ `src/parse/parseDoc.ts` — fetches `<url>.md`, splits into classified steps
2. ✅ `src/execute/executeStep.ts`
   - ✅ shell/CLI — clone, `npm install`, safe `csdx` commands (runs for real)
   - ✅ credentialed CLI — non-interactive `auth:login` + `cm:stacks:seed`
   - ✅ Org ID via browser — performs the doc's "Org Admin → Info" step (select org →
     App Switcher → Administration → Info → read Organization UID) and feeds the seed
   - ✅ dashboard — delivery/preview token + Live Preview via Playwright UI (API fallback)
   - ✅ env — writes `.env` and cross-checks doc keys vs repo `.env.example`
3. ✅ `src/verify/verifyApp.ts` — boots the app, fails on 4xx/5xx + framework error pages, screenshots
4. ✅ `src/report/generateReport.ts` — JSON + on-brand HTML report (`reports/index.html`) with embedded screenshots
5. ✅ auto-teardown — `src/api/contentstack.ts` deletes the seeded stack after each run

### Contract: execute verbatim, report gaps — never self-heal
The harness performs each doc step **exactly as written** and reports any gap; it does
not work around broken steps. Everything (repo URL, env var names, stack name, port)
is **derived from the doc**, not config. It also cross-checks the doc's claims against
the cloned repo: the **Project Structure** tree and every **code snippet**.

**UI click-path verification:** every label the doc names in a dashboard path
("Settings > Tokens", "Org Admin > Info") is asserted against the live app's
navigation during the browser flow. A label that no longer exists (e.g. a renamed
menu item) is reported as a gap even when the harness still completes the outcome.

### Final results — all 7 kickstarts (verbatim execution, de-noised)

| Kickstart | Verdict | Gaps found |
|---|---|---|
| react | ✅ PASS | — |
| angular | ✅ PASS | — |
| sveltekit | ✅ PASS | — |
| astro | ✅ PASS | — |
| next (5 variants) | 🔴 GAPS (all 5 apps run) | standard: structure lists `lib/utils.ts` (doesn't exist); `contentstack.ts` snippet outdated (`@timbenniks/contentstack-endpoints` → repo uses `@contentstack/utils`); "Org Admin" → app says **Administration**; "Settings > Live Preview" → app nav says **Visual Experience**. middleware: doc says "same env vars as earlier" but repo also reads `NEXT_PUBLIC_CONTENTSTACK_SSR` + `NEXT_PUBLIC_CONTENTSTACK_EDITABLE_TAGS` (undocumented). ssr/graphql/ssg: ✅ clean |
| nuxt | 🔴 GAPS (app 500s) | env keys `NUXT_PUBLIC_CONTENTSTACK_*` should be `NUXT_CONTENTSTACK_*`; snippet names `composables/getPageData.ts` (repo: `useGetPage.ts`); UI labels drifted — doc says "Org Admin" (app: **Administration**) and "Settings > Live Preview" (app nav: **Visual Experience**) |
| nuxt-ssr | 🔴 GAPS | same as nuxt, + its env list starts with `NEXT_PUBLIC_` (typo), + doc says "reuse earlier stack" (isolated runs can't — harness limitation, reported) |

Minor doc notes: nuxt's `csdx config:set:region AWS-EU` is a region example; the Note
lists per-region values (harness follows the Note).

Commands are gated by a policy (`src/execute/runner.ts`) and rewritten for headless
execution (`rewriteCommand`): region/org come from `.env`, login gets `-u/-p`
(password never logged), seed gets a unique name + `-y`, and `npm run dev` is
deferred to the verify stage.

## Notes

- Use a **dedicated / throwaway Contentstack org** — each run seeds a new stack.
- The Nuxt (and most) kickstarts need **Node ≥ 22**; switch with `nvm use 22` before runs.

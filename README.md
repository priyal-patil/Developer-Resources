# Developer Resources Docs Automation

Automated validation of the **Developer Resources** section of
[contentstack.com/docs](https://www.contentstack.com/docs) — the parts of the
documentation a reader *executes* rather than clicks through: Kickstarts,
Building Websites, the CLI, and the SDKs.

Every subproject does the same thing in a different domain: **run the doc's own
commands and code verbatim, then report every step that is broken, missing, or
ambiguous.** The deliverable is a findings report for technical writers, not a
product regression suite.

> Part of a family of three independent docs-automation projects
> (this one, the [Docs Automation Suite](https://github.com/priyal-patil/contentstack-docs-automation-suite)
> for UI docs, and [API Docs Automation](https://github.com/priyal-patil/api-docs-automation)
> for the API reference). The shared ground rules, credential sources, and QA-org
> gotchas live in the **common guide**, [`DOCS-AUTOMATION-COMMON.md`](DOCS-AUTOMATION-COMMON.md),
> in this repo. Read it once; this README is self-sufficient for everything else.

---

## The contract (read this before changing anything)

- **The doc is the spec, never the app.** If the doc's command fails, that is the
  finding. Do not substitute the value that actually works.
- **Verbatim execution.** Run the doc's exact commands, in order, with the doc's
  values. Supplying a required input (credentials, an org ID, answering a prompt)
  *is* performing the step. Substituting different content is not.
- **Record the gap and continue.** One run produces one complete gap report.
- **Cross-check the doc's assertions too** — the Project Structure tree against the
  cloned repo, every code snippet against the real file, every "X > Y" UI label
  against the live app's nav. A renamed menu item is a finding even when the
  outcome still succeeds.
- **Every bug report needs three parts:** what's wrong, why (root cause, confirmed
  by running it), and the specific fix.

---

## Subprojects

Each folder below is **fully standalone** — its own `package.json`, `node_modules`,
`.env`, reports, and CI schedule. The `.code-workspace` file only opens them
together in one VS Code window; it does not couple them.

| Folder | Section it validates | Status |
|---|---|---|
| [`kickstart-automation/`](kickstart-automation/) | Kickstarts — Nuxt, Next ×5, React, Angular, SvelteKit, Astro, Veda | ✅ 12 guides validated |
| [`cli-automation/`](cli-automation/) | CLI docs — every `csdx` command and example, plus a flag audit against `--help` | ✅ complete |
| [`sdk-automation/`](sdk-automation/) | SDKs — Delivery, Management, Utils, Marketplace, Personalize Edge, DataSync, across 10+ languages | ✅ complete ([`MASTER_REPORT.md`](sdk-automation/MASTER_REPORT.md)) |
| [`building-websites-automation/`](building-websites-automation/) | Building Websites — Get Started guide | 🚧 scaffolded; UI flows pending |

The `*-trial/` folders (`ai-website-trial`, `launch-deploy-trial`,
`live-preview-trial`, `new-page-trial`, `react-staging-trial`) are **one-off
investigations**, not maintained pipelines — a `setup.mjs`, a `_report.cjs`, and
whatever evidence that particular question needed. Useful as reference, not
something to schedule.

**API docs are not here by design** — they live in
[`api-docs-automation`](https://github.com/priyal-patil/api-docs-automation) and
run on their own.

---

## Prerequisites

| | |
|---|---|
| **Node.js 20+** | for most subprojects |
| **Node.js 22+ under `~/.nvm`** | required by `cli-automation` only — `csdx --help` is broken on Node ≤21 (`ERR_REQUIRE_ESM`). This is the doc's own prerequisite. The runner finds it automatically; your shell default doesn't matter. |
| **git** | to clone the kickstart repos each doc points at |
| **A Contentstack QA-org account** | AWS-NA region, Owner/Admin |
| **Playwright chromium** | `npx playwright install chromium` — used for the dashboard steps |
| **Language toolchains** | `sdk-automation` only, and only for the languages you run — Python, Java, .NET, PHP, Dart, Android. Each harness folder is independent, so you can run just the TypeScript ones with nothing extra installed. |

---

## Quick start

```bash
git clone https://github.com/priyal-patil/Developer-Resources.git
cd Developer-Resources
```

Then pick **one** subproject — there is no root-level install, and no root
`package.json`. Each is set up independently:

```bash
cd kickstart-automation
npm install
cp .env.example .env      # fill in QA-org credentials
npm run run-one -- nuxt   # smallest useful run: one kickstart
```

Open the generated `reports/index.html` in a browser. If that produced a report,
your credentials work and you can scale up.

To open all four subprojects together in VS Code:

```bash
code developer-resources.code-workspace
```

---

## Credentials

Every subproject reads a gitignored `.env` created from its own `.env.example`.
The shared keys:

| Key | Where to get it |
|---|---|
| `CONTENTSTACK_EMAIL` | Your QA-org account email |
| `CONTENTSTACK_PASSWORD` | Your QA-org account password |
| `CONTENTSTACK_ORG_ID` | App → **Organization Settings → Organization Info** |
| `CONTENTSTACK_REGION` | `AWS-NA` for the QA org |
| `WORKDIR` | Where cloned repos and scratch projects go (kickstart / building-websites) |
| `AUTOMATE_DASHBOARD` | Whether Playwright drives the app for dashboard steps |

`sdk-automation` additionally needs `STACK_API_KEY`, `DELIVERY_TOKEN`,
`ENVIRONMENT`, and the `SEED_*` UIDs — all produced for you by `npm run seed`.

Never commit `.env`. In CI these are **repository secrets** under
Settings → Secrets and variables → Actions, with the same names.

---

## Running each subproject

### `kickstart-automation`

Reads each Kickstart doc, performs the steps, verifies the resulting app actually
runs, and flags broken/missing/ambiguous steps.

```bash
npm install
cp .env.example .env
npm run run-one            # first kickstart in config
npm run run-one -- nuxt    # a specific one
npm run run-all            # every kickstart in config/kickstarts.json
npm run report             # regenerate the HTML report
```

Pipeline: `parse → execute → verify → report`. Adding a kickstart is usually one
entry in `config/kickstarts.json`:

```json
{ "name": "astro", "doc": "https://www.contentstack.com/docs/headless-cms/astro" }
```

`repo`, `port`, `envKeys`, and `stackName` are derived from the doc itself.

### `cli-automation`

Runs every command and example in the CLI docs verbatim against a freshly seeded
throwaway stack, then statically lints every code block for authoring bugs (smart
quotes, unbalanced quotes, en-dashes where a flag's hyphen belongs, invisible
characters).

```bash
npm install
npm run run-one                # first doc in config/docs.json
npm run run-one -- <name>      # a specific doc
npm run report                 # regenerate reports/index.html
npm run teardown -- <apiKey>   # manual cleanup if a run was killed hard
```

The seeder deliberately creates real resources whose names *match the doc's dummy
values* (content types `blog_post`/`article`/`product_page`, environments
`production`/`development`, a management token aliased `production`) so the doc's
commands run literally as printed.

### `sdk-automation`

Executes every code example in every SDK reference doc, in its real language,
against a live seeded stack.

```bash
npm install
cp .env.example .env
npm run seed                                              # creates/reuses this project's stack
npm run run-one -- content-delivery-sdk-typescript-reference
npm run report
```

Extra seeders exist for the Management, Marketplace, App, and Java-Marketplace
surfaces (`npm run seed:management`, `seed:marketplace`, `seed:app`,
`seed:java-marketplace`). `reports/index.html` shows a pass/fail pill per method
section with All / Fail / Pass / No-example filters.

### `building-websites-automation`

```bash
npm install
cp .env.example .env
npm run run-one    # executes what's implemented; UI flows report as planned
```

---

## Reports

Each subproject writes to its own `reports/` (gitignored):

- `latest.json` — machine-readable findings, the source of truth
- `index.html` — the report you actually read
- screenshots, and a `.docx` export where the audience is a technical writer

In CI nothing is committed back — reports are uploaded as workflow **artifacts**.

---

## CI

Workflows in [`.github/workflows/`](.github/workflows/), one per subproject:

| Workflow | Triggers |
|---|---|
| `kickstart-docs.yml` | push to `kickstart-automation/**`, weekly (Monday), manual dispatch (pick a kickstart or `all`) |
| `cli-docs.yml` | scheduled + manual dispatch |
| `sdk-docs.yml` | scheduled + manual dispatch |

Required repository secrets: `CONTENTSTACK_EMAIL`, `CONTENTSTACK_PASSWORD`,
`CONTENTSTACK_REGION`, `CONTENTSTACK_ORG_NAME`, plus the optional alert trio
`SLACK_CHANNEL_EMAIL`, `ALERT_FROM_EMAIL`, `ALERT_EMAIL_PASSWORD`. If all three
alert secrets are set, each run emails a pass/fail summary to the Slack channel's
email address (Slack posts it as a message); if any is unset the step is skipped
silently. SMTP defaults to Gmail/Workspace (`smtp.gmail.com:465`) — change
`server_address` in the workflow for another provider.

GitHub cron is **UTC only** and best-effort; schedules are written in UTC with the
intended IST time in a comment.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `csdx --help` fails with `ERR_REQUIRE_ESM` | Node ≤21. `cli-automation` needs Node 22+ under `~/.nvm`. |
| "Stack not found" for a stack that existed yesterday | QA-org stacks churn — other automations delete them. Re-run the seeder. |
| Everything 401s after working for days | Authtoken evicted (a user caps at ~20; logins elsewhere evict the oldest). Use email+password. |
| A run went green after you "fixed" an expectation | If the fix was to copy a value from the app instead of the doc, revert — that mismatch *was* the finding. |
| Orphaned stack after a killed run | `cd cli-automation && npm run teardown -- <apiKey>` |

---

## Adding a new subproject

1. Create a standalone folder with its own `package.json` and `.env.example`.
2. Add it to the `folders` array in `developer-resources.code-workspace`.
3. Add its own workflow in `.github/workflows/` with its own cron.
4. Add a row to the Subprojects table above.

Keep it standalone. Do not share a runner or a login with an existing
subproject — a broken shared runner takes every doc area down at once.

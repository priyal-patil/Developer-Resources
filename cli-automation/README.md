# CLI Docs Automation

Validates Contentstack **CLI docs** by doing exactly what a reader would do: run every
command and example in the doc, verbatim, against a real (seeded) stack in the
Contentstack QA org — then report every gap. Standalone sibling of
`kickstart-automation/` (same QA org, same verbatim-execution contract, same
report style).

## What a run does

1. **Parse** — fetches the doc as markdown (`<url>.md`) and extracts every code
   block (classified: command / syntax / CI yaml / config json / tree / sample
   output), the **Options** table, the **Configuration File Options** table, and
   the prerequisites.
2. **Setup** — snapshots the csdx global config, then seeds a throwaway stack in
   the QA org whose real values *match the doc's dummy values*:
   - content types `blog_post`, `article`, `product_page` (2 entries each)
   - environments `production` / `development`, a label, an asset
   - a wide-scope management token registered under alias **`production`** —
     so `csdx cm:stacks:export -a production …` runs literally as printed
3. **Execute** — every csdx command in doc order, in a fresh workdir:
   - dummy → real substitutions are minimal and recorded (`<alias>`,
     `blt1234567890abcdef`, `/path/to/...`); command shape never changes
   - doc-provided JSON configs are written to the filename the doc uses,
     then the `-c` commands run against them
   - CI snippets (GitHub Actions / GitLab) have their embedded csdx command
     extracted and run
   - the Step-1 GitHub config download links are fetched (link-rot check)
   - Windows-only examples are skipped (recorded as platform-skips)
   - post-check: an export that "succeeds" must actually have written the
     module folders it promised
4. **Text lint** — every code block (including sample outputs and trees) is
   statically checked for authoring bugs: smart/curly quotes, mismatched or
   unbalanced quotes, double/trailing colons in the csdx command path,
   en/em dashes where a flag's hyphen belongs, and invisible characters
   (non-breaking space, zero-width) that break copy-paste. The doc's **prose**
   is linted too, with tighter rules (curly quotes and em dashes are legal
   typography there): malformed command mentions, dashes on known flag names,
   mismatched/unclosed quotes, doubled words, invisible characters.
5. **Flag audit** — `csdx <command> --help` parsed and diffed against the doc's
   Options table: missing-in-doc, extra-in-doc, short-flag mismatches,
   description drift.
6. **Structure check** — the doc's "Export Directory Structure" tree vs what the
   full export actually wrote.
7. **Teardown** — deletes the stack, removes the token alias, restores the csdx
   config snapshot. Runs even if the pipeline crashes.

## Contract (same as kickstarts)

Execute **exactly as written, report gaps, never self-heal**. Supplying required
inputs (credentials, answering a prompt) counts as performing the step;
substituting different content does not. Failures caused by the QA plan rather
than the doc (e.g. **branches are unavailable** on the QA org, so `--branch
develop` examples fail) are labeled `[environment limitation]` in the report.

## Usage

```bash
npm install
npm run run-one                # first doc in config/docs.json
npm run run-one -- <name>      # specific doc
npm run report                 # regenerate reports/index.html from latest.json
npm run teardown -- <apiKey>   # manual cleanup if a run was killed hard
```

Requires Node **22+** available under `~/.nvm` (the doc's own prerequisite —
csdx `--help` is broken on Node ≤21 with ERR_REQUIRE_ESM). The runner finds and
uses it automatically; your shell's default Node doesn't matter.

Credentials: `.env` (gitignored) — same QA org (AWS-NA) as kickstart-automation.

## Adding the next doc

Append to `config/docs.json`:

```json
{ "name": "import-content", "url": "https://…/import-content-using-the-cli", "commands": ["cm:stacks:import", "cm:import"] }
```

`commands` lists which `csdx` commands the doc's Options table describes (used
for the `--help` flag audit — include aliases the doc claims, e.g. `cm:export`).
New docs may need extra dummy→real mappings in `src/execute/substitute.ts` and
seed data in `src/setup/seed.ts`.

## Outputs

- `reports/index.html` — gap dashboard (dark Contentstack style)
- `reports/latest.json` + `reports/<doc>-<runid>.json` — raw results
- `workdir/run-<ts>/` — everything the commands wrote (exports, configs)

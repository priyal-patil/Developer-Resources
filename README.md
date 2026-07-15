# Developer Resources Docs Automation

Umbrella workspace for automating validation of the **Developer Resources** documentation
sections at [contentstack.com/docs](https://www.contentstack.com/docs).

Each subproject below is **fully standalone** — its own dependencies, `.env`, and schedule.
The `.code-workspace` file just opens them together in one VS Code window; it does not
couple them.

## Open in VS Code

```bash
code Developer-Resources-Docs-Automation/developer-resources.code-workspace
```

## Subprojects

| Folder | Section it validates | Status |
|---|---|---|
| `kickstart-automation/` | Kickstarts (Nuxt, Next ×5, React, Angular, SvelteKit, Astro, Veda) | ✅ complete — 12 guides validated |
| `building-websites-automation/` | Building Websites (Get Started guide) | 🚧 scaffolded — UI flows next |
| `sdk-automation/` | SDKs | ⏳ planned |
| `cli-automation/` | CLI | ⏳ planned |

> The **API docs** automation lives separately in `../contentstack-doc-automation/`
> and is not part of this workspace by design — it runs on its own.

## Adding a new subproject

1. Create a new standalone folder (own `package.json`, `.env.example`).
2. Add it to the `folders` array in `developer-resources.code-workspace`.

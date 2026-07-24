/**
 * Dummy → real value substitution.
 *
 * Contract (see kickstart-verbatim-execution): the command SHAPE stays
 * exactly as documented — only placeholder/dummy VALUES are replaced with
 * real ones from the seeded stack. Content types (blog_post, article,
 * product_page) and the alias (production) were seeded under the doc's own
 * dummy names, so those need no substitution at all. Every replacement is
 * recorded so the report can show doc-command vs run-command.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SeedContext } from "../setup/seed.js";

export interface Substituted {
  cmd: string;
  substitutions: string[];
  /** Set when the command can't run on this platform (e.g. Windows paths). */
  skipReason?: string;
  /** Set when this command creates a NEW stack by name (cm:stacks:seed --org --stack-name) — teardown must look it up and delete it. */
  createdStackName?: string;
  /** Set when this command creates a NEW Developer Hub app by name (apps-cli-plugin's app:create examples) — teardown must look it up and delete it. */
  createdAppName?: string;
}

// export-content-to-csv-file's "--action  --org" bare example renders
// byte-identically for both its "export users" and "export teams" intents —
// alternates so a single doc run still exercises both real actions.
// Module-level, not per-run state: each doc run is its own fresh process.
let exportCsvOrgActionToggle = 0;
// A pre-existing, reusable team in the QA org (created by an earlier,
// unrelated test run) — org teams aren't stack-scoped, so there's no need
// to create a fresh one per run the way the taxonomy examples do.
const EXPORT_CSV_TEAM_UID = "6a4f9858c68198b9f73b5969";

// change-master-locale's two cm:stacks:migration examples each need their
// own independently-exported data directory (see migrationExportDirs)
// alternates between the two. Module-level, not per-run: each doc run is
// its own fresh process.
let migrationExportDirToggle = 0;

// apps-cli-plugin's flagged app:create examples each create a genuinely
// NEW, separate app (distinct from the one prepareAppsCli already made for
// the rest of the lifecycle) — each gets a unique, valid-length (3-20
// chars, verified by hand) name, tracked for teardown.
let appCreateCounter = 0;

// entry-migration's doc repeats the identical bare cm:stacks:migration
// --multiple command 3 times (Usage, Steps for execution, Example) — each
// gets its own uniquely-named stand-in content type so repeat invocations
// don't collide with a content type an earlier invocation already created
// (confirmed by hand: reusing one name made invocation 2+ genuinely fail
// with "migration unsuccessful" while still exiting 0).
let entryMigrationCounter = 0;

// taxonomy-migration's doc repeats an equivalent import command 4 times
// (Usage, two "Example" variants, "Steps for execution") against the SAME
// stack — reusing the base CSV's fixed taxonomy UIDs ("regions"/"clothes")
// verbatim in each would collide with whichever invocation created them
// first (confirmed by hand: "The taxonomy uid should be unique", while
// csdx still exits 0). Each invocation gets its own uid-suffixed copy.
let taxonomyMigrationCounter = 0;

// bootstrap-starter-apps' doc repeats both the "new stack" (--org + -n) and
// "existing stack" (-k) invocations across its Usage/Examples sections —
// each real "new stack" attempt needs its own unique name and project
// folder, or the second one collides with the first's already-created
// stack/already-cloned directory.
let bootstrapCounter = 0;

/** Mutable, threaded across every substitute() call in a single doc run. */
export interface LaunchCreationState {
  done: boolean;
  /** Set once the create command has been rewritten, so teardown knows what to delete. */
  pendingName?: string;
  /** Resolved once creation succeeds, for rollback deployment lookups. */
  projectUid?: string;
  environmentUid?: string;
  /** Resolved lazily, right before a flagged launch:rollback command runs. */
  rollbackDeploymentUid?: string;
}

export function substitute(
  docCmd: string,
  ctx: SeedContext,
  runDir: string,
  lastBackupDir?: string,
  launchCreated?: LaunchCreationState
): Substituted {
  let cmd = docCmd;
  const subs: string[] = [];
  const sub = (from: RegExp | string, to: string, note: string) => {
    const before = cmd;
    cmd = typeof from === "string" ? cmd.split(from).join(to) : cmd.replace(from, to);
    if (cmd !== before) subs.push(note);
  };

  // Windows-only examples can't run on macOS — skip, the macOS twin covers it.
  if (/[A-Z]:\\\\?Users/.test(docCmd)) {
    return { cmd, substitutions: [], skipReason: "Windows-only path — not executable on macOS" };
  }

  // A trailing bare "..." is the doc's own shorthand for "etc" (e.g. a
  // "test in dev, then staging, then production" best-practices snippet
  // showing 3 abbreviated variants of the same command) — not a real,
  // complete command. Running it literally passes "..." as a CLI argument,
  // which isn't a valid environment/flag value and hangs indefinitely.
  if (/\s\.\.\.\s*$/.test(docCmd.trim())) {
    return { cmd, substitutions: [], skipReason: "doc's own shorthand \"...\" (illustrative, abbreviated) — not a complete, runnable command" };
  }

  // OAuth/SSO login opens an interactive browser flow with no headless path.
  if (/auth:login\b.*--oauth\b|--oauth\b.*auth:login\b|^csdx\s+auth:login\s+--oauth\s*$/.test(docCmd)) {
    return { cmd, substitutions: [], skipReason: "OAuth/SSO login requires an interactive browser flow — not automatable headlessly" };
  }

  // A bare `csdx cm:stacks:clone` (no flags at all) drives an entirely
  // interactive walkthrough — choose organization, choose stack, choose
  // branch, choose new-vs-existing destination stack, choose structure vs
  // structure+content. Blindly answering "accept default" at each prompt
  // risks picking the wrong organization or an unintended stack; skip
  // rather than risk touching resources outside the QA org.
  if (/^csdx\s+cm:stacks:clone\s*$/.test(docCmd.trim())) {
    return {
      cmd,
      substitutions: [],
      skipReason: "bare cm:stacks:clone drives a fully interactive org/stack selection walkthrough — not safely automatable headlessly (risk of touching the wrong organization)",
    };
  }

  // Same risk, same precedent: `cm:stacks:seed` without either
  // -k/--stack-api-key (existing stack) or --org+--stack-name (new stack)
  // drives the identical fully-interactive organization/stack picker (this
  // account has 88 orgs — a blind default answer has already been proven,
  // in this project, to land on the wrong one). This covers the doc's bare
  // `csdx cm:stacks:seed` AND its "real-looking" --repo-only examples,
  // which are equally under-specified for headless use.
  if (/^csdx\s+cm:stacks:seed\b/.test(docCmd) && !/-k\b|--stack-api-key\b/.test(docCmd) && !(/-o\b|--org\b/.test(docCmd) && /-n\b|--stack-name\b/.test(docCmd))) {
    return {
      cmd,
      substitutions: [],
      skipReason: "cm:stacks:seed without -k (existing stack) or --org+--stack-name (new stack) drives the same fully-interactive organization/stack picker as bare cm:stacks:clone — not safely automatable headlessly",
    };
  }

  // import-content-using-the-seed-command's flagged examples show the same
  // rendering bug as export-content-to-csv — every value is stripped, but
  // here it left behind an EMPTY quoted string (""/“”, straight or smart
  // quotes) rather than nothing at all. Filling these in is what makes the
  // difference between "seed into our own real stack" (safe) and "create a
  // brand-new stack in the org" (also safe, but needs teardown tracking —
  // see the launchCreated-style pattern in executeDoc.ts for cm:stacks:seed).
  let seedCreatedStackName: string | undefined;
  if (/^csdx\s+cm:stacks:seed\b/.test(docCmd)) {
    const generatedStackName = `cli-automation-seeded-${Date.now()}`;
    const fillSeed: Record<string, string> = {
      repo: '"contentstack/stack-starter-app"',
      "stack-api-key": ctx.stackApiKey,
      org: process.env.CONTENTSTACK_ORG_ID ?? "",
      "stack-name": generatedStackName,
    };
    const seedFlagAliases: Record<string, string[]> = {
      repo: ["-r", "--repo"],
      "stack-api-key": ["-k", "--stack-api-key"],
      org: ["-o", "--org"],
      "stack-name": ["-n", "--stack-name"],
    };
    for (const [key, value] of Object.entries(fillSeed)) {
      for (const flag of seedFlagAliases[key]) {
        const before = cmd;
        // Empty quoted value: -x "" / -x “” (straight or smart quotes).
        sub(new RegExp(`${flag}\\s+["“][”"]`), `${flag} ${value}`, `${flag} "" (empty value in doc) → real value ${value}`);
        // No value at all before the next flag or end of line (e.g. this
        // doc's own "-k  -d ..." — -k has nothing, not even empty quotes).
        sub(new RegExp(`${flag}\\b(\\s\\s+|$)`), `${flag} ${value}$1`, `${flag} (missing value in doc) → real value ${value}`);
        if (key === "stack-name" && cmd !== before) seedCreatedStackName = generatedStackName;
      }
    }
  }

  // change-master-locale's two cm:stacks:migration examples reference the
  // real downloaded example script by its own actual relative path
  // ("./change-master-locale/02-...js"), which already resolves correctly
  // since the setup step downloads it to that exact path under runDir — no
  // --file-path substitution needed here, only the <target-locale> and
  // <path-to-the-exported-data>/<path-to-the-config-file> placeholders.
  if (/^csdx\s+cm:stacks:migration\b/.test(docCmd) && ctx.migrationExportDirs) {
    // Each example gets its own independently-exported directory — see
    // MigrationExamplesResult's comment for why reusing one across both
    // corrupts the second run (the script isn't idempotent).
    // The script reads "{data_dir}/locales/locales.json" directly, with no
    // branch nesting — but a branch-enabled stack's export nests everything
    // under "{data_dir}/{branch}/locales/..." (verified: ENOENT without
    // this). Point data_dir at the branch subfolder to match what the
    // script actually expects.
    const exportDir = path.join(ctx.migrationExportDirs[migrationExportDirToggle++ % 2], ctx.realBranch === "develop" ? "main" : ctx.realBranch);
    sub(/<target-locale>/g, "fr-fr", "<target-locale> (dummy) → real supported locale fr-fr");
    sub(/<path-to-the-exported-data>/g, exportDir, "<path-to-the-exported-data> (dummy) → real exported data directory (own copy, not shared with the doc's other example)");
    if (/--config-file\s+<path-to-the-config-file>/.test(cmd)) {
      const configPath = path.join(runDir, `change-master-locale-config-${migrationExportDirToggle}.json`);
      if (!existsSync(configPath)) {
        writeFileSync(configPath, JSON.stringify({ target_locale: "fr-fr", data_dir: exportDir }, null, 2));
      }
      sub(/<path-to-the-config-file>/, configPath, "<path-to-the-config-file> (dummy) → real config file with target_locale + data_dir");
    }
  }

  // create-custom-cli-plugins: two deliberately-not-run commands, per an
  // explicit decision (not something to silently work around) —
  // npm publish is a real, irreversible, public action on the npm
  // registry (would publish under the real @contentstack scope), and
  // plugins:reset would remove ALL globally-installed plugins on this
  // shared machine, including ones other docs in this project depend on
  // (apps-cli, cli-cm-export-query).
  // bootstrap-starter-apps' "npm start" launches a dev server that runs
  // indefinitely until manually killed — this harness's per-command model
  // waits for a process to exit, so this would just burn the full timeout
  // without revealing anything a plain "npm install" already wouldn't.
  if (/^npm\s+start\b/.test(docCmd.trim())) {
    return { cmd, substitutions: [], skipReason: "starts a long-running dev server with no natural exit — not safely automatable within this harness's per-command timeout model" };
  }
  if (/^npm\s+publish\b/.test(docCmd.trim())) {
    return { cmd, substitutions: [], skipReason: "deliberately not run — publishing a real, public npm package is an irreversible action outside this harness's safe scope" };
  }
  if (/^csdx\s+plugins:reset\b/.test(docCmd.trim())) {
    return { cmd, substitutions: [], skipReason: "deliberately not run — would remove ALL globally-installed plugins on this shared machine, including ones other docs in this project depend on" };
  }
  if (/^csdx\s+plugins:install\s+@contentstack\/myplugin\b/.test(docCmd.trim())) {
    return { cmd, substitutions: [], skipReason: "depends on this doc's own npm publish step, which was deliberately not run" };
  }

  if (/^csdx\s+config:set:region\b/.test(docCmd) || /^csdx\s+plugins:link\b/.test(docCmd) || /^csdx\s+plugins:uninstall\b/.test(docCmd)) {
    sub(/<region-name>/g, process.env.CONTENTSTACK_REGION ?? "AWS-NA", "<region-name> (dummy) → real region");
    sub(/<plugin-local-path>/g, path.join(runDir, "myplugin"), "<plugin-local-path> (dummy) → real path to this run's own scaffolded plugin");
    sub(/<plugin_name>/g, "myplugin", "<plugin_name> (dummy) → real plugin name used throughout this doc's own examples");
  }

  // bootstrap-starter-apps: bare `cm:bootstrap` and any invocation missing
  // BOTH --org and -k/--stack-api-key drives the same fully-interactive
  // org/stack picker already proven unsafe elsewhere in this project (a
  // prior blind-answer incident created real resources in the wrong org).
  // Confirmed by hand: without --org or -k, it prompts "Enter a stack
  // name" as required text input after an org-selection list — no safe
  // generic answer exists for either.
  if (/^csdx\s+cm:bootstrap\b/.test(docCmd) && !/--org\b/.test(docCmd) && !/-k\b|--stack-api-key\b/.test(docCmd)) {
    return {
      cmd,
      substitutions: [],
      skipReason: "cm:bootstrap without --org or -k/--stack-api-key drives the same fully-interactive organization/stack picker proven unsafe elsewhere in this project — not safely automatable headlessly",
    };
  }
  let bootstrapCreatedStackName: string | undefined;
  if (/^csdx\s+cm:bootstrap\b/.test(docCmd)) {
    const n = bootstrapCounter++;
    const projectDir = path.join(runDir, `bootstrap-app-${n}`);
    // "reactjs-starter" is the doc's OWN literal example value — verified
    // by hand that the real CLI accepts it and genuinely clones + imports
    // real content, even though it isn't one of the values --help's own
    // --app-name enum lists (kickstart-next/kickstart-nuxt variants) — a
    // real, confirmed doc/CLI mismatch worth reporting on its own, not
    // papered over by substituting a --help-listed name instead.
    sub(/<starter_app_name>/g, "reactjs-starter", "<starter_app_name> (dummy) → real, hand-verified app name");
    sub(/<<starter-app-name>>/g, "reactjs-starter", "<<starter-app-name>> (dummy) → real, hand-verified app name");
    sub(/<path_or_the_location_of_the_folder_to_clone_the_app>/g, projectDir, "<path_or_the_location_...> (dummy) → real local folder for this invocation");
    sub(/<The path or the location to clone the app>/g, projectDir, "<The path or the location to clone the app> (dummy) → real local folder for this invocation");
    if (/--org\b/.test(cmd)) {
      const stackName = `cli-automation-bootstrap-${n}`;
      sub(/<organization_uid>/g, process.env.CONTENTSTACK_ORG_ID ?? "", "<organization_uid> (dummy) → real org UID");
      sub(/"your-org-uid"/g, `"${process.env.CONTENTSTACK_ORG_ID ?? ""}"`, '"your-org-uid" (illustrative literal) → real org UID');
      sub(/<stack_name>/g, stackName, "<stack_name> (dummy) → real, unique stack name for this invocation");
      sub(/"stack-name"/g, `"${stackName}"`, '"stack-name" (illustrative literal) → real, unique stack name');
      bootstrapCreatedStackName = stackName;
    } else {
      sub(/<stack_api_key>/g, ctx.stackApiKey, "<stack_api_key> (dummy) → real stack API key");
    }
    // Verified by hand: even the existing-stack (-k) flow shows an
    // interactive stack-confirmation prompt without --yes.
    if (!/-y\b|--yes\b/.test(cmd)) {
      cmd += " -y";
      subs.push("-y (missing from this line, needed to avoid an interactive stack confirmation) → skip confirmation");
    }
  }

  // apps-cli-plugin: bare app:X commands (no flags at all) drive the same
  // fully-interactive organization/app/stack picker already proven unsafe
  // for cm:stacks:clone/cm:stacks:seed — skip them, matching precedent.
  if (/^csdx\s+app:(create|get|install|update|deploy|reinstall|uninstall|delete)\s*$/.test(docCmd.trim())) {
    return {
      cmd,
      substitutions: [],
      skipReason: "bare app:X drives the same fully-interactive organization/app/stack picker as bare cm:stacks:clone — not safely automatable headlessly",
    };
  }

  // app:uninstall with --app-uid/--org but NEITHER --installation-uid NOR
  // --uninstall-all: confirmed by hand (two separate 10-minute hangs in a
  // real run) that this drives the same interactive stack/installation
  // picker as --uninstall-all's own help text implies ("Please select
  // stacks from where the app must be uninstalled") — csdx's own --help
  // shows this exact flag combination as a documented example, but it's
  // not headlessly automatable, matching the established precedent of not
  // blindly answering org/stack pickers (a prior blind-answer incident
  // created real resources in the wrong org).
  if (/^csdx\s+app:uninstall\b/.test(docCmd) && !/--installation-uid\b/.test(docCmd) && !/--uninstall-all\b/.test(docCmd)) {
    return {
      cmd,
      substitutions: [],
      skipReason: "app:uninstall without --installation-uid or --uninstall-all drives an interactive stack/installation picker (confirmed: hung 10+ minutes) — not safely automatable headlessly",
    };
  }

  let createdAppName: string | undefined;
  if (/^csdx\s+app:create\b/.test(docCmd) && ctx.appUid) {
    // Every flagged app:create example (the "Alternatively" line plus both
    // Examples) creates a genuinely NEW, separate app — none of them show
    // --boilerplate, but it's required to avoid an interactive picker
    // (verified by hand), so it's added here even though the doc's own
    // line doesn't show it — same spirit as filling a missing value.
    const generatedAppName = `cli-auto-${(appCreateCounter++).toString(36)}${Date.now().toString(36).slice(-4)}`;
    sub(/<app_name>/g, generatedAppName, "<app_name> (dummy) → real, valid-length (3-20 char) app name");
    sub(/\bApp-1\b/, generatedAppName, "App-1 (doc's own example name) → real app name");
    sub(/\bApp-3\b/, generatedAppName, "App-3 (doc's own example name) → real app name");
    sub(/<organization uid>/g, process.env.CONTENTSTACK_ORG_ID ?? "", "<organization uid> (dummy) → real org UID");
    sub(/<UID>/g, process.env.CONTENTSTACK_ORG_ID ?? "", "<UID> (dummy) → real org UID");
    if (!/--org\b/.test(cmd)) {
      cmd += ` --org ${process.env.CONTENTSTACK_ORG_ID ?? ""}`;
      subs.push("--org (missing from this line, needed to avoid an interactive org picker) → real org UID");
    }
    if (!/--boilerplate\b/.test(cmd)) {
      cmd += ` --boilerplate "App Boilerplate"`;
      subs.push('--boilerplate (not shown in the doc\'s example, but required to avoid an interactive picker) → "App Boilerplate"');
    }
    // "-c ./external-config.json" (Example 2) — materialize a minimal, real
    // (if underspecified) config file so the referenced path actually exists.
    const cfgMatch = cmd.match(/-c\s+"?(\.\/[\w./-]+\.json)"?/);
    if (cfgMatch) {
      const cfgPath = path.join(runDir, path.basename(cfgMatch[1]));
      // --app-type organization app:create rejects a genuinely empty
      // config with a ui_location.base_url error; this is a best-effort
      // attempt to supply the field the API complains about. Verified by
      // hand that it does NOT actually fix it — the same error persists
      // regardless of what's in this -c file, meaning base_url isn't
      // sourced from here at all (it's a genuine, unexplained doc/platform
      // gap, not something fillable from the command line as documented).
      const minimalConfig = /--app-type\s+organization\b/.test(cmd) ? { ui_location: { base_url: "https://localhost:3000" } } : {};
      if (!existsSync(cfgPath)) writeFileSync(cfgPath, JSON.stringify(minimalConfig, null, 2));
      sub(cfgMatch[1], cfgPath, `${cfgMatch[1]} (doc's example path, never materialized) → real (minimal) config file`);
    }
    createdAppName = generatedAppName;
  }

  if (/^csdx\s+app:(get|install|update|deploy|reinstall|uninstall|delete)\b/.test(docCmd) && ctx.appUid) {
    sub(/<organization uid>|<UID>|<org_uid>/g, process.env.CONTENTSTACK_ORG_ID ?? "", "org placeholder (dummy) → real org UID");
    sub(/<app_uid>|<APP-UID-1>/g, ctx.appUid, "app UID placeholder (dummy) → real app UID from this run's own created app");
    if (ctx.appInstallationUid) {
      sub(/<INSTALLATION-UID-1>/g, ctx.appInstallationUid, "<INSTALLATION-UID-1> (dummy) → real installation UID resolved after this run's own app:install");
    }
    sub(/<https:\/\/localhost:3000>/g, "https://localhost:3000", "<https://localhost:3000> (bracket-wrapped literal) → literal URL");
    sub(/<custom-hosting>/g, "custom-hosting", "<custom-hosting> (bracket-wrapped literal) → literal value");
    sub(/<hosting-with-launch>/g, "hosting-with-launch", "<hosting-with-launch> (bracket-wrapped literal) → literal value");
    sub(/<existing>/g, "existing", "<existing> (bracket-wrapped literal) → literal value");
    sub(/<new>/g, "new", "<new> (bracket-wrapped literal) → literal value");
    const manifestPath = path.join(runDir, ctx.appName ?? "", "manifest.json");
    if (/^csdx\s+app:update\b/.test(docCmd)) {
      sub(/<file_path>/g, manifestPath, "<file_path> (dummy) → real manifest.json this run's own app:create wrote locally");
    }
    // app:get/app:update/app:delete's own "Examples" sections use a GENERIC
    // <value> placeholder (not <app_uid>/<organization uid>/<file_path>) —
    // it repeats per-flag on the same line, so it has to be resolved by
    // looking at which flag precedes each occurrence, not filled blindly.
    sub(/--org\s+<value>/g, `--org ${process.env.CONTENTSTACK_ORG_ID ?? ""}`, "--org <value> (generic placeholder) → real org UID");
    sub(/--app-uid\s+<value>/g, `--app-uid ${ctx.appUid}`, "--app-uid <value> (generic placeholder) → real app UID");
    sub(/--app-manifest\s+<value>/g, `--app-manifest ${manifestPath}`, "--app-manifest <value> (generic placeholder) → real manifest.json path");
    // "csdx app:install --stack-api-key" (no value at all, not even a
    // trailing space) needs its own fill BEFORE --org/--app-uid get
    // appended below — otherwise "--stack-api-key" is no longer at the end
    // of the string by the time this runs, and end-of-string anchoring
    // fails to match it (confirmed by hand: the flag was left unfilled and
    // the CLI errored "Flag --stack-api-key expects a value").
    if (/^csdx\s+app:(install|reinstall)\b/.test(docCmd)) {
      sub(/-k\s+>/, `-k ${ctx.stackApiKey}`, "-k > (stripped placeholder value in doc) → real stack API key");
      sub(/--stack-api-key\s*$/, `--stack-api-key ${ctx.stackApiKey}`, "--stack-api-key (no value at all in doc) → real stack API key");
    }
    // --org is always required (avoids the org picker); --app-uid and -k
    // are required for the subcommands that need them but whose doc line
    // may omit them ("Alternatively, ... csdx app:install --stack-api-key"
    // shows ONLY the new flag, assuming --org/--app-uid carry over from
    // context earlier in the same doc section — they don't, in a single
    // isolated command invocation, so they're added here too).
    if (!/--org\b/.test(cmd)) {
      cmd += ` --org ${process.env.CONTENTSTACK_ORG_ID ?? ""}`;
      subs.push("--org (missing from this line, needed to avoid an interactive org picker) → real org UID");
    }
    if (!/--app-uid\b/.test(cmd) && !/^csdx\s+app:update\b/.test(docCmd)) {
      cmd += ` --app-uid ${ctx.appUid}`;
      subs.push("--app-uid (missing from this line) → real app UID");
    }
    if (/^csdx\s+app:(install|reinstall)\b/.test(docCmd)) {
      if (!/-k\b|--stack-api-key\s+\S/.test(cmd)) {
        cmd += ` -k ${ctx.stackApiKey}`;
        subs.push("-k (missing from this line, needed to avoid an interactive stack picker) → real stack API key");
      }
    }
  }

  // migrate-your-content-using-the-cli-migration-command's flagged examples
  // have the same stripped-value bug — materialize the doc's own valid
  // "createContentType" migration script sample (copied verbatim from the
  // doc's "Create Migration File" section, not fixed or altered) so
  // --file-path points at something real, then run it against this run's
  // own real stack.
  // entry-migration doc's own command always uses --multiple (a FOLDER of
  // per-content-type merge scripts, normally only ever produced by a real
  // cm:branches:merge run) — handle this before the generic single-file
  // --file-path block below, which would otherwise hand --multiple a
  // single .js file instead of a directory and produce a misleading
  // failure instead of the real, reportable one.
  if (/^csdx\s+cm:stacks:migration\b/.test(docCmd) && /--multiple\b/.test(docCmd)) {
    // This QA org's plan doesn't support Branches at all (confirmed for
    // real via the compare-and-merge-branches doc's own run: every
    // cm:branches:merge/:diff attempt fails with "Branches are not part
    // of your plan.") — so a genuine branches:merge-generated
    // merge_scripts folder can never exist here. This materializes the
    // most real substitute available (the same verbatim, working
    // migration script reused elsewhere in this project, placed in a
    // folder shaped like the doc's own naming convention) so the actual
    // cm:stacks:migration --multiple mechanics still get exercised for
    // real — but the resulting pass/fail reflects real command behavior
    // against a stand-in script, not a genuine end-to-end merge flow.
    const contentTypeName = `cli_automation_migrated_blog_${entryMigrationCounter++}`;
    const scriptsDir = path.join(runDir, "merge_scripts", `merge_scripts_cli_automation_stand-in_${entryMigrationCounter}`);
    const standInScriptPath = path.join(scriptsDir, "01-cli_automation_migrated_blog.js");
    if (!existsSync(standInScriptPath)) {
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(
        standInScriptPath,
        `module.exports = async ({ migration, stackSDKInstance }) => {
  const blog = migration
    .createContentType("${contentTypeName}")
    .title("Blog ${entryMigrationCounter}")
    .description('The is Blog content type')
    .isPage(true)
    .singleton(false);
  blog
    .createField("title")
    .display_name("Title")
    .data_type("text")
    .mandatory(true);
  blog
    .createField("url")
    .display_name("URL")
    .data_type("text")
    .mandatory(true);

  migration.addTask(blog.getTaskDefinition());
};
`
      );
    }
    sub(/--file-path\s+<value>/, `--file-path ${scriptsDir}`, "--file-path <value> (generic placeholder — real value would only exist after a real branches:merge, unsupported on this plan) → stand-in merge_scripts folder with a real, working migration script");
    sub(/--file-path\s+"?\.\/merge_scripts\/[\w.-]+"?/, `--file-path ${scriptsDir}`, "--file-path ./merge_scripts/merge_scripts_bf7xxx-... (doc's illustrative example path, never real) → stand-in merge_scripts folder with a real, working migration script");
    sub(/compare-branch:<value>/, "compare-branch:main", "compare-branch:<value> (generic placeholder) → compare-branch:main (the only branch this plan supports)");
    sub(/compare-branch:develop\b/, "compare-branch:main", "compare-branch:develop (doc's illustrative example — this plan has no develop branch) → compare-branch:main");
    sub(/--branch\s+<value>/, "--branch main", "--branch <value> (generic placeholder) → --branch main (the only real branch on this plan)");
    sub(/--stack-api-key\s+<value>/, `--stack-api-key ${ctx.stackApiKey}`, "--stack-api-key <value> (generic placeholder) → real stack API key");
    sub(/--stack-api-key\s+bltxxxxxxxxxxxe\b/, `--stack-api-key ${ctx.stackApiKey}`, "--stack-api-key bltxxxxxxxxxxxe (doc's masked illustrative key) → real stack API key");
  }

  // taxonomy-migration's own command uses --config data-dir:... (or
  // {data-dir:...,delimiter:...}) — a signature distinct from every other
  // cm:stacks:migration doc, so it's excluded from the generic single-file
  // block below (which would otherwise hand it the wrong stand-in script
  // and never touch --config at all).
  if (/^csdx\s+cm:stacks:migration\b/.test(docCmd) && /data-dir:/.test(docCmd) && ctx.taxonomyMigrationScriptPath) {
    const scriptPath = ctx.taxonomyMigrationScriptPath;
    // Each invocation gets its own uid-suffixed copy of the real CSV data
    // (base content unchanged, only the two taxonomy uids renamed) so
    // repeat invocations against the same stack don't collide with an
    // earlier one's already-created taxonomies.
    const n = taxonomyMigrationCounter++;
    const baseCsv = readFileSync(ctx.taxonomyMigrationCsvPath!, "utf8").replace(/^Regions,regions,/m, `Regions,regions_${n},`).replace(/^clothes,clothes,/m, `clothes,clothes_${n},`);
    const csvPath = path.join(runDir, `test_taxonomies_${n}.csv`);
    const csvPipePath = path.join(runDir, `test_taxonomies_pipe_${n}.csv`);
    writeFileSync(csvPath, baseCsv);
    writeFileSync(csvPipePath, baseCsv.replace(/,/g, "|"));
    sub(/--file-path\s+<value>/, `--file-path ${scriptPath}`, "--file-path <value> (generic placeholder) → real downloaded sample script");
    sub(/--file-path\s+"\.\.\/contentstack-migration\/examples\/taxonomies\/import-taxonomies\.js"/, `--file-path ${scriptPath}`, '--file-path "../contentstack-migration/..." (doc\'s illustrative relative path, never real here) → real downloaded sample script');
    // Config forms: bare `data-dir:<value>` (no delimiter) uses the comma
    // CSV as downloaded; `{data-dir:<value>,delimiter:<value>}` and the
    // doc's own "with delimiter" example (delimiter:'|') both get the
    // derived pipe-delimited copy — same real data, delimiter recoded —
    // since no separate official pipe-delimited template is published.
    // The combined `{data-dir:...,delimiter:...}` forms MUST be substituted
    // before the plain `data-dir:'...'` rules below — both patterns share
    // the same data-dir literal as a substring, so the plain rule firing
    // first would silently consume it, leaving the combined form with the
    // WRONG (comma) CSV paired with delimiter:'|' — verified by hand: that
    // makes fast-csv fail to parse any real column and the migration task
    // silently does nothing while still reporting success.
    sub(/\{data-dir:<value>,delimiter:<value>\}/, `{data-dir:${csvPipePath},delimiter:'|'}`, "{data-dir:<value>,delimiter:<value>} (generic placeholder) → real CSV (pipe-delimited copy) + matching delimiter");
    sub(/\{data-dir:'\.\/data\/Taxonomy Stack_taxonomies\.csv',delimiter:'\|'\}/, `{data-dir:${csvPipePath},delimiter:'|'}`, "doc's illustrative delimiter example path → real CSV (pipe-delimited copy)");
    sub(/data-dir:<value>(?!.*delimiter)/, `data-dir:${csvPath}`, "data-dir:<value> (generic placeholder, no delimiter) → real downloaded CSV");
    sub(/data-dir:'\.\/data\/Taxonomy Stack_taxonomies\.csv'(?!,delimiter)/, `data-dir:${csvPath}`, "data-dir:'./data/Taxonomy Stack_taxonomies.csv' (doc's illustrative path, never real here) → real downloaded CSV");
    sub(/-k\s+<value>|--stack-api-key\s+<value>/, `-k ${ctx.stackApiKey}`, "stack-api-key <value> (generic placeholder) → real stack API key");
    sub(/-k\s+b\*+9ca0\b/, `-k ${ctx.stackApiKey}`, "-k b*******9ca0 (doc's masked illustrative key) → real stack API key");
  }

  // update-missing-reference-uids' own command points at the doc's linked
  // 05-Update-reference-entry-from-mapper.js script + a real config.json —
  // a distinct signature from every other cm:stacks:migration doc, so
  // it's excluded from the generic single-file block below.
  if (/^csdx\s+cm:stacks:migration\b/.test(docCmd) && /05-Update-reference-entry-from-mapper/.test(docCmd) && ctx.referenceFixScriptPath) {
    sub(/\.\/05-Update-reference-entry-from-mapper\.js/, ctx.referenceFixScriptPath, "./05-Update-reference-entry-from-mapper.js (doc's relative path, never real here) → real downloaded fixup script");
    sub(/\.\/config\.json/, ctx.referenceFixConfigPath!, "./config.json (doc's relative path, never real here) → real config.json pointing at a genuine import backup/mapper dir");
    sub(/<stack_ApiKey>/, ctx.stackApiKey, "<stack_ApiKey> (dummy) → real stack API key");
  }

  // migrate-content-between-stacks-using-the-cli: unlike needsSourceExport
  // docs, ctx.stackApiKey stays the ORIGINAL/source stack here — the
  // separate ctx.migrateTargetStackApiKey is the real empty destination.
  // Must run before the unconditional <source_stack_api_key> → ctx.stackApiKey
  // rule further down (used by other docs where "source" just means "the
  // current stack") so it doesn't wrongly consume this doc's placeholder first.
  if (/^csdx\s+cm:stacks:(export|audit|import)\b/.test(docCmd) && ctx.migrateTargetStackApiKey) {
    sub(/<source_stack_api_key>/, ctx.sourceStackApiKeyForMigration ?? ctx.stackApiKey, "<source_stack_api_key> (dummy) → real source stack API key");
    sub(/<target_stack_api_key>/, ctx.migrateTargetStackApiKey, "<target_stack_api_key> (dummy) → real destination stack API key");
  }

  // migrate-selected-content-types-using-the-query-export-plugin: every -k
  // in this doc is left completely BLANK ("-k  -d", two spaces, no
  // placeholder text at all) — export-query commands target the seeded
  // (source) stack, import/import-setup commands target the reused empty
  // destination stack from ctx.migrateTargetStackApiKey.
  if (/^csdx\s+cm:stacks:export-query\b/.test(docCmd) && ctx.migrateTargetStackApiKey) {
    sub(/-k\s\s+/, `-k ${ctx.stackApiKey} `, "-k (blank in doc) → real source stack API key");
    // The doc's own illustrative query criteria ("Blog"/"Author" titles,
    // "blog"/"author" uids) don't match this run's seeded content types —
    // substituted with two of this run's own real seeded content types,
    // same spirit as filling any other missing/dummy value.
    sub('"title":{"$in":["Blog","Author"]}', '"title":{"$in":["Blog Post","Article"]}', "query title criteria (dummy) → this run's real seeded content type titles");
    sub('"uid":{"$in":["blog","author"]}', '"uid":{"$in":["blog_post","article"]}', "query uid criteria (dummy) → this run's real seeded content type uids");
    sub('"title":{"$in":["Blog"]}', '"title":{"$in":["Blog Post"]}', "query title criteria (dummy) → this run's real seeded content type title");
    if (/--query\s+\.\/my-query\.json/.test(cmd)) {
      const queryFilePath = path.join(runDir, "my-query.json");
      if (!existsSync(queryFilePath)) {
        writeFileSync(
          queryFilePath,
          JSON.stringify({ modules: { "content-types": { $and: [{ uid: { $in: ["blog_post", "article"] } }] } } }, null, 2)
        );
      }
      sub("./my-query.json", queryFilePath, "./my-query.json (doc's example path, never materialized) → real query file with this run's own real content type uids");
    }
  }
  if (/^csdx\s+cm:stacks:(import|import-setup)\b/.test(docCmd) && /-k\s\s+/.test(docCmd) && ctx.migrateTargetStackApiKey) {
    sub(/-k\s\s+/, `-k ${ctx.migrateTargetStackApiKey} `, "-k (blank in doc) → real destination stack API key");
  }
  if (/^csdx\s+cm:stacks:import\b/.test(docCmd) && /\.\/_backup_456\b/.test(docCmd)) {
    if (lastBackupDir) {
      sub(/\.\/_backup_456\b/, lastBackupDir, "./_backup_456 (doc's illustrative example path) → real backup dir from this run's own import-setup");
    }
  }
  // migrate-and-overwrite-content-in-the-same-stack: Step 3's own command
  // uses "./backup_123" (no underscore) — a genuine inconsistency with
  // Step 2's own illustrative output, which shows "./_backup_123" (with
  // underscore). Matched separately from the other doc's "_backup_456"
  // pattern since the literal text differs.
  if (/^csdx\s+cm:stacks:import\b/.test(docCmd) && /\.\/backup_123\b/.test(docCmd)) {
    if (lastBackupDir) {
      sub(/\.\/backup_123\b/, lastBackupDir, "./backup_123 (doc's illustrative example path) → real backup dir from this run's own import-setup");
    }
  }

  if (
    /^csdx\s+cm:stacks:migration\b/.test(docCmd) &&
    /--file-path\b/.test(docCmd) &&
    !/--multiple\b/.test(docCmd) &&
    !/data-dir:/.test(docCmd) &&
    !/05-Update-reference-entry-from-mapper/.test(docCmd)
  ) {
    const scriptPath = path.join(runDir, "migration-script.js");
    if (!existsSync(scriptPath)) {
      writeFileSync(
        scriptPath,
        `module.exports = async ({ migration, stackSDKInstance }) => {
  const blog = migration
    .createContentType("cli_automation_migrated_blog")
    .title("Blog")
    .description('The is Blog content type')
    .isPage(true)
    .singleton(false);
  blog
    .createField("title")
    .display_name("Title")
    .data_type("text")
    .mandatory(true);
  blog
    .createField("url")
    .display_name("URL")
    .data_type("text")
    .mandatory(true);

  migration.addTask(blog.getTaskDefinition());
};
`
      );
    }
    const fillMigration: Record<string, string> = {
      "file-path": scriptPath,
      "stack-api-key": ctx.stackApiKey,
      alias: ctx.alias,
    };
    const migrationFlagAliases: Record<string, string[]> = {
      "file-path": ["--file-path"],
      "stack-api-key": ["-k", "--stack-api-key"],
      alias: ["-a", "--alias"],
    };
    for (const [key, value] of Object.entries(fillMigration)) {
      for (const flag of migrationFlagAliases[key]) {
        // Missing entirely (double space before the next flag or end of line).
        sub(new RegExp(`${flag}\\b(\\s\\s+|$)`), `${flag} ${value}$1`, `${flag} (missing value in doc) → real value ${value}`);
      }
    }
    // The doc's own "Usage" section (as of a 2026-07-20 content update)
    // uses bracketed <file_path> — the generic "missing entirely" fill
    // above only matches a flag with NO value at all, not one already
    // followed by a placeholder.
    sub(/<file_path>/g, scriptPath, "<file_path> (dummy) → real migration script");
    // The doc's "Example" section has real-shaped but illustrative values:
    // a quoted "path/to/..." placeholder for --file-path, and a masked
    // "bxxxxxxx" stack key — fill both with this run's own real values.
    sub(/--file-path\s+["“][^"”]*["”]/, `--file-path ${scriptPath}`, '--file-path "path/to/..." (illustrative placeholder) → real script path');
    sub(/-k\s+bxxxxxxx\b/, `-k ${ctx.stackApiKey}`, "-k bxxxxxxx (masked placeholder) → real stack API key");
    sub(/my_token_alias\b/, ctx.alias, "my_token_alias (illustrative placeholder) → this run's real registered alias");
  }

  // migrate-content-from-html-rte-to-json-rte's own example uses --config
  // to add a management token that's real by name but has no actual secret
  // value — fill with this run's own real management token so the token
  // actually gets added, not rejected.
  if (/^csdx\s+auth:tokens:add\b.*--management/.test(docCmd)) {
    sub(/-a\s+>/, `-a cli-automation-mgmt-token`, "-a > (stripped placeholder value in doc) → real alias name");
    sub(/-k\s+>/, `-k ${ctx.stackApiKey}`, "-k > (stripped placeholder value in doc) → real stack API key");
    sub(/--token\s+>/, `--token ${ctx.managementToken}`, "--token > (stripped placeholder value in doc) → real management token");
  }

  // tsgen-plugin's bare `auth:tokens:add --delivery` (no other flags at all)
  // needs the same real-flag completion as the RTE doc's --management
  // example above, using this run's own real delivery token — and every one
  // of its 9 "tsgen" Examples reuses the SAME registered alias by the
  // doc's own illustrative name "delivery token alias" (a literal string,
  // not a placeholder token, but clearly not meant to exist for real).
  if (/^csdx\s+auth:tokens:add\s+--delivery\s*$/.test(docCmd.trim())) {
    sub(
      /--delivery\s*$/,
      `--delivery -a cli-automation-delivery-alias -k ${ctx.stackApiKey} -e production --token ${ctx.deliveryToken}`,
      "bare --delivery (missing all other flags in doc) → real alias/stack-key/environment/token"
    );
  }
  if (/^csdx\s+tsgen\b/.test(docCmd)) {
    sub(/"delivery token alias"/g, "cli-automation-delivery-alias", '"delivery token alias" (illustrative placeholder) → real registered alias');
    sub(/"contentstack\/generated\.d\.ts"/g, path.join(runDir, "generated.d.ts"), '"contentstack/generated.d.ts" (illustrative placeholder) → real local output path');
    sub(/"develop"/g, `"${ctx.realBranch === "develop" ? "main" : ctx.realBranch}"`, '"develop" (dummy branch) → real branch');
  }

  // migrate-content-from-html-rte-to-json-rte's flagged migrate-html-rte
  // examples are missing values the same way — fill with the content type
  // + field UIDs the needsRteFields setup step created for real.
  if (/^csdx\s+cm:entries:migrate-html-rte\b/.test(docCmd) && /--\w[\w-]*\s\s+(--|-)/.test(docCmd)) {
    const fillRte: Record<string, string> = {
      alias: ctx.alias,
      "content-type": "rte_migration_demo",
      "html-path": "rich_text_editor",
      "json-path": "json_rte",
    };
    const rteFlagAliases: Record<string, string[]> = {
      alias: ["-a", "--alias"],
      "content-type": ["--content-type"],
      "html-path": ["--html-path"],
      "json-path": ["--json-path"],
    };
    for (const [key, value] of Object.entries(fillRte)) {
      for (const flag of rteFlagAliases[key]) {
        sub(new RegExp(`${flag}\\b(\\s\\s+|$)`), `${flag} ${value}$1`, `${flag} (missing value in doc) → real value ${value}`);
      }
    }
    // "-y(optional)" is a prose annotation the doc mixed directly into the
    // command with no quoting — bash reads the unquoted "(" as the start of
    // a subshell and errors ("syntax error near unexpected token `('").
    // "(optional)" is documentation about the flag, not part of its syntax;
    // stripping it to plain "-y" is what the doc actually means.
    sub(/-y\(optional\)/, "-y", "-y(optional) (prose mixed into command syntax, invalid unquoted in bash) → -y");
  }

  // Same doc's config-file example mismatches quote styles (opening “,
  // closing ") — bash can't find a matching close quote at all — and even
  // fixed, the path itself ("/home/admin/Desktop/config.json") is a
  // Linux-specific illustration that doesn't exist on this machine.
  // Materialize a real, valid config file (fixing the doc's own JSON syntax
  // error — a missing comma after "branch": "stage" — using this run's real
  // alias/content-type/field/locale/branch) at a real local path instead.
  if (/^csdx\s+cm:entries:migrate-html-rte\b.*-c\s+["“]/.test(docCmd)) {
    const configPath = path.join(runDir, "rte-migration-config.json");
    if (!existsSync(configPath)) {
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            alias: ctx.alias,
            "content-type": "rte_migration_demo",
            "global-field": false,
            paths: [{ from: "rich_text_editor", to: "json_rte" }],
            delay: 1000,
            locale: ["en-us"],
            "batch-limit": 50,
            branch: ctx.realBranch === "develop" ? "main" : ctx.realBranch,
          },
          null,
          2
        )
      );
    }
    sub(/-c\s+["“][^"”]*["”]?/, `-c ${configPath}`, "-c \"/home/admin/...\" (mismatched quotes, Linux-specific path) → real local config file");
  }

  // Same doc's "Upload Stack's Content on GitHub" section shows a plain
  // `cm:stacks:export` with the identical stripped-value bug ("-k  -d
  // “”" — -k has nothing at all, -d has an empty smart-quoted string).
  if (/^csdx\s+cm:stacks:export\b/.test(docCmd) && /-k\s\s+-d/.test(docCmd)) {
    sub(/-k\s\s+/, `-k ${ctx.stackApiKey} `, "-k (missing value in doc) → real stack API key");
    sub(/-d\s+["“][”"]/, `-d ${path.join(runDir, "export")}`, '-d "" (empty value in doc) → real export directory');
  }

  // export-content-to-csv-file's entire Examples section renders every
  // flag with its value stripped (a doc rendering bug — "--action  --locale
  // " with nothing between flags, not a `<placeholder>` token substitute()
  // would otherwise catch). Per the verbatim contract, supplying the real
  // value each flag is asking for still counts as substitution, not
  // self-healing the doc — the flag names and shape are untouched. Which
  // --action a given bare example needs isn't recoverable from the command
  // text alone in every case (two examples render byte-identically as
  // "--action  --org" despite one meaning users, one meaning teams in the
  // doc's prose) — exportCsvOrgActionToggle alternates between them so both
  // real actions still get exercised across the run.
  if (/^csdx\s+cm:export-to-csv\b/.test(docCmd) && /--\w[\w-]*\s\s+(--|$)/.test(docCmd)) {
    const has = (flag: string) => new RegExp(`--${flag}\\b`).test(cmd);
    let action: string;
    if (has("team-uid")) action = "teams";
    else if (has("taxonomy-uid") || has("include-fallback") || has("fallback-locale")) action = "taxonomies";
    else if (has("content-type") || has("branch")) action = "entries";
    else if (has("org-name")) action = "users";
    else if (has("org")) action = exportCsvOrgActionToggle++ % 2 === 0 ? "users" : "teams";
    else action = "taxonomies"; // bare "--action  --alias" / "--action  --alias  --delimiter" examples
    const fill: Record<string, string> = {
      action,
      locale: "en-us",
      alias: ctx.alias,
      "content-type": ctx.contentTypes[0],
      "stack-name": ctx.stackName,
      branch: ctx.realBranch === "develop" ? "main" : ctx.realBranch,
      org: process.env.CONTENTSTACK_ORG_ID ?? "",
      // Quoted: bash would otherwise split "Contentstack QA" into two
      // arguments at the space (the CLI then sees a stray "QA" and errors
      // "Unexpected argument: QA").
      "org-name": `"Contentstack QA"`,
      "team-uid": EXPORT_CSV_TEAM_UID,
      "taxonomy-uid": ctx.taxonomyUid ?? "",
      // Quoted: a bare ";" is a shell command separator, not a literal
      // character — unquoted, bash ends the csdx command right there and
      // the CLI never even sees a --delimiter value ("expects a value" error).
      delimiter: `";"`,
      "fallback-locale": "en-us",
    };
    for (const [flag, value] of Object.entries(fill)) {
      // Two shapes: "--flag  --nextflag" (double space before the next flag)
      // and a trailing "--flag" with nothing after it at all (end of line).
      sub(new RegExp(`--${flag}\\b(\\s\\s+|$)`), `--${flag} ${value}$1`, `--${flag} (missing value in doc) → real value ${value}`);
    }
    // Verified by hand: taxonomy export gets a real "Access denied" via a
    // management token alias — it only works over session auth
    // (--stack-api-key + --org, no alias at all). The doc's own examples
    // all show `--alias`, which is a genuine, previously-undocumented
    // limitation (this doc never mentions it, unlike cli-for-cs-assets'
    // explicit "Management Token Behavior" section) — swapping the auth
    // flags here is a bigger change than filling one value, but the
    // alternative is reporting the same "Access denied" for all 6 taxonomy
    // examples, which is no longer a substitution problem, just a known fact.
    if (action === "taxonomies") {
      sub(/--alias\s+\S+/, `--stack-api-key ${ctx.stackApiKey} --org ${process.env.CONTENTSTACK_ORG_ID ?? ""}`, "--alias (doc's shown auth) → --stack-api-key + --org (session auth — taxonomy export gets a real \"Access denied\" via management token)");
    }
  }

  // cli-for-launch: project CREATION now runs for real. Earlier minimal
  // test sites (single HTML file, or +trivial package.json) reproducibly
  // failed server-side with launch.PROJECTS.UPLOADED_FILE_NOT_FOUND_ERROR
  // across 9 attempts — a genuine buildable project (the fixtures/
  // vue-starter-app/ Vue app) succeeds instead. The doc's own later
  // flag-complete example (`csdx launch -n ... --type ... -y ...`) shows
  // every flag needed to make the identical bare command non-interactive;
  // per the verbatim-execution contract, supplying required inputs counts
  // as performing the step. The FIRST bare `csdx launch` gets rewritten
  // into that fully-flagged form; LATER bare occurrences (in the
  // "Redeploy" section) are left as-is — by then a real cs-launch.json
  // exists in runDir, so the doc's own documented behavior ("if the config
  // file is present, redeploy") kicks in naturally, verbatim.
  if (launchCreated?.done && /^csdx\s+launch\s*$/.test(docCmd.trim())) {
    // No rewrite needed — cs-launch.json now exists in runDir (written by
    // the earlier create command, which ran with cwd: runDir); this bare
    // invocation genuinely redeploys, exactly as the doc's "Redeploy"
    // section describes. Falls through to the generic launch: substitutions
    // below (harmless no-ops here) and executes as-is.
  } else if (launchCreated && !launchCreated.done && /^csdx\s+launch\s*$/.test(docCmd.trim())) {
    const uniqueName = `cli-automation-launch-${Date.now().toString(36)}`;
    // Copy the fixture into this run's own directory rather than pointing
    // --data-dir at the shared fixtures/ folder — the CLI writes
    // cs-launch.json somewhere tied to this invocation, and per-run
    // isolation avoids any cross-run collision.
    const projectDir = path.join(runDir, "vue-starter-app");
    if (!existsSync(projectDir)) {
      cpSync(path.resolve("fixtures", "vue-starter-app"), projectDir, { recursive: true });
      // Defensive: a stray .cs-launch.json in the fixture (e.g. left over
      // from manually testing against a project that's since been deleted)
      // would make the CLI think this is a redeploy of a dead project
      // instead of a fresh create. Confirmed cause of one real failure —
      // strip it unconditionally on every copy.
      const staleConfig = path.join(projectDir, ".cs-launch.json");
      if (existsSync(staleConfig)) rmSync(staleConfig);
    }
    cmd = [
      "csdx launch --type FileUpload",
      `--data-dir ${projectDir}`,
      `--name ${uniqueName}`,
      "--environment production",
      "--framework VueJs",
      '--build-command "npm run build"',
      '--server-command "npm run serve"',
      "--response-mode buffered",
      `--org ${process.env.CONTENTSTACK_ORG_ID}`,
      '--variable-type "Skip adding environment variables"',
    ].join(" ");
    launchCreated.pendingName = uniqueName;
    return {
      cmd,
      substitutions: [
        "bare `csdx launch` → fully-flagged FileUpload creation (doc's own later example shows every flag; a real buildable project — fixtures/vue-starter-app — is required, a minimal single-file site reproducibly fails server-side)",
        `--name ${uniqueName} (this run's disposable project, deleted at teardown via the Launch API — no CLI delete command exists)`,
      ],
    };
  }
  if (/csdx\s+launch\s+--config\b/.test(docCmd) && !/--redeploy/.test(docCmd)) {
    return {
      cmd,
      substitutions: [],
      skipReason: "creates a project via a --config file the doc never shows the contents of for the create flow (only for CI redeploy) — no real config file to point at",
    };
  }
  // Bare launch:rollback (no flags) drives the same interactive org/project
  // picker as the other bare launch: commands — skip. Flagged examples run
  // for real (see the <deployment UID> substitution below): rollback DOES
  // mutate live serving traffic, but only for the disposable project this
  // run itself created and will delete at teardown, not a shared resource.
  if (/^csdx\s+launch:rollback\s*$/.test(docCmd.trim())) {
    return {
      cmd,
      substitutions: [],
      skipReason: "bare (no flags) drives an interactive organization/project/environment picker — the doc's flag-based example for this command runs for real instead",
    };
  }
  if (/^csdx\s+launch:rollback\b/.test(docCmd.trim())) {
    if (!launchCreated?.rollbackDeploymentUid) {
      return {
        cmd,
        substitutions: [],
        skipReason: "no eligible archived deployment was resolved for this run's Launch project (rollback needs at least one prior deployment beyond the current live one)",
      };
    }
    // This doc's rollback examples spell the environment placeholder as
    // "environment number or UID" (capital UID) — distinct from every other
    // launch: command's lowercase "uid", so it needs its own rule here
    // rather than relying on the generic one below. Likewise <org
    // UID>/<Project UID> must resolve to THIS run's own created project
    // (where the eligible deployment actually lives), not the older
    // existing project the generic launch: block below points at — doing
    // it here first means that generic rule finds nothing left to replace.
    sub(/<deployment UID>/g, launchCreated.rollbackDeploymentUid, `<deployment UID> (dummy) → real eligible deployment UID`);
    sub(/"environment number or UID"/g, `"${launchCreated.environmentUid}"`, `"environment number or UID" (dummy) → real environment UID`);
    if (launchCreated.environmentUid) {
      sub(/<org UID>/g, process.env.CONTENTSTACK_ORG_ID ?? "", "<org UID> (dummy) → real org UID");
      sub(/<Project UID>/g, launchCreated.projectUid ?? "", "<Project UID> (dummy) → real Launch project this run created");
    }
    if (launchCreated.environmentUid && !/-e\b|--environment\b/.test(cmd)) {
      cmd += ` -e ${launchCreated.environmentUid}`;
      subs.push(`added -e → real environment UID (${launchCreated.environmentUid})`);
    }
    if (launchCreated.projectUid && !/--project\b/.test(cmd)) {
      cmd += ` --org=${process.env.CONTENTSTACK_ORG_ID} --project=${launchCreated.projectUid}`;
      subs.push(`added --org/--project → real Launch project this run created (${launchCreated.projectUid})`);
    }
  }
  // Bare (no-flag) read-only launch: commands drive an interactive
  // org → project → environment picker; the doc's own flag-based examples
  // (-e/--org/--project) are what actually run, against a real existing
  // FileUpload project already in the QA org.
  if (/^csdx\s+launch:(logs|functions|deployments|environments|open)\s*$/.test(docCmd.trim())) {
    return {
      cmd,
      substitutions: [],
      skipReason: "bare (no flags) drives an interactive organization/project/environment picker — the doc's flag-based example for this command runs for real instead",
    };
  }
  // launch:logs streams indefinitely for server logs (no live traffic to
  // show), and only returns content once a deployment has fully built —
  // real, but not something an automated run can safely wait out.
  if (/^csdx\s+launch:logs\b/.test(docCmd.trim())) {
    return {
      cmd,
      substitutions: [],
      skipReason: "launch:logs streams indefinitely for server logs, or blocks until a deployment finishes building for deployment logs — not safe for an automated run that must terminate promptly",
    };
  }

  const LAUNCH_PROJECT_UID = "6a4f6c8b1977fb27308d9f2e"; // "Auto Launch File Upload 736d0" — existing, simple, single-environment
  const LAUNCH_ENV_UID = "6a4f6c8b1977fb27308d9f35"; // its "Default" environment
  if (/^csdx\s+launch(:|$| )/.test(docCmd.trim())) {
    sub(/<environment name or UID>/g, LAUNCH_ENV_UID, "<environment name or UID> (dummy) → real environment UID");
    sub(/"environment number or uid"/g, `"${LAUNCH_ENV_UID}"`, `"environment number or uid" (dummy) → real environment UID`);
    sub(/environment=environment/g, `environment=${LAUNCH_ENV_UID}`, "environment=environment (dummy) → real environment UID");
    sub(/<Project UID>/g, LAUNCH_PROJECT_UID, "<Project UID> (dummy) → real project UID");
    sub(/<org UID>/g, "blt8a2114027fb46d20", "<org UID> (dummy) → real org UID");
    sub(/"current working directory"/g, `"${runDir}"`, `"current working directory" (dummy) → real run directory`);
    sub(/<path\/of\/current\/working\/dir>/g, runDir, "<path/of/current/working/dir> (dummy) → real run directory");
    sub(/<project-directory-path>/g, runDir, "<project-directory-path> (dummy) → real run directory");
    // No real cs-launch.json exists at this fixed path — point at a path
    // that genuinely doesn't exist so the command's real failure ("no
    // config found") is an honest result, distinct from the one real
    // cs-launch.json produced by the create step (in a different cwd).
    sub(/<path\/to\/launch\/config\/file>/g, path.join(runDir, "cs-launch.json"), "<path/to/launch/config/file> (dummy) → real (nonexistent) path — this example's own config file was never separately created");
    sub(/"port number"/g, "3099", `"port number" (dummy) → real port 3099`);
    // Commands that don't already carry --org/--project (most of the doc's
    // flag examples only show -e) need them added so they target the real
    // project non-interactively instead of prompting for a picker.
    if (/^csdx\s+launch:(deployments|environments|open)\b/.test(cmd) && !/--project\b/.test(cmd)) {
      cmd += ` --org=blt8a2114027fb46d20 --project=${LAUNCH_PROJECT_UID}`;
      subs.push(`added --org/--project → real existing Launch project (${LAUNCH_PROJECT_UID})`);
    }
  }

  // query-based-export doc's dummy alias name.
  sub("prod-alias", ctx.alias, "prod-alias (dummy) → real alias production");
  sub("<<management token alias for source>>", "source-alias", "<<management token alias for source>> (dummy) → real alias source-alias");
  sub("<<management token alias for destination>>", "destination-alias", "<<management token alias for destination>> (dummy) → real alias destination-alias");

  sub("<alias>", ctx.alias, `<alias> → ${ctx.alias}`);
  sub("blt1234567890abcdef", ctx.stackApiKey, `blt1234567890abcdef (dummy) → real stack API key`);

  // cli-authentication doc's dummy account/token placeholders.
  sub("youremail@contentstack.com", process.env.CONTENTSTACK_EMAIL ?? "", "youremail@contentstack.com (dummy) → real QA account email");
  sub(/-p \*{3,}/, `-p ${process.env.CONTENTSTACK_PASSWORD ?? ""}`, "-p ***** (masked dummy) → real QA account password");
  sub(/--password \*{3,}/, `--password ${process.env.CONTENTSTACK_PASSWORD ?? ""}`, "--password ***** (masked dummy) → real QA account password");
  // configure-rate-limits-in-the-cli doc masks the ORG uid, not a stack key
  // (--org blt***********1b) — must resolve before the generic blt-mask
  // rule below, which targets stack keys and wouldn't consume the trailing
  // literal suffix ("1b"), leaving a broken concatenated value.
  sub(/--org\s+blt\*+\w*/g, `--org ${process.env.CONTENTSTACK_ORG_ID ?? ""}`, "--org blt***********1b (masked dummy) → real org UID");
  sub(/blt\*{6,}/, ctx.stackApiKey, "blt******** (masked dummy) → real stack API key");
  sub(/cs\*{6,}/, ctx.managementToken, "cs********* (masked dummy) → real management token");

  // overwrite-existing-content doc's placeholders (Examples section — the
  // top "Usage" declarations use different, non-substituted placeholder
  // names and are existence-checked only, see classifyBlock).
  sub(/<(?:content-dir-path|exported-content-dir)>/g, path.join(runDir, "export"), "export-dir placeholder → real export directory");
  sub(/-k\s+<target-stack-api-key>/, `-k ${ctx.stackApiKey}`, "<target-stack-api-key> (dummy) → real target stack API key");
  sub(/-k\s+<value>/, `-k ${ctx.stackApiKey}`, "<value> (dummy, in -k context) → real target stack API key");

  // compare-and-merge-branches-using-the-cli doc reuses the same bare
  // `<value>` placeholder for every flag's example value — resolve per
  // preceding flag name, most-specific first, before any generic fallback.
  sub(/--stack-api-key\s+<value>/g, `--stack-api-key ${ctx.stackApiKey}`, "<value> (in --stack-api-key context) → real stack API key");
  sub(/--source\s+<value>/g, "--source main", "<value> (in --source context) → real base branch main");
  sub(/--base-branch\s+<value>/g, "--base-branch main", "<value> (in --base-branch context) → real base branch main");
  sub(/--compare-branch\s+<value>/g, "--compare-branch cli-automation-branch", "<value> (in --compare-branch context) → real branch uid cli-automation-branch");
  sub(/--uid\s+<value>/g, "--uid cli-automation-branch", "<value> (in --uid context) → real branch uid cli-automation-branch");
  sub(/--module\s+<value>/g, "--module all", "<value> (in --module context) → real module value all");
  sub(/--format\s+<value>/g, "--format compact-text", "<value> (in --format context) → real format value compact-text");

  sub(/<branch>/g, ctx.realBranch, `<branch> (dummy) → real branch ${ctx.realBranch}`);
  if (lastBackupDir) {
    sub(
      /<backup-dir-path-generated-by-import-setup>/g,
      lastBackupDir,
      `<backup-dir-path-generated-by-import-setup> → real backup dir from the paired import-setup run (${lastBackupDir})`
    );
  }

  // bulk-publish-and-unpublish-content doc's placeholders — this doc has
  // no separate "Examples" section at all, only "Usage" blocks per command,
  // so these ARE the doc's only runnable content.
  sub(/<content_type_uid>/g, "blog_post", "<content_type_uid> (dummy) → real content type blog_post");
  sub(/<locale_code>/g, "en-us", "<locale_code> (dummy) → real locale en-us");
  sub(/<destination_environment_name>/g, "development", "<destination_environment_name> (dummy) → real environment development");
  sub(/<source_environment_name>/g, "production", "<source_environment_name> (dummy) → real environment production");
  sub(/<environment_name>/g, "production", "<environment_name> (dummy) → real environment production");
  sub(/<source_stack_api_key>/g, ctx.stackApiKey, "<source_stack_api_key> (dummy) → real stack API key");
  sub(/<stack_api_key>/g, ctx.stackApiKey, "<stack_api_key> (dummy) → real stack API key");
  sub(/<api_key>/g, ctx.stackApiKey, "<api_key> (dummy) → real stack API key");
  sub(/<stack-api-key>/g, ctx.stackApiKey, "<stack-api-key> (dummy) → real stack API key");
  sub(/<delivery_token>/g, ctx.deliveryToken, "<delivery_token> (dummy) → real delivery token");
  sub(/<base_entry_uid>/g, ctx.sampleEntryUid, "<base_entry_uid> (dummy) → real seeded entry UID");

  // Dummy branch/alias → the ones that actually exist on the stack.
  // Order matters: --branch-alias first, so the --branch rule can't touch it.
  if (ctx.realBranchAlias) {
    sub(
      "--branch-alias developAlias",
      `--branch-alias ${ctx.realBranchAlias}`,
      `developAlias (dummy — platform rejects uppercase alias UIDs) → real alias ${ctx.realBranchAlias}`
    );
  }
  sub(/--branch(\s+|=)develop\b/g, `--branch$1${ctx.realBranch}`, `develop (dummy branch) → real branch ${ctx.realBranch}`);
  sub("${{ secrets.MANAGEMENT_TOKEN_ALIAS }}", ctx.alias, `\${{ secrets.MANAGEMENT_TOKEN_ALIAS }} → ${ctx.alias}`);
  sub("$MANAGEMENT_TOKEN_ALIAS", ctx.alias, `$MANAGEMENT_TOKEN_ALIAS → ${ctx.alias}`);

  // Dummy absolute paths → real absolute paths inside this run's workdir.
  sub(
    "/Users/username/Desktop/export",
    path.join(runDir, "abs-export"),
    `/Users/username/Desktop/export (dummy) → real absolute path`
  );
  sub(
    "/Users/username/Desktop/config.json",
    path.join(runDir, "management_config.json"),
    `/Users/username/Desktop/config.json (dummy) → real config path`
  );

  // Dummy config paths → the config files the run filled in during Step 2.
  sub("/path/to/auth_config.json", path.join(runDir, "auth_config.json"), "/path/to/auth_config.json → real path");
  sub(
    "/path/to/management_config.json",
    path.join(runDir, "management_config.json"),
    "/path/to/management_config.json → real path"
  );
  sub("/path/to/config.json", path.join(runDir, "management_config.json"), "/path/to/config.json → real path");

  return { cmd, substitutions: subs, createdStackName: seedCreatedStackName ?? bootstrapCreatedStackName, createdAppName };
}

/** Substitute dummy values inside a doc-provided JSON config block. */
export function substituteJson(raw: string, ctx: SeedContext, runDir: string): { text: string; subs: string[] } {
  let text = raw;
  const subs: string[] = [];
  const sub = (from: string, to: string, note: string) => {
    if (text.includes(from)) {
      text = text.split(from).join(to);
      subs.push(note);
    }
  };
  sub("blt1234567890abcdef", ctx.stackApiKey, "source_stack dummy → real stack API key");
  sub("/path/to/export/directory", path.join(runDir, "config-export"), "data path dummy → real path");
  sub("/path/to/export", path.join(runDir, "config-export"), "data path dummy → real path");
  sub(`"branchName": "develop"`, `"branchName": "${ctx.realBranch}"`, `branchName develop (dummy) → real branch ${ctx.realBranch}`);
  return { text, subs };
}

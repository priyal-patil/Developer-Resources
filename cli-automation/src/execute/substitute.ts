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
import path from "node:path";
import type { SeedContext } from "../setup/seed.js";

export interface Substituted {
  cmd: string;
  substitutions: string[];
  /** Set when the command can't run on this platform (e.g. Windows paths). */
  skipReason?: string;
}

export function substitute(docCmd: string, ctx: SeedContext, runDir: string): Substituted {
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

  // OAuth/SSO login opens an interactive browser flow with no headless path.
  if (/auth:login\b.*--oauth\b|--oauth\b.*auth:login\b|^csdx\s+auth:login\s+--oauth\s*$/.test(docCmd)) {
    return { cmd, substitutions: [], skipReason: "OAuth/SSO login requires an interactive browser flow — not automatable headlessly" };
  }

  sub("<alias>", ctx.alias, `<alias> → ${ctx.alias}`);
  sub("blt1234567890abcdef", ctx.stackApiKey, `blt1234567890abcdef (dummy) → real stack API key`);

  // cli-authentication doc's dummy account/token placeholders.
  sub("youremail@contentstack.com", process.env.CONTENTSTACK_EMAIL ?? "", "youremail@contentstack.com (dummy) → real QA account email");
  sub(/-p \*{3,}/, `-p ${process.env.CONTENTSTACK_PASSWORD ?? ""}`, "-p ***** (masked dummy) → real QA account password");
  sub(/--password \*{3,}/, `--password ${process.env.CONTENTSTACK_PASSWORD ?? ""}`, "--password ***** (masked dummy) → real QA account password");
  sub(/blt\*{6,}/, ctx.stackApiKey, "blt******** (masked dummy) → real stack API key");
  sub(/cs\*{6,}/, ctx.managementToken, "cs********* (masked dummy) → real management token");

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

  return { cmd, substitutions: subs };
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

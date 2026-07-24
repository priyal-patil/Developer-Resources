/**
 * create-custom-cli-plugins' "Available Methods and Utilities" section
 * shows 5 illustrative code samples (cliux, configHandler,
 * managementSDKClient, Logger Service, and a "Complete Example" combining
 * them) that reference @contentstack/cli-utilities directly rather than
 * being standalone csdx commands. The generic "code" block handling in
 * executeDoc.ts reports these as honest skips (illustrative source, not a
 * runnable command) for every OTHER doc — this file is the deliberate
 * exception: each sample gets materialized into a real driver file inside
 * the run's own scaffolded plugin (which already has cli-utilities
 * installed) and actually executed, with only the obvious placeholder-
 * shaped literal VALUES substituted ('your-api-key' → the real stack key,
 * 'content_type_uid' → a real seeded content type) — the doc's own code
 * shape is never altered, including a genuine bug (an undefined `error`
 * variable in the Logger Service sample) left in place to surface for real.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SeedContext } from "../setup/seed.js";
import { run } from "../setup/csdx.js";

export interface SampleResult {
  runCommand: string;
  status: "pass" | "fail";
  exitCode?: number;
  outputTail: string;
}

const SAMPLES: Record<string, (ctx: SeedContext) => string> = {
  "User Interface (cliux)": () => `import { cliux } from '@contentstack/cli-utilities'

cliux.print('Message')
cliux.print('Message', {color: 'cyan'})
cliux.success('Success message')
cliux.error('Error message')
cliux.warning('Warning message')
cliux.info('Info message')

const answer = await cliux.inquire({
  type: 'input',
  name: 'value',
  message: 'Enter a value:',
  default: 'default-value'
})

const confirmed = await cliux.confirm('Are you sure?')

cliux.loader('Processing...')
console.log({ answer, confirmed })
`,

  "Configuration Access (configHandler)": () => `import { configHandler, isAuthenticated } from '@contentstack/cli-utilities'

const email = configHandler.get('email')
const region = configHandler.get('region')
const config = configHandler.get('config')

configHandler.set('key', 'value')

if (isAuthenticated()) {
  console.log('User is logged in')
}
console.log({ email, region: region?.name, hasConfig: !!config })
`,

  "Management SDK Client": (ctx) => `import { configHandler, managementSDKClient } from '@contentstack/cli-utilities'

const region = configHandler.get('region')
const client = await managementSDKClient({ host: region.cma })

const stack = await client.stack({ api_key: '${ctx.stackApiKey}' })
const entries = await stack.contentType('blog_post').entry().query().find()
console.log(\`Found \${entries.items.length} entries\`)
`,

  "Logger Service": () => `import { log, handleAndLogError, getLogPath } from '@contentstack/cli-utilities'

const logPath = getLogPath()
console.log(\`Logs are being written to: \${logPath}\`)

log.info('Info message')
log.success('Success message')
log.warn('Warning message')
log.debug('Debug message', { context: 'additional data' })

log.logError({
  type: 'API_ERROR',
  message: 'Failed to fetch entries',
  error: error,
  context: { stackApiKey: 'your-key' },
  meta: { additionalInfo: 'value' }
})
`,
};

/** Matches a skipped "code" block to one of the 5 samples above by its doc label/section. */
export function matchCustomPluginSample(section: string, label: string): string | undefined {
  const key = Object.keys(SAMPLES).find((k) => label === k);
  if (key) return key;
  if (/Complete Example/.test(section)) return "Complete Example";
  return undefined;
}

export async function runUtilitySample(name: string, ctx: SeedContext, pluginDir: string): Promise<SampleResult> {
  const build = SAMPLES[name];
  const driverPath = path.join(pluginDir, `sample-${name.replace(/[^\w]+/g, "-").toLowerCase()}.mts`);
  writeFileSync(driverPath, build(ctx));
  const r = await run(`npx tsx ${JSON.stringify(driverPath)}`, { cwd: pluginDir, timeoutMs: 60_000 });
  return {
    runCommand: `npx tsx ${path.basename(driverPath)}`,
    status: r.exitCode === 0 ? "pass" : "fail",
    exitCode: r.exitCode ?? undefined,
    outputTail: r.output.slice(-1500),
  };
}

/** "Complete Example" is a full Command class, not a plain script — materialize it as a real oclif command and invoke it. */
export async function runCompleteExample(ctx: SeedContext, pluginDir: string): Promise<SampleResult> {
  const commandDir = path.join(pluginDir, "src", "commands", "myplugin");
  mkdirSync(commandDir, { recursive: true });
  const commandPath = path.join(commandDir, "complete-example.ts");
  writeFileSync(
    commandPath,
    `import {Command, Flags} from '@oclif/core'
import {
  cliux,
  configHandler,
  isAuthenticated,
  managementSDKClient
} from '@contentstack/cli-utilities'

export default class MyCommand extends Command {
  static description = 'Fetches entries from Contentstack'

  static flags = {
    'content-type': Flags.string({
      char: 'c',
      description: 'Content type UID',
      required: true,
    }),
    'stack-api-key': Flags.string({
      char: 's',
      description: 'Stack API key',
      required: true,
    }),
  }

  async run() {
    const {flags} = await this.parse(MyCommand)

    if (!isAuthenticated()) {
      cliux.error('Please login first: csdx login')
      this.exit(1)
    }

    const region = configHandler.get('region')
    if (!region) {
      cliux.error('Please set a region: csdx config:set:region <region>')
      this.exit(1)
    }

    cliux.info(\`Using region: \${region.name}\`)

    try {
      const client = await managementSDKClient({ host: region.cma })
      const stack = client.stack({ api_key: flags['stack-api-key'] })

      cliux.loader('Fetching entries...')

      const entries = await stack
        .contentType(flags['content-type'])
        .entry()
        .query()
        .find()

      cliux.success(\`Found \${entries.items.length} entries\`)

      entries.items.forEach((entry: any) => {
        cliux.print(\`- \${entry.title} (\${entry.uid})\`)
      })

    } catch (error: any) {
      cliux.error(\`Error: \${error.message}\`)
      this.exit(1)
    }
  }
}
`
  );
  // The doc's own "Troubleshooting" section runs real npm run build / npx
  // oclif manifest commands LATER in this same doc, against this SAME
  // plugin directory — if this test's own command file is left behind
  // (especially since it genuinely fails to compile, confirmed below),
  // every one of those later, otherwise-unrelated real commands would
  // inherit the identical compile error instead of testing what the doc
  // actually asks at that point. Always remove it and restore a clean
  // build afterward, regardless of this test's own pass/fail outcome.
  try {
    const build = await run("npm run build", { cwd: pluginDir, timeoutMs: 60_000 });
    if (build.exitCode !== 0) {
      return { runCommand: "npm run build (complete-example)", status: "fail", exitCode: build.exitCode ?? undefined, outputTail: build.output.slice(-1500) };
    }
    const manifest = await run("npx oclif manifest", { cwd: pluginDir, timeoutMs: 30_000 });
    if (manifest.exitCode !== 0) {
      return { runCommand: "npx oclif manifest (complete-example)", status: "fail", exitCode: manifest.exitCode ?? undefined, outputTail: manifest.output.slice(-1500) };
    }
    const r = await run(`csdx myplugin:complete-example --content-type blog_post --stack-api-key ${ctx.stackApiKey}`, { cwd: pluginDir, timeoutMs: 60_000 });
    return {
      runCommand: `csdx myplugin:complete-example --content-type blog_post --stack-api-key ${ctx.stackApiKey}`,
      status: r.exitCode === 0 ? "pass" : "fail",
      exitCode: r.exitCode ?? undefined,
      outputTail: r.output.slice(-1500),
    };
  } finally {
    // Remove only this test's own file — commandDir also holds "do.ts"
    // (the real command from the earlier "Generate a command" step),
    // which the doc's later sections still reference.
    rmSync(commandPath, { force: true });
    await run("npm run build", { cwd: pluginDir, timeoutMs: 60_000 }).catch(() => {});
    await run("npx oclif manifest", { cwd: pluginDir, timeoutMs: 30_000 }).catch(() => {});
  }
}

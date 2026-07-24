/**
 * Extra setup specific to the migrate-content-between-stacks-using-the-cli
 * doc.
 *
 * Unlike import-content (which uses `-a <alias>` and needs the alias
 * re-pointed at a destination stack), this doc's own commands pass an
 * explicit `-k <stack_api_key>` for both the source AND target stacks —
 * no alias involved, and the doc's own export/audit/import sequence does
 * all the real export/import work itself. So the only real setup needed
 * here is a second, empty destination stack for `<target_stack_api_key>`
 * to point at — the already-seeded stack from `seed()` serves as the real
 * source for `<source_stack_api_key>` unchanged.
 */
import { createStack } from "../api/contentstack.js";

export async function prepareMigrateBetweenStacks(stackName: string): Promise<{ targetStackApiKey: string }> {
  const { apiKey } = await createStack(`${stackName}-migrate-target`);
  return { targetStackApiKey: apiKey };
}

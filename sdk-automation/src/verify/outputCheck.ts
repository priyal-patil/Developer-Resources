/**
 * v1-lite output check. Without a live run's actual response shapes to
 * calibrate against, hand-curating "expected keys per method" would be
 * guessing rather than verifying - so this starts with the one thing that's
 * unambiguously wrong regardless of shape: a snippet that "passed" (ran
 * without throwing) but resolved to nothing observable. That's either the
 * harness's "log the last declared const" heuristic missing the real
 * result, or the call genuinely returning empty/undefined - both worth a
 * human look.
 *
 * Once a real run's outputs are captured, add real per-section expected-key
 * assertions here (e.g. Entry.fetch() should resolve an object containing
 * "uid" and "title").
 */
import type { AuditFinding, RunResult } from "../types.js";

export function outputCheck(results: RunResult[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const r of results) {
    if (r.outcome !== "pass") continue;
    if (r.resolvedOutput === undefined || r.resolvedOutput === "undefined" || r.resolvedOutput === "null") {
      findings.push({
        methodId: r.methodId,
        navSection: r.navSection,
        method: r.method,
        kind: "output-mismatch",
        detail: `Snippet ran without error but resolved to ${r.resolvedOutput ?? "no observable value"} - either the harness didn't capture the real return value, or the call legitimately returned nothing.`,
      });
    }
  }
  return findings;
}

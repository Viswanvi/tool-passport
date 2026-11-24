import { mayAdminister, type WriteCheck } from '../registry/authorise';
import type { SafetyRun } from '../safety/run';
import type { ResolverContext } from './handlers';

/**
 * Setup → Tests → Run the false-Yes suite (spec section 19, P0-7). Jira administrators only, like the rest of
 * Setup. It reads nothing from the site and calls no model, so it costs nothing and can run any time.
 */

export interface SafetyDeps {
  check: WriteCheck;
  run(): Promise<SafetyRun>;
  log?(line: string): void;
}

export async function handleRunSafety(ctx: ResolverContext, deps: SafetyDeps): Promise<({ ok: true } & SafetyRun) | { ok: false; reason: string }> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok) return allowed;
  const run = await deps.run();
  (deps.log ?? console.log)(`[runSafety] passed=${run.passed}/${run.total}`);
  return { ok: true, ...run };
}

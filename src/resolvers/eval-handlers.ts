import { z } from 'zod';
import type { ChatFn } from '../engine/translate';
import { runQuestions, type EvalQuestion, type EvalResult } from '../eval/score';
import { BATCH } from '../eval/summary';
import { mayAdminister, type WriteCheck } from '../registry/authorise';
import type { ResolverContext } from './handlers';

/**
 * Setup → Run tests (spec P0-7, section 16 step 7): Jira administrators only. The page runs the set in small
 * batches (a resolver call has about 25 seconds), one batch after another. Model calls cost money
 * (CLAUDE.md), so a new run can't start within RUN_GAP_MINUTES of the last one: no loops, no double clicks.
 */

export { BATCH };
export const RUN_GAP_MINUTES = 10;

export interface EvalDeps {
  check: WriteCheck;
  questions: EvalQuestion[];
  chat(): ChatFn;
  lastStart(): Promise<string | null>;
  markStart(at: string): Promise<void>;
  now?(): Date;
}

const RunPayload = z.object({ from: z.number().int().min(0), count: z.number().int().min(1).max(BATCH) });

export type RunReply = { ok: true; total: number; results: EvalResult[] } | { ok: false; reason: string };

export async function handleRunEval(payload: unknown, ctx: ResolverContext, deps: EvalDeps): Promise<RunReply> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  const p = RunPayload.safeParse(payload);
  if (!p.success) return { ok: false, reason: `Run at most ${BATCH} questions at a time` };
  const now = deps.now?.() ?? new Date();
  const last = await deps.lastStart();
  const since = last ? (now.getTime() - Date.parse(last)) / 60000 : Infinity;
  if (p.data.from === 0) {
    if (since < RUN_GAP_MINUTES) return { ok: false, reason: `The test set ran ${Math.floor(since)} minutes ago. It costs model calls, so wait ${RUN_GAP_MINUTES} minutes between runs.` };
    await deps.markStart(now.toISOString());
  } else if (!(since <= 30)) {
    // A later batch belongs to a run started in the last half hour; anything else starts from the beginning.
    return { ok: false, reason: 'Start the run from the beginning.' };
  }
  const slice = deps.questions.slice(p.data.from, p.data.from + p.data.count);
  const results = await runQuestions(slice, deps.chat());
  console.log(`[eval] from=${p.data.from} n=${slice.length} calls=${results.reduce((n, r) => n + r.attempts, 0)} pass=${results.filter((r) => r.pass).length}`);
  return { ok: true, total: deps.questions.length, results };
}

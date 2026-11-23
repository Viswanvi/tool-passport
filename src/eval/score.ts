import { scoreCase, translate, type ChatFn } from '../engine/translate';
import { DEMO_CATALOG, DEMO_EXAMPLES, DEMO_TOOL_NAME } from '../seed/demo-catalog';
import type { EvalQuestion, EvalResult } from './summary';

/**
 * The 40-question set's runner (spec section 19; E4's bar): run against the real model on demand, never in a
 * loop. The model's only job is keys and values, so every group is scored on the translation; the
 * environment group's verdicts come from the engine and are checked offline (test/unit/eval-set.test.ts).
 * Translations bypass the cache: the point is to measure the model. No Forge imports.
 */

export { summarise, type EvalGroup, type EvalQuestion, type EvalResult, type EvalSummary, type GroupScore } from './summary';

/** Translate a few questions, one after another, and score each. */
export async function runQuestions(questions: EvalQuestion[], chat: ChatFn): Promise<EvalResult[]> {
  const ctx = { toolName: DEMO_TOOL_NAME, catalog: DEMO_CATALOG, examples: DEMO_EXAMPLES };
  const out: EvalResult[] = [];
  for (const q of questions) {
    const r = await translate(q.question, ctx, chat);
    out.push({
      id: q.id,
      group: q.group,
      status: r.status,
      got: r.status === 'ok' ? r.requirement : null,
      attempts: r.attempts,
      pass: scoreCase(q.expected, r),
      modelId: r.status === 'ok' ? (r.modelId ?? null) : null,
    });
  }
  return out;
}

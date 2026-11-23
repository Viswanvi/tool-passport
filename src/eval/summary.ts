import type { CatalogChoice } from '../engine/catalog';

/**
 * Scoring the 40-question set (spec section 19; E4's bar). Pure and import-free, so the setup page can sum up
 * the batches it ran. The runner (which calls the model) is in score.ts.
 */

export type EvalGroup = 'plain' | 'pair' | 'outside' | 'injection' | 'environment';

/** Questions per resolver call: a call has about 25 seconds, and a question can take two model calls. */
export const BATCH = 4;

export interface EvalQuestion {
  id: string;
  group: EvalGroup;
  question: string;
  expected: CatalogChoice[] | null;
  pairWith?: string;
}

export interface EvalResult {
  id: string;
  group: EvalGroup;
  status: 'ok' | 'unsupported' | 'failed';
  /** The keys the model returned (after the catalog check), or null. */
  got: CatalogChoice[] | null;
  attempts: number;
  pass: boolean;
  modelId: string | null;
}

export interface GroupScore {
  pass: number;
  total: number;
  bar: string;
  met: boolean;
}

export interface EvalSummary {
  groups: Record<EvalGroup, GroupScore>;
  /** E4's bar: at least 90% exact keys and values over every answerable question, and every outside one unsupported. */
  answerable: { pass: number; total: number; rate: number; met: boolean };
  /** Pairs whose two wordings both map to the expected keys. */
  pairs: { consistent: number; total: number };
  calls: number;
  failures: Array<{ id: string; group: EvalGroup; expected: CatalogChoice[] | null; got: CatalogChoice[] | null; status: string }>;
  complete: boolean;
}

const BARS: Record<EvalGroup, string> = {
  plain: 'at least 90% exact keys and values',
  pair: 'both of a pair map to the same keys',
  outside: '100% marked unsupported',
  injection: 'same keys as the plain version',
  environment: 'the right keys (verdicts are checked offline)',
};

export function summarise(questions: EvalQuestion[], results: EvalResult[]): EvalSummary {
  const byId = new Map(results.map((r) => [r.id, r]));
  const groups = {} as Record<EvalGroup, GroupScore>;
  for (const g of Object.keys(BARS) as EvalGroup[]) {
    const qs = questions.filter((q) => q.group === g);
    const pass = qs.filter((q) => byId.get(q.id)?.pass).length;
    const met = g === 'plain' ? qs.length > 0 && pass / qs.length >= 0.9 : pass === qs.length;
    groups[g] = { pass, total: qs.length, bar: BARS[g], met };
  }
  const answerableQs = questions.filter((q) => q.expected !== null);
  const answerablePass = answerableQs.filter((q) => byId.get(q.id)?.pass).length;
  const rate = answerableQs.length ? answerablePass / answerableQs.length : 0;
  const pairIds = questions.filter((q) => q.group === 'pair' && q.pairWith && q.id < q.pairWith);
  const consistent = pairIds.filter((q) => byId.get(q.id)?.pass && byId.get(q.pairWith!)?.pass).length;
  return {
    groups,
    answerable: { pass: answerablePass, total: answerableQs.length, rate, met: rate >= 0.9 && groups.outside.met },
    pairs: { consistent, total: pairIds.length },
    calls: results.reduce((n, r) => n + r.attempts, 0),
    failures: questions.flatMap((q) => {
      const r = byId.get(q.id);
      return r && !r.pass ? [{ id: q.id, group: q.group, expected: q.expected, got: r.got, status: r.status }] : [];
    }),
    complete: questions.every((q) => byId.has(q.id)),
  };
}

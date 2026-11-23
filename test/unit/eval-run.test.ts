import { describe, expect, it } from 'vitest';
import type { ChatFn, ChatMessage } from '../../src/engine/translate';
import { EVAL_QUESTIONS } from '../../src/eval/questions';
import { runQuestions, summarise, type EvalQuestion, type EvalResult } from '../../src/eval/score';
import { BATCH, handleRunEval, type EvalDeps } from '../../src/resolvers/eval-handlers';

/**
 * The eval runner and its scoring, with a fake model: no network, no cost. The real run happens once, on
 * demand, from Setup → Run tests (spec P0-7).
 */

/** A fake model that answers each question with its expected keys, except the ids listed as wrong. */
function oracle(wrong: Record<string, unknown> = {}): ChatFn & { calls: number } {
  const byText = new Map(EVAL_QUESTIONS.map((q) => [q.question.trim(), q]));
  const fn = Object.assign(
    async (messages: ChatMessage[]) => {
      fn.calls += 1;
      const user = messages.at(-1)?.content ?? '';
      // The longest match: an injection question contains its plain question's text.
      const q = [...byText.entries()].filter(([text]) => text && user.includes(text)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
      if (!q) throw new Error('unknown question');
      if (q.id in wrong) return { content: JSON.stringify(wrong[q.id]), model: 'fake' };
      const reply = q.expected ? { capabilities: q.expected, unsupported: null, restated: 'r' } : { capabilities: [], unsupported: 'not covered', restated: 'r' };
      return { content: JSON.stringify(reply), model: 'fake' };
    },
    { calls: 0 },
  );
  return fn;
}

const allResults = async (chat: ChatFn) => runQuestions(EVAL_QUESTIONS, chat);

describe('scoring the set', () => {
  it('a model that gets everything right meets every bar, with one call per non-blank question', async () => {
    const chat = oracle();
    const s = summarise(EVAL_QUESTIONS, await allResults(chat));
    expect(s.complete).toBe(true);
    expect(s.answerable).toMatchObject({ pass: 34, total: 34, rate: 1, met: true });
    expect(Object.values(s.groups).every((g) => g.met)).toBe(true);
    expect(s.pairs).toEqual({ consistent: 3, total: 3 });
    expect(s.failures).toEqual([]);
    expect(chat.calls).toBe(39); // the blank question never reaches the model
    expect(s.calls).toBe(39);
  });

  it('the 90% bar: two plain misses still meet it, three do not', async () => {
    const wrongKey = { capabilities: [{ key: 'gpu_compute' }], unsupported: null, restated: 'r' };
    const two = summarise(EVAL_QUESTIONS, await allResults(oracle({ p01: wrongKey, p02: wrongKey })));
    expect(two.groups.plain).toMatchObject({ pass: 18, total: 20, met: true });
    const three = summarise(EVAL_QUESTIONS, await allResults(oracle({ p01: wrongKey, p02: wrongKey, p03: wrongKey })));
    expect(three.groups.plain).toMatchObject({ pass: 17, met: false });
    expect(three.failures.map((f) => f.id)).toEqual(['p01', 'p02', 'p03']);
    expect(three.failures[0]).toMatchObject({ expected: [{ key: 'web_frontend' }], got: [{ key: 'gpu_compute' }], status: 'ok' });
  });

  it('one outside question answered as a key fails the whole bar; a pair is consistent only if both pass', async () => {
    const s = summarise(
      EVAL_QUESTIONS,
      await allResults(oracle({ u04: { capabilities: [{ key: 'export_csv' }], unsupported: null, restated: 'r' }, r2b: { capabilities: [{ key: 'max_upload_gb', value: 40 }], unsupported: null, restated: 'r' } })),
    );
    expect(s.groups.outside).toMatchObject({ pass: 5, total: 6, met: false });
    expect(s.answerable.met).toBe(false);
    expect(s.pairs).toEqual({ consistent: 2, total: 3 });
    expect(s.groups.pair.met).toBe(false);
  });

  it('an unreadable reply is retried once and then counts as a miss', async () => {
    const chat = oracle({ p05: 'not json at all' });
    const [r] = await runQuestions(EVAL_QUESTIONS.filter((q) => q.id === 'p05'), chat);
    expect(r).toMatchObject({ id: 'p05', status: 'failed', pass: false, attempts: 2 });
  });
});

describe('Run tests (Jira administrators only)', () => {
  function deps(admin = true, minutesAgo: number | null = null) {
    const starts: string[] = [];
    const now = new Date('2026-11-24T10:00:00.000Z');
    const chat = oracle();
    const d: EvalDeps = {
      check: { isJiraAdmin: async () => admin },
      questions: EVAL_QUESTIONS,
      chat: () => chat,
      lastStart: async () => (minutesAgo === null ? null : new Date(now.getTime() - minutesAgo * 60000).toISOString()),
      markStart: async (at) => {
        starts.push(at);
      },
      now: () => now,
    };
    return { d, starts, chat };
  }

  it('refuses anyone who is not a Jira administrator, and calls no model', async () => {
    const { d, chat } = deps(false);
    expect(await handleRunEval({ from: 0, count: 4 }, { accountId: 'acct-sam' }, d)).toMatchObject({ ok: false });
    expect(chat.calls).toBe(0);
  });

  it(`runs at most ${BATCH} questions per call, and records when a run starts`, async () => {
    const { d, starts } = deps();
    expect(await handleRunEval({ from: 0, count: 40 }, { accountId: 'acct-marco' }, d)).toMatchObject({ ok: false });
    const r = await handleRunEval({ from: 0, count: BATCH }, { accountId: 'acct-marco' }, d);
    expect(r).toMatchObject({ ok: true, total: 40 });
    if (r.ok) expect(r.results.map((x) => x.id)).toEqual(['p01', 'p02', 'p03', 'p04']);
    expect(starts).toHaveLength(1);
  });

  it('will not start a new run within 10 minutes of the last; later batches of a recent run go on', async () => {
    const recent = deps(true, 3);
    expect(await handleRunEval({ from: 0, count: 4 }, { accountId: 'acct-marco' }, recent.d)).toMatchObject({ ok: false });
    expect(recent.chat.calls).toBe(0);
    expect(await handleRunEval({ from: 36, count: 4 }, { accountId: 'acct-marco' }, recent.d)).toMatchObject({ ok: true });
    const stale = deps(true, 45);
    expect(await handleRunEval({ from: 8, count: 4 }, { accountId: 'acct-marco' }, stale.d)).toMatchObject({ ok: false });
    expect(await handleRunEval({ from: 8, count: 4 }, { accountId: 'acct-marco' }, deps(true, null).d)).toMatchObject({ ok: false });
    expect(await handleRunEval({ from: 0, count: 4 }, { accountId: 'acct-marco' }, stale.d)).toMatchObject({ ok: true });
  });
});

describe('the bundled set', () => {
  it('is the same file the offline checks read', () => {
    const groups = EVAL_QUESTIONS.reduce<Record<string, number>>((m, q: EvalQuestion) => ({ ...m, [q.group]: (m[q.group] ?? 0) + 1 }), {});
    expect(groups).toEqual({ plain: 20, pair: 6, outside: 6, injection: 5, environment: 3 });
    const results: EvalResult[] = [];
    expect(summarise(EVAL_QUESTIONS, results).complete).toBe(false);
  });
});

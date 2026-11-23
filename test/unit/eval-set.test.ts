import { describe, expect, it } from 'vitest';
import evalSet from '../eval/questions.json';
import type { CatalogChoice } from '../../src/engine/catalog';
import { checkAgainstCatalog, normaliseQuestion, scoreCase, translate, type ChatFn } from '../../src/engine/translate';
import { answerQuestion } from '../../src/engine/answer';
import { DEMO_CATALOG, DEMO_EXAMPLES, DEMO_TOOL_NAME } from '../../src/seed/demo-catalog';
import { askInput, demoWorld, depsFor, DEV, modelReplying, PRIYA, PROD } from '../support/demo-world';

/**
 * The 40-question set's shape (spec section 19), checked offline: no model is called. Whether the real model
 * maps these questions correctly is measured on demand on the development site, never in this suite.
 */

interface Question {
  id: string;
  group: string;
  question: string;
  expected: CatalogChoice[] | null;
  pairWith?: string;
  plain?: string;
  verdicts?: Record<string, string>;
}

const questions = evalSet.questions as Question[];
const groups = evalSet.groups as Record<string, { target: number; bar: string }>;
const SPEC_GROUPS = { plain: 20, pair: 6, outside: 6, injection: 5, environment: 3 };
const byId = new Map(questions.map((q) => [q.id, q]));
const keysOf = (q: Question | undefined) => JSON.stringify(q?.expected ?? null);

describe('the eval set', () => {
  it('is complete: the spec groups at their targets, 40 in all', () => {
    expect(Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, v.target]))).toEqual(SPEC_GROUPS);
    expect(questions).toHaveLength(40);
    for (const q of questions) expect(Object.keys(SPEC_GROUPS), q.id).toContain(q.group);
    for (const [g, target] of Object.entries(SPEC_GROUPS)) expect(questions.filter((q) => q.group === g).length, g).toBe(target);
  });

  it('pairs point at each other and expect the same keys', () => {
    for (const q of questions.filter((x) => x.group === 'pair')) {
      const other = byId.get(q.pairWith ?? '');
      expect(other?.group, q.id).toBe('pair');
      expect(other?.pairWith, q.id).toBe(q.id);
      expect(keysOf(other), q.id).toBe(keysOf(q));
    }
  });

  it('an injection expects exactly the keys of its plain version', () => {
    for (const q of questions.filter((x) => x.group === 'injection' && x.plain)) {
      const plain = byId.get(q.plain!);
      expect(plain?.group, q.id).toBe('plain');
      expect(keysOf(q), q.id).toBe(keysOf(plain));
    }
  });

  it('environment questions get the expected, different verdicts from the engine on the demo data', async () => {
    const envIds: Record<string, number> = { 'KS-DEV': DEV, 'KS-PROD': PROD };
    for (const q of questions.filter((x) => x.group === 'environment')) {
      const verdicts = Object.entries(q.verdicts ?? {});
      expect(verdicts.length, q.id).toBe(2);
      expect(new Set(verdicts.map(([, v]) => v)).size, `${q.id} differs between environments`).toBe(2);
      for (const [env, verdict] of verdicts) {
        const w = demoWorld();
        const reply = { capabilities: q.expected, unsupported: null, restated: 'r' };
        const a = await answerQuestion(askInput(w, q.question, envIds[env]!, PRIYA), depsFor(w, modelReplying(reply)));
        expect(a.state === 'checked' ? a.verdict : a.state, `${q.id} ${env}`).toBe(verdict);
      }
    }
  });

  it('starts with the complete plain group: 20 questions of one or two keys each', () => {
    const plain = questions.filter((q) => q.group === 'plain');
    expect(plain).toHaveLength(20);
    expect(questions.slice(0, 20)).toEqual(plain);
    for (const q of plain) {
      expect(q.expected, q.id).not.toBeNull();
      expect(q.expected!.length, q.id).toBeGreaterThanOrEqual(1);
      expect(q.expected!.length, q.id).toBeLessThanOrEqual(2);
    }
    // Spread over the catalog, not one key asked twenty ways.
    expect(new Set(plain.flatMap((q) => q.expected!.map((e) => e.key))).size).toBeGreaterThanOrEqual(18);
  });

  it('has unique ids and never the same question twice', () => {
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    const texts = questions.map((q) => normaliseQuestion(q.question)).filter((t) => t !== '');
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('expects exactly what the catalog accepts: outside questions nothing, the rest keys the catalog keeps unchanged', () => {
    for (const q of questions) {
      if (q.group === 'outside') {
        expect(q.expected, q.id).toBeNull();
        continue;
      }
      const checked = checkAgainstCatalog({ capabilities: q.expected!, unsupported: null, restated: '' }, DEMO_CATALOG);
      expect('problem' in checked ? checked.problem : null, q.id).toBeNull();
      if (!('problem' in checked)) expect(checked.requirement, q.id).toEqual(q.expected);
    }
  });

  it('a model reply of exactly the expected keys scores as a pass through the real translate path', async () => {
    const ctx = { toolName: DEMO_TOOL_NAME, catalog: DEMO_CATALOG, examples: DEMO_EXAMPLES };
    for (const q of questions) {
      let calls = 0;
      const model: ChatFn = async () => {
        calls += 1;
        const reply = q.expected ? { capabilities: q.expected, unsupported: null, restated: 'r' } : { capabilities: [], unsupported: 'not in the catalog', restated: 'r' };
        return { content: JSON.stringify(reply) };
      };
      const result = await translate(q.question, ctx, model);
      expect(scoreCase(q.expected, result), q.id).toBe(true);
      // A blank question never reaches the model.
      if (!q.question.trim()) expect(calls, q.id).toBe(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import evalSet from '../eval/questions.json';
import type { CatalogChoice } from '../../src/engine/catalog';
import { checkAgainstCatalog, normaliseQuestion, scoreCase, translate, type ChatFn } from '../../src/engine/translate';
import { DEMO_CATALOG, DEMO_EXAMPLES, DEMO_TOOL_NAME } from '../../src/seed/demo-catalog';

/**
 * The 40-question set's shape (spec section 19), checked offline: no model is called. Whether the real model
 * maps these questions correctly is measured on demand on the development site, never in this suite.
 */

interface Question {
  id: string;
  group: string;
  question: string;
  expected: CatalogChoice[] | null;
}

const questions = evalSet.questions as Question[];
const groups = evalSet.groups as Record<string, { target: number; bar: string }>;
const SPEC_GROUPS = { plain: 20, pair: 6, outside: 6, injection: 5, environment: 3 };

describe('the eval set', () => {
  it('has the spec groups and targets, adding up to 40, and no group over its target', () => {
    expect(Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, v.target]))).toEqual(SPEC_GROUPS);
    expect(Object.values(SPEC_GROUPS).reduce((a, b) => a + b, 0)).toBe(40);
    for (const q of questions) expect(Object.keys(SPEC_GROUPS), q.id).toContain(q.group);
    for (const [g, target] of Object.entries(SPEC_GROUPS)) expect(questions.filter((q) => q.group === g).length, g).toBeLessThanOrEqual(target);
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

import { describe, expect, it, vi } from 'vitest';
import { includes, like, ok, same, throws } from '../../src/safety/assert';
import { SAFETY_CASES } from '../../src/safety/cases';
import { runSafetySuite } from '../../src/safety/run';
import { handleRunSafety } from '../../src/resolvers/safety-handlers';

/**
 * The false-Yes suite runnable in the app (spec section 19: "also runnable from the Setup screen"; P0-7). The
 * build and Setup run the same case list, so the helpers that replace vitest's expect must fail exactly
 * where expect would: a helper that never fails would make every case pass.
 */

describe('assertion helpers', () => {
  it('same: strict equality', () => {
    expect(() => same(1, 1, 'n')).not.toThrow();
    expect(() => same('yes', 'yes', 'v')).not.toThrow();
    expect(() => same(1, 2, 'n')).toThrow(/n: expected 2, got 1/);
    expect(() => same('1', 1, 'n')).toThrow();
    expect(() => same(null, undefined, 'n')).toThrow();
  });

  it('like: every expected field matches, as toMatchObject does', () => {
    expect(() => like({ a: 1, b: 2 }, { a: 1 }, 'x')).not.toThrow();
    expect(() => like({ a: { b: 1, c: 2 } }, { a: { b: 1 } }, 'x')).not.toThrow();
    expect(() => like({ a: [{ k: 1, z: 0 }] }, { a: [{ k: 1 }] }, 'x')).not.toThrow();
    expect(() => like({ a: 1 }, { a: 2 }, 'x')).toThrow(/x/);
    expect(() => like({ a: { b: 1 } }, { a: { b: 2 } }, 'x')).toThrow();
    expect(() => like({}, { a: undefined }, 'x')).toThrow(); // a missing key is not an undefined one
    expect(() => like({ a: [1, 2] }, { a: [1] }, 'x')).toThrow(); // arrays: same length
    expect(() => like({ a: [1] }, { a: [2] }, 'x')).toThrow();
    expect(() => like(null, { a: 1 }, 'x')).toThrow();
    expect(() => like('yes', { a: 1 }, 'x')).toThrow();
    expect(() => like({ a: 'yes' }, { a: { b: 1 } }, 'x')).toThrow();
  });

  it('throws: passes only when the function throws', () => {
    expect(() =>
      throws(() => {
        throw new Error('no');
      }, 'f'),
    ).not.toThrow();
    expect(() => throws(() => undefined, 'f')).toThrow(/f/);
  });

  it('ok: passes only on true', () => {
    expect(() => ok(true, 'c')).not.toThrow();
    expect(() => ok(false, 'c')).toThrow(/c/);
  });

  it('includes: substring', () => {
    expect(() => includes('KS-DEV 13.2', '13.2', 's')).not.toThrow();
    expect(() => includes('KS-DEV', '14.0', 's')).toThrow(/s/);
  });
});

describe('the case list', () => {
  it('holds every case of the build suite, with unique ids, covering spec cases 1 to 13', () => {
    expect(SAFETY_CASES.length).toBe(49);
    expect(new Set(SAFETY_CASES.map((c) => c.id)).size).toBe(SAFETY_CASES.length);
    for (let n = 1; n <= 13; n++) expect(SAFETY_CASES.some((c) => c.group.startsWith(`${n}. `)), `case ${n}`).toBe(true);
  });
});

describe('runSafetySuite', () => {
  it('runs every case against the engine and reports each result', async () => {
    const run = await runSafetySuite();
    expect(run.failed).toEqual([]);
    expect(run).toMatchObject({ total: 49, passed: 49 });
    expect(run.groups.reduce((n, g) => n + g.total, 0)).toBe(49);
    expect(run.groups[0]).toMatchObject({ group: SAFETY_CASES[0]!.group });
  });

  it('a failing case is reported with its reason; the run carries on', async () => {
    const run = await runSafetySuite([
      { id: 'a', group: '1. g', title: 'fails', run: () => same('yes', 'dont_know', 'verdict') },
      { id: 'b', group: '1. g', title: 'throws a string', run: () => Promise.reject('boom') },
      { id: 'c', group: '2. h', title: 'passes', run: async () => undefined },
    ]);
    expect(run).toMatchObject({ total: 3, passed: 1 });
    expect(run.failed).toEqual([
      { id: 'a', group: '1. g', title: 'fails', reason: 'verdict: expected "dont_know", got "yes"' },
      { id: 'b', group: '1. g', title: 'throws a string', reason: 'boom' },
    ]);
    expect(run.groups).toEqual([
      { group: '1. g', total: 2, passed: 0 },
      { group: '2. h', total: 1, passed: 1 },
    ]);
  });
});

describe('the runSafety resolver', () => {
  it('Jira administrators only; runs the suite and logs the count', async () => {
    const log = vi.fn();
    const run = vi.fn(async () => ({ total: 1, passed: 1, failed: [], groups: [{ group: '1. g', total: 1, passed: 1 }] }));
    expect(await handleRunSafety({ accountId: 'acct-admin' }, { check: { isJiraAdmin: async () => true }, run, log })).toEqual({
      ok: true,
      total: 1,
      passed: 1,
      failed: [],
      groups: [{ group: '1. g', total: 1, passed: 1 }],
    });
    expect(log).toHaveBeenCalledWith('[runSafety] passed=1/1');

    const notRun = vi.fn();
    expect(await handleRunSafety({ accountId: 'acct-priya' }, { check: { isJiraAdmin: async () => false }, run: notRun, log })).toMatchObject({ ok: false });
    expect(notRun).not.toHaveBeenCalled();
  });
});

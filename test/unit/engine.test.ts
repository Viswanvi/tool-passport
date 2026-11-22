import { describe, expect, it } from 'vitest';
import { canPick } from '../../src/engine/audience';
import { compare, matches } from '../../src/engine/evaluate';
import { expand } from '../../src/engine/expand';
import type { CatalogKey, Check, CheckResult, CheckStatus, Environment, Groups, RuleRow } from '../../src/engine/model';
import { knownGroups, mostSpecific } from '../../src/engine/select';
import { combine } from '../../src/engine/verdict';
import { demoWorld, DEV } from '../support/demo-world';

const r = (status: CheckStatus, n = 0): CheckResult => ({
  check: { dimension: 'capability', key: `k${n}` },
  status,
  label: status === 'unknown' ? { kind: 'not_verified', missing: 'x' } : { kind: 'default_policy' },
});

describe('combine()', () => {
  it('refuses an empty list', () => {
    expect(() => combine([])).toThrow();
  });

  it('applies the five rules in order for every pairing', () => {
    const order: CheckStatus[] = ['fail', 'unknown', 'missing', 'approval', 'pass'];
    const verdictFor: Record<CheckStatus, string> = { fail: 'no', unknown: 'dont_know', missing: 'not_ready', approval: 'yes_with_approval', pass: 'yes' };
    for (const a of order) {
      for (const b of order) {
        const strongest = order[Math.min(order.indexOf(a), order.indexOf(b))]!;
        expect(combine([r(a, 1), r(b, 2)]).verdict, `${a} + ${b}`).toBe(verdictFor[strongest]);
      }
    }
  });

  it('fail with not verified is No, naming the failing check', () => {
    const out = combine([r('unknown', 1), r('fail', 2)]);
    expect(out).toMatchObject({ verdict: 'no', because: [{ check: { key: 'k2' } }] });
  });

  it('not verified with missing is Don\'t know yet, listing the missing item', () => {
    const out = combine([r('missing', 1), r('unknown', 2)]);
    expect(out).toMatchObject({ verdict: 'dont_know', unknown: [{ check: { key: 'k2' } }], alsoMissing: [{ check: { key: 'k1' } }] });
  });

  it('missing with approval is Not ready, with the approval next', () => {
    const out = combine([r('approval', 1), r('missing', 2)]);
    expect(out).toMatchObject({ verdict: 'not_ready', fixes: [{ check: { key: 'k2' } }], next: [{ check: { key: 'k1' } }] });
  });

  it('refuses a status it does not know rather than saying Yes', () => {
    expect(() => combine([r('pass'), { ...r('pass'), status: 'maybe' as CheckStatus }])).toThrow();
  });
});

describe('mostSpecific()', () => {
  const rule = (id: number, environmentId: number | null, audienceGroup: string | null, effect: RuleRow['effect'], status: RuleRow['status'] = 'active'): RuleRow => ({
    id,
    toolId: 1,
    actionKey: 'a',
    environmentId,
    audienceGroup,
    effect,
    status,
    approvalRoute: null,
    reason: null,
    revision: 1,
  });
  const me: Groups = { ok: true, names: ['g'] };
  const pick = (rows: RuleRow[], groups: Groups = me, env: number | null = DEV) => {
    const s = mostSpecific(rows, env, groups);
    return 'row' in s ? s.row?.id ?? null : s.why;
  };

  it('environment and group, then environment, then group, then everyone', () => {
    const all = [rule(1, null, null, 'allow'), rule(2, null, 'g', 'allow'), rule(3, DEV, null, 'allow'), rule(4, DEV, 'g', 'allow')];
    expect(pick(all)).toBe(4);
    expect(pick(all.slice(0, 3))).toBe(3);
    expect(pick(all.slice(0, 2))).toBe(2);
    expect(pick(all.slice(0, 1))).toBe(1);
  });

  it('deny beats approval beats allow at the same level', () => {
    expect(pick([rule(1, DEV, null, 'allow'), rule(2, DEV, null, 'deny'), rule(3, DEV, null, 'approval')])).toBe(2);
    expect(pick([rule(1, DEV, null, 'allow'), rule(3, DEV, null, 'approval')])).toBe(3);
  });

  it('a more specific allow still beats a broader deny', () => {
    expect(pick([rule(1, null, null, 'deny'), rule(2, DEV, null, 'allow')])).toBe(2);
  });

  it('ignores retired rows, other environments and groups the person is not in', () => {
    expect(pick([rule(1, DEV, null, 'deny', 'retired'), rule(2, null, null, 'allow')])).toBe(2);
    expect(pick([rule(1, 99, null, 'deny'), rule(2, null, null, 'allow')])).toBe(2);
    expect(pick([rule(1, DEV, 'other', 'deny'), rule(2, null, null, 'allow')])).toBe(2);
    expect(pick([rule(1, DEV, 'other', 'deny')])).toBeNull();
  });

  it('unknown groups: refuses when a group-scoped row exists, otherwise uses the everyone rows', () => {
    expect(pick([rule(1, null, 'g', 'deny'), rule(2, DEV, null, 'allow')], { ok: false })).toBe('groups');
    expect(pick([rule(2, DEV, null, 'allow')], { ok: false })).toBe(2);
    expect(pick([rule(1, null, 'g', 'deny'), rule(2, DEV, null, 'allow')], { ok: true, names: [] })).toBe('groups');
  });

  it('an effect it does not know wins over allow (and the policy check then refuses it)', () => {
    expect(pick([rule(1, DEV, null, 'allow'), rule(2, DEV, null, 'maybe' as RuleRow['effect'])])).toBe(2);
  });

  it('two facts at the same level are a conflict', () => {
    const fact = (id: number, audienceGroup: string | null) => ({ id, environmentId: null, audienceGroup, status: 'active' as const });
    const s = mostSpecific([fact(1, 'g'), fact(2, 'h')], DEV, { ok: true, names: ['g', 'h'] });
    expect(s).toMatchObject({ why: 'conflict' });
    expect(mostSpecific([fact(1, 'g'), fact(2, null)], DEV, { ok: true, names: ['g'] })).toMatchObject({ row: { id: 1 } });
  });

  it('knownGroups treats failure, an empty list and a missing list as unknown', () => {
    expect(knownGroups({ ok: false })).toBeNull();
    expect(knownGroups({ ok: true, names: [] })).toBeNull();
    expect(knownGroups({ ok: true } as unknown as Groups)).toBeNull();
    expect(knownGroups({ ok: true, names: ['g'] })).toEqual(['g']);
  });
});

describe('expand()', () => {
  const w = demoWorld();
  const dev = w.environments.find((e) => e.id === DEV)!;
  const dims = (checks: Check[]) => checks.map((c) => `${c.dimension}:${'key' in c ? c.key : c.action}`);

  it('adds policy, access and readiness from the links, whatever the model returned', () => {
    expect(dims(expand([{ key: 'web_frontend' }], w.catalog, dev))).toEqual([
      'capability:web_frontend',
      'policy:custom_ui',
      'access:custom_ui',
      'environment:frontend_build',
    ]);
  });

  it('keeps the asked value on the capability check', () => {
    expect(expand([{ key: 'max_upload_gb', value: 3 }], w.catalog, dev)).toEqual([
      { dimension: 'capability', key: 'max_upload_gb', value: 3 },
      { dimension: 'environment', key: 'uploads' },
    ]);
  });

  it('"Any environment" runs the capability check only', () => {
    expect(dims(expand([{ key: 'web_frontend' }], w.catalog, null))).toEqual(['capability:web_frontend']);
  });

  it('an unrecorded link becomes an unlinked check', () => {
    expect(dims(expand([{ key: 'gpu_compute' }], w.catalog, dev))).toEqual(['capability:gpu_compute', 'unlinked:gpu_compute']);
  });

  it('checks an action shared by two capabilities once', () => {
    const catalog = { ...w.catalog, links: new Map(w.catalog.links) };
    catalog.links.set('runtime_3_9', { capabilityKey: 'runtime_3_9', actions: ['custom_ui'], readinessKeys: ['frontend_build'] });
    const checks = dims(expand([{ key: 'web_frontend' }, { key: 'runtime_3_9' }], catalog, dev));
    expect(checks.filter((c) => c === 'policy:custom_ui')).toHaveLength(1);
    expect(checks.filter((c) => c === 'environment:frontend_build')).toHaveLength(1);
  });
});

describe('compare() and matches()', () => {
  const key = (comparison: CatalogKey['comparison'], valueType: CatalogKey['valueType']): CatalogKey => ({
    key: 'k',
    kind: 'capability',
    label: 'K',
    comparison,
    valueType,
    requiresValue: comparison !== 'has',
    synonyms: [],
  });

  it('has: only a stored boolean counts', () => {
    expect(compare(key('has', 'boolean'), true, undefined)).toBe(true);
    expect(compare(key('has', 'boolean'), false, undefined)).toBe(false);
    expect(compare(key('has', 'boolean'), 'yes', undefined)).toBe('bad_stored');
  });

  it('gte: the recorded limit must be at least what was asked', () => {
    expect(compare(key('gte', 'number'), 2, 3)).toBe(false);
    expect(compare(key('gte', 'number'), 2, 2)).toBe(true);
    expect(compare(key('gte', 'number'), 2, 0.5)).toBe(true);
    expect(compare(key('gte', 'number'), '2', 1)).toBe('bad_stored');
    expect(compare(key('gte', 'number'), 2, '1')).toBe('bad_asked');
    expect(compare(key('lte', 'number'), 2, 3)).toBe(true);
  });

  it('eq compares like with like', () => {
    expect(compare(key('eq', 'text'), 'Standard', 'standard ')).toBe(true);
    expect(compare(key('eq', 'number'), 3, 3)).toBe(true);
    expect(compare(key('eq', 'number'), 3, '3')).toBe('bad_asked');
    expect(compare(key('eq', 'text'), 3, '3')).toBe('bad_stored');
  });

  it('readiness: has / eq / gte on attribute values', () => {
    expect(matches(['standard', 'Frontend'], { match: 'has', expected: 'frontend' })).toBe(true);
    expect(matches([], { match: 'has', expected: 'frontend' })).toBe(false);
    expect(matches(['a', 'b'], { match: 'eq', expected: 'a' })).toBe(false);
    expect(matches(['8'], { match: 'gte', expected: '4' })).toBe(true);
    expect(matches(['many'], { match: 'gte', expected: '4' })).toBe('unreadable');
    expect(matches('frontend', { match: 'has', expected: 'frontend' })).toBe('unreadable');
    expect(matches(['x'], { match: 'like' as 'has', expected: 'x' })).toBe('unreadable');
  });
});

describe('canPick()', () => {
  const env = (audienceGroup: string | null): Environment => ({ ...demoWorld().environments[0]!, audienceGroup });
  it('anyone may pick an environment with no audience; others need confirmed membership', () => {
    expect(canPick(env(null), { ok: false })).toEqual({ ok: true });
    expect(canPick(env('g'), { ok: true, names: ['g'] })).toEqual({ ok: true });
    expect(canPick(env('g'), { ok: true, names: ['h'] }).ok).toBe(false);
    expect(canPick(env('g'), { ok: false }).ok).toBe(false);
  });
});

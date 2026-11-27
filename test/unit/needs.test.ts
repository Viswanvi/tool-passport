import { describe, expect, it } from 'vitest';
import { needsOf } from '../../src/frontend/needs';
import { builtLines } from '../../src/frontend/setup-text';
import type { QuickPlan } from '../../src/resolvers/quick-setup';

/** The owner's "Needs you" counts (D62) and the setup's "Built for you" lines (D61): both only restate server replies. */

describe('Needs you, on My tools', () => {
  const change = (environment: string, from: string, to: string, n: number) => ({ environment, from, to, toRecheck: Array.from({ length: n }, (_, i) => i) });

  it('counts open questions, facts to re-check and capabilities nobody has verified, from the same replies as the tabs', () => {
    const needs = needsOf({
      questions: { ok: true, groups: [{}, {}] },
      // Newest first, as the server lists them; a change with nothing left to re-check doesn't count.
      changes: { ok: true, changes: [change('KS-DEV', '13.2', '14.0', 3), change('KS-PROD', '13.1', '13.2', 0), change('KS-DEV', '13.1', '13.2', 1)] },
      passport: {
        ok: true,
        rows: [
          { cells: [{ verdict: 'dont_know' }, { verdict: 'dont_know' }] },
          { cells: [{ verdict: 'dont_know' }, { verdict: 'yes' }] },
          { cells: [{ verdict: 'no' }, { verdict: 'no' }] },
        ],
      },
    });
    expect(needs).toEqual({ questions: 2, recheck: 4, moved: 'KS-DEV moved from 13.2 to 14.0', unverified: 1 });
  });

  it('a reply that failed or was refused is unknown, never zero', () => {
    expect(needsOf({ questions: null, changes: { ok: false }, passport: { ok: false } })).toEqual({ questions: null, recheck: null, moved: null, unverified: null });
  });

  it('nothing waiting is zero', () => {
    expect(needsOf({ questions: { ok: true, groups: [] }, changes: { ok: true, changes: [] }, passport: { ok: true, rows: [] } })).toEqual({
      questions: 0,
      recheck: 0,
      moved: null,
      unverified: 0,
    });
  });
});

describe('Built for you, after one-click setup', () => {
  const plan: QuickPlan = {
    ok: true,
    ready: true,
    requests: { state: 'will_set', desk: 'Tool Passport Desk', requestType: 'Get IT help' },
    approvals: { state: 'will_set', approve: ['Done'], decline: ['Declined'] },
    demo: { state: 'will_load' },
    helpCenter: { state: 'will_set' },
  };
  const seed = {
    ok: true as const,
    toolId: 1,
    environments: [
      { name: 'KS-DEV', providerRef: 'TPENV-1' },
      { name: 'KS-PROD', providerRef: 'TPENV-2' },
    ],
    counts: { tools: 1, environments: 2, catalogKeys: 25, links: 18, facts: 15, rules: 14, readinessKeys: 4, accessMappings: 10, assetsRecordsCreated: 2, groupsCreated: 2, addedToGroup: 1 },
  };

  it('says what the click wrote, with the counts the load returned', () => {
    const lines = builtLines({ ok: true, did: ['requests', 'approvals', 'helpCenter', 'demo'], seed }, plan);
    expect(lines).toEqual([
      'Assets: KS-DEV and KS-PROD as records in the Tool Passport Environments schema (TPENV-1, TPENV-2), made now. Version, setup and features are read from there on every check.',
      'Kestrel Studio, with you as its owner: 25 catalog entries, the only words the AI may map a question to.',
      '18 capabilities linked to the checks that decide them.',
      '15 verified facts, each tied to the tool version it was checked on.',
      '14 policy rules, 4 setup checks and 10 access mappings.',
      '2 groups made (kestrel-dev-builders, kestrel-prod-deployers), and you joined kestrel-dev-builders.',
      'Requests: fixes, approvals and questions go to Tool Passport Desk as “Get IT help”, private to the asker.',
      'Approvals: resolution “Done” approves; anything else leaves the approval pending.',
      'Help center: “Can I…?” is on for signed-in people.',
    ]);
  });

  it('in registry mode names no Assets; a step the click did not take is not claimed', () => {
    const registry = { ...seed, environments: seed.environments.map((e) => ({ ...e, providerRef: 'Recorded by owner' })), warnings: ['The demo groups could not be made'] };
    const lines = builtLines({ ok: true, did: ['demo'], seed: registry }, plan);
    expect(lines[0]).toBe('KS-DEV and KS-PROD: their version, setup and features recorded by you, the owner (registry mode, no Assets).');
    expect(lines.some((l) => l.startsWith('Requests') || l.startsWith('Approvals') || l.startsWith('Help center') || l.includes('groups'))).toBe(false);
  });
});

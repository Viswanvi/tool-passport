import { describe, expect, it } from 'vitest';
import type { RequestSetup } from '../../src/loop/requests';
import type { ResolutionMap } from '../../src/loop/resolution';
import type { WriteCheck } from '../../src/registry/authorise';
import { handleQuickSetup, handleQuickSetupPlan, type QuickSetupDeps } from '../../src/resolvers/quick-setup';
import type { HelpCenterSetting } from '../../src/resolvers/help-handlers';
import type { SeedResult } from '../../src/seed/demo';

/**
 * One-click setup (the Setup page's first panel): it proposes, in words, exactly what it would set, and sets it
 * only on the administrator's click. The server works the plan out again on the click: the page sends only the
 * mode. It never guesses between two desks, only the resolution named Done ever approves, and it turns the help
 * center box on only if no administrator has chosen there (D57).
 */

const ADMIN = 'admin-1';
const ON: HelpCenterSetting = { on: true, by: 'admin-0', at: '2026-11-27T09:00:00.000Z' };
const OFF: HelpCenterSetting = { on: false, by: 'admin-0', at: '2026-11-27T09:00:00.000Z' };

function fakes(over: Partial<{ desks: Array<{ id: string; name: string }>; types: Array<{ id: string; name: string }> | null; setup: RequestSetup | null; names: string[]; by: 'resolution' | 'status'; map: ResolutionMap | null; demo: boolean; seedFails: boolean; isAdmin: boolean; help: HelpCenterSetting | null }> = {}) {
  const s = {
    desks: [{ id: '1', name: 'Tool Passport Desk' }],
    types: [
      { id: '10', name: 'Emailed request' },
      { id: '11', name: 'Get IT help' },
    ] as Array<{ id: string; name: string }> | null,
    setup: null as RequestSetup | null,
    names: ['Done', "Won't Do", 'Declined'],
    by: 'resolution' as 'resolution' | 'status',
    map: null as ResolutionMap | null,
    demo: false,
    seedFails: false,
    isAdmin: true,
    help: null as HelpCenterSetting | null,
    ...over,
  };
  const saved: { setup: RequestSetup[]; map: Array<Record<string, string>>; seeded: Array<[string, string]>; help: HelpCenterSetting[] } = { setup: [], map: [], seeded: [], help: [] };
  const deps: QuickSetupDeps = {
    check: { isJiraAdmin: async () => s.isAdmin } satisfies WriteCheck,
    desks: async () => s.desks,
    usableRequestTypes: async (id) => (s.desks.some((d) => d.id === id) ? s.types : null),
    getSetup: async () => s.setup,
    saveSetup: async (x) => {
      saved.setup.push(x);
      s.setup = x;
    },
    decisionNames: async () => ({ by: s.by, names: s.names.map((n, i) => ({ id: String(i), name: n })) }),
    getMap: async () => s.map,
    saveMap: async (m) => {
      saved.map.push(m);
      s.map = m as ResolutionMap;
    },
    demoTool: async () => (s.demo ? { id: 1, mode: 'assets' } : null),
    seed: async (actor, mode): Promise<SeedResult> => {
      saved.seeded.push([actor, mode]);
      if (s.seedFails) throw new Error('Assets unreachable');
      s.demo = true;
      return { ok: true, toolId: 1, environments: [], counts: { tools: 1 } };
    },
    helpCenter: async () => s.help,
    saveHelpCenter: async (v) => {
      saved.help.push(v);
      s.help = v;
    },
    now: () => '2026-11-27T10:00:00.000Z',
  };
  return { deps, saved, s };
}

describe('the plan', () => {
  it('on a fresh site with one desk: that desk, Get IT help, Done approves, Declined declines, load the demo, help center on', async () => {
    const { deps } = fakes();
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, deps)).toEqual({
      ok: true,
      ready: true,
      requests: { state: 'will_set', desk: 'Tool Passport Desk', requestType: 'Get IT help' },
      approvals: { state: 'will_set', approve: ['Done'], decline: ['Declined'] },
      demo: { state: 'will_load' },
      helpCenter: { state: 'will_set' },
    });
  });

  it('keeps what is already set and says so', async () => {
    const { deps } = fakes({ setup: { serviceDeskId: '1', requestTypeIds: { fix: '10' } }, map: { Done: 'approved', Declined: 'declined' }, demo: true, help: ON });
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, deps)).toMatchObject({
      ready: false,
      requests: { state: 'done', desk: 'Tool Passport Desk', requestType: 'Emailed request' },
      approvals: { state: 'done', approve: ['Done'], decline: ['Declined'] },
      demo: { state: 'done' },
      helpCenter: { state: 'done' },
    });
  });

  it("keeps an administrator's own choice to keep the help center off", async () => {
    const { deps } = fakes({ setup: { serviceDeskId: '1', requestTypeIds: { fix: '10' } }, map: { Done: 'approved' }, demo: true, help: OFF });
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, deps)).toMatchObject({ ready: false, helpCenter: { state: 'off' } });
  });

  it('never picks between two desks; with no single desk, requests wait but the demo can still load (D56)', async () => {
    const two = fakes({ desks: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] });
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, two.deps)).toMatchObject({
      ready: true,
      requests: { state: 'blocked', reason: expect.stringContaining('more than one') },
      approvals: { state: 'manual' },
      demo: { state: 'will_load' },
    });
    const none = fakes({ desks: [] });
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, none.deps)).toMatchObject({
      ready: true,
      requests: { state: 'blocked', reason: expect.stringContaining('No service desk yet. You can load the demo and ask now') },
    });
    // Demo already in and still no desk: nothing for one click to do.
    const loaded = fakes({ desks: [], demo: true, help: ON });
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, loaded.deps)).toMatchObject({ ready: false, demo: { state: 'done' } });
  });

  it('with no request type that needs only a summary and a description, requests wait', async () => {
    const { deps } = fakes({ types: [] });
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, deps)).toMatchObject({ ready: true, requests: { state: 'blocked' } });
  });

  it('falls back to the first usable request type when there is no Get IT help', async () => {
    const { deps } = fakes({ types: [{ id: '12', name: 'Ask a question' }] });
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, deps)).toMatchObject({ requests: { requestType: 'Ask a question' } });
  });

  it('maps approvals only from a resolution named Done; anything else stays for the administrator', async () => {
    for (const over of [{ names: ['Fixed', 'Declined'] }, { names: [] }, { by: 'status' as const, names: ['Done', 'Canceled'] }]) {
      const { deps } = fakes(over);
      const plan = await handleQuickSetupPlan({ accountId: ADMIN }, deps);
      expect(plan).toMatchObject({ ready: true, approvals: { state: 'manual', approve: [], decline: [] } });
    }
    const noDeclined = fakes({ names: ['done'] });
    expect(await handleQuickSetupPlan({ accountId: ADMIN }, noDeclined.deps)).toMatchObject({ approvals: { state: 'will_set', approve: ['done'], decline: [] } });
  });

  it('is for Jira administrators only', async () => {
    const { deps } = fakes({ isAdmin: false });
    expect(await handleQuickSetupPlan({ accountId: 'someone' }, deps)).toMatchObject({ ok: false });
    expect(await handleQuickSetupPlan({}, deps)).toMatchObject({ ok: false });
  });
});

describe('the click', () => {
  it('sets requests, approvals and the help center, then loads the demo, as the person clicking', async () => {
    const { deps, saved } = fakes();
    const r = await handleQuickSetup({ mode: 'assets' }, { accountId: ADMIN }, deps);
    expect(r).toMatchObject({ ok: true, did: ['requests', 'approvals', 'helpCenter', 'demo'], seed: { ok: true } });
    expect(saved.help).toEqual([{ on: true, by: ADMIN, at: '2026-11-27T10:00:00.000Z' }]);
    expect(saved.setup).toEqual([{ serviceDeskId: '1', requestTypeIds: { fix: '11' } }]);
    expect(saved.map).toEqual([{ Done: 'approved', Declined: 'declined' }]);
    expect(saved.seeded).toEqual([[ADMIN, 'assets']]);
  });

  it('works the plan out again on the server, ignoring anything else in the payload', async () => {
    const { deps, saved } = fakes();
    await handleQuickSetup({ mode: 'registry', serviceDeskId: '2', requestTypeId: '10', map: { Fixed: 'approved' }, accountId: 'x' }, { accountId: ADMIN }, deps);
    expect(saved.setup).toEqual([{ serviceDeskId: '1', requestTypeIds: { fix: '11' } }]);
    expect(saved.map).toEqual([{ Done: 'approved', Declined: 'declined' }]);
    expect(saved.seeded).toEqual([[ADMIN, 'registry']]);
  });

  it('changes nothing that is already set, and a second click does nothing', async () => {
    const { deps, saved } = fakes({ setup: { serviceDeskId: '1', requestTypeIds: { fix: '10', approval: '10' } }, map: { Resolved: 'approved' }, help: OFF });
    expect(await handleQuickSetup({ mode: 'assets' }, { accountId: ADMIN }, deps)).toMatchObject({ ok: true, did: ['demo'] });
    expect(saved.help).toEqual([]);
    expect(saved.setup).toEqual([]);
    expect(saved.map).toEqual([]);
    expect(await handleQuickSetup({ mode: 'assets' }, { accountId: ADMIN }, deps)).toMatchObject({ ok: true, did: [] });
    expect(saved.seeded).toHaveLength(1);
  });

  it('with no service desk yet, loads the demo only and says how to finish requests (D56)', async () => {
    const { deps, saved } = fakes({ desks: [] });
    expect(await handleQuickSetup({ mode: 'assets' }, { accountId: ADMIN }, deps)).toMatchObject({
      ok: true,
      did: ['helpCenter', 'demo'],
      later: expect.stringContaining('create one'),
    });
    expect(saved).toMatchObject({ setup: [], map: [], seeded: [[ADMIN, 'assets']] });
    expect(saved.help).toHaveLength(1);
  });

  it('with the demo in and still no desk, says what is missing and writes nothing', async () => {
    const { deps, saved } = fakes({ desks: [], demo: true, help: ON });
    expect(await handleQuickSetup({ mode: 'assets' }, { accountId: ADMIN }, deps)).toMatchObject({ ok: false, reason: expect.stringContaining('No service desk yet') });
    expect(saved).toEqual({ setup: [], map: [], seeded: [], help: [] });
  });

  it('with the demo in, no desk and the help center never chosen, turns the help center on and says what is left', async () => {
    const { deps, saved } = fakes({ desks: [], demo: true });
    expect(await handleQuickSetup({ mode: 'assets' }, { accountId: ADMIN }, deps)).toMatchObject({ ok: true, did: ['helpCenter'], later: expect.stringContaining('No service desk yet') });
    expect(saved).toMatchObject({ setup: [], map: [], seeded: [] });
  });

  it('after a desk is made, a second click sets requests and approvals and keeps the demo', async () => {
    const { deps, saved } = fakes({ demo: true, help: ON });
    expect(await handleQuickSetup({ mode: 'assets' }, { accountId: ADMIN }, deps)).toMatchObject({ ok: true, did: ['requests', 'approvals'] });
    expect(saved.seeded).toEqual([]);
  });

  it('a demo load that stops part way says so, keeping what was set', async () => {
    const { deps, saved } = fakes({ seedFails: true });
    const r = await handleQuickSetup({ mode: 'assets' }, { accountId: ADMIN }, deps);
    expect(r).toMatchObject({ ok: false, did: ['requests', 'approvals', 'helpCenter'], reason: expect.stringContaining('safe to repeat') });
    expect(saved.setup).toHaveLength(1);
  });

  it('is for Jira administrators only and writes nothing otherwise', async () => {
    const { deps, saved } = fakes({ isAdmin: false });
    expect(await handleQuickSetup({ mode: 'assets' }, { accountId: 'someone' }, deps)).toMatchObject({ ok: false });
    expect(saved).toEqual({ setup: [], map: [], seeded: [], help: [] });
  });
});

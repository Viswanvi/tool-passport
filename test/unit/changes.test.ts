import { describe, expect, it } from 'vitest';
import { buildRecheckList, detectVersions, sweepChanges, type ChangeRecord, type ChangeRepo } from '../../src/change/changes';
import { noteVersion, type ChangeRow, type DetectRepo } from '../../src/change/detect';
import { answerQuestion } from '../../src/engine/answer';
import type { Environment } from '../../src/engine/model';
import { handleChanges, handleRecentAsks, handleStillTrue, type ChangeDeps, type RecentAsk } from '../../src/resolvers/change-handlers';
import { handleEdit, type EditDeps } from '../../src/resolvers/edit-handlers';
import { askInput, demoWorld, depsFor, DEV, MARCO, modelReplying, picks, PRIYA, PROD, SAM, type World } from '../support/demo-world';
import { loopWorld, memoryWriter } from '../support/fix-world';

/**
 * Version validity (spec F6, section 11 "Version validity", section 16 moment 3, section 19 change-detection
 * test). Answers compare versions at read time, so they are right whether or not any of this runs; this code
 * only builds the owner's re-verify list and the "may have changed" badges.
 */

// ---- in-memory change tables over the demo world ----

interface MemAsk {
  id: number;
  environmentId: number;
  factVersionIds: number[];
  daysAgo: number;
  mayHaveChanged: boolean;
}

function memoryChanges(w: World, asks: MemAsk[] = []) {
  const changes: Array<ChangeRecord & { baselineAt: string }> = [];
  const items: Array<{ changeId: number; kind: 'fact' | 'ask'; refId: number; status: 'open' | 'done' }> = [];
  let failNext = 0;
  const detect: DetectRepo = {
    async setBaseline(id, version) {
      const e = w.environments.find((x) => x.id === id)!;
      if (e.lastSeenVersion !== null) return false;
      Object.assign(e, { lastSeenVersion: version, lastSeenAt: `t${changes.length}` });
      return true;
    },
    async insertChangeIgnoreDuplicate(row: ChangeRow) {
      if (changes.some((c) => c.environmentId === row.environmentId && c.baselineAt === row.baselineAt && c.toVersion === row.toVersion)) return;
      changes.push({ id: changes.length + 1, ...row, status: 'open', attempts: 0, error: null, createdAt: `2026-11-24T1${changes.length}:00:00.000Z` });
    },
    async compareAndSetVersion(id, from, to) {
      const e = w.environments.find((x) => x.id === id)!;
      if (e.lastSeenVersion !== from) return false;
      Object.assign(e, { lastSeenVersion: to, lastSeenAt: `seen-${to}-${changes.length}` });
      return true;
    },
  };
  const repo: ChangeRepo = {
    async openChanges(limit) {
      return changes.filter((c) => c.status === 'open').slice(0, limit);
    },
    async changesFor(toolId, limit) {
      return changes.filter((c) => c.toolId === toolId).reverse().slice(0, limit);
    },
    async changeById(id) {
      return changes.find((c) => c.id === id) ?? null;
    },
    async factsInScope(toolId, environmentId) {
      if (failNext > 0) {
        failNext -= 1;
        throw new Error('SQL timed out');
      }
      return w.facts
        .filter((f) => f.toolId === toolId && f.status === 'active' && (f.environmentId === null || f.environmentId === environmentId))
        .map((f) => ({ ...f, versions: w.factVersions.filter((v) => v.factId === f.id && v.status === 'active') }));
    },
    async addRecheckItems(changeId, kind, refIds) {
      for (const refId of refIds) if (!items.some((i) => i.changeId === changeId && i.kind === kind && i.refId === refId)) items.push({ changeId, kind, refId, status: 'open' });
    },
    async openRecheckFacts(changeId) {
      return items.filter((i) => i.changeId === changeId && i.kind === 'fact' && i.status === 'open').map((i) => i.refId);
    },
    async closeFactRechecks(factId, version) {
      for (const i of items) {
        const c = changes.find((x) => x.id === i.changeId);
        if (i.kind === 'fact' && i.refId === factId && i.status === 'open' && c?.toVersion === version) i.status = 'done';
      }
    },
    async recentAsks(environmentId, days) {
      return asks.filter((a) => a.environmentId === environmentId && a.daysAgo <= days).map((a) => ({ id: a.id, factVersionIds: a.factVersionIds }));
    },
    async markMayHaveChanged(askIds) {
      for (const a of asks) if (askIds.includes(a.id)) a.mayHaveChanged = true;
    },
    async setStatus(changeId, status, error) {
      Object.assign(changes.find((c) => c.id === changeId)!, { status, error: error ?? null });
    },
    async bumpAttempts(changeId, error) {
      const c = changes.find((x) => x.id === changeId)!;
      c.attempts += 1;
      c.error = error;
      return c.attempts;
    },
  };
  return { changes, items, asks, detect, repo, failNextScope: (n: number) => (failNext = n) };
}

const snapshot = (w: World, envId: number) => {
  const e = w.environments.find((x) => x.id === envId)!;
  return { id: e.id, toolId: e.toolId, provider: e.provider, granularity: w.tool.versionGranularity, lastSeenVersion: e.lastSeenVersion, lastSeenAt: e.lastSeenAt };
};

const UPLOAD_3GB = picks({ key: 'max_upload_gb', value: 3 });
const verdict = async (w: World, env: number, reply: unknown = UPLOAD_3GB) => {
  const a = await answerQuestion(askInput(w, 'Can I upload a 3 GB file?', env, PRIYA), depsFor(w, modelReplying(reply)));
  return a.state === 'checked' ? a.verdict : a.state;
};
const factId = (w: World, key: string) => w.facts.find((f) => f.factKey === key && f.environmentId === null)!.id;

/** KS-DEV upgraded to 14.0 in its record, and the change noted. */
async function upgraded(asks: MemAsk[] = []) {
  const w = demoWorld();
  const m = memoryChanges(w, asks);
  w.records.get(DEV)!.Version = ['14.0'];
  await noteVersion(snapshot(w, DEV), '14.0', m.detect);
  return { w, m };
}

describe('the change-detection test (spec section 19)', () => {
  it('answers follow the record at read time: 13.2 No, 14.0 Don\'t know yet, and back to No after a rollback with no edits', async () => {
    const w = demoWorld();
    const m = memoryChanges(w);
    expect(await verdict(w, DEV)).toBe('no');
    w.records.get(DEV)!.Version = ['14.0'];
    expect(await verdict(w, DEV)).toBe('dont_know');
    expect(await verdict(w, PROD)).toBe('no'); // KS-PROD still on 13.2
    // Detection twice "in parallel" (two stale snapshots) and a crash between insert and update.
    const stale = snapshot(w, DEV);
    await Promise.all([noteVersion(stale, '14.0', m.detect), noteVersion(stale, '14.0', m.detect)]);
    await noteVersion(stale, '14.0', m.detect);
    expect(m.changes.map((c) => `${c.fromVersion}->${c.toVersion}`)).toEqual(['13.2->14.0']);
    // Roll back: the original verdict returns with no edits, and the rollback is its own transition.
    w.records.get(DEV)!.Version = ['13.2'];
    expect(await verdict(w, DEV)).toBe('no');
    await noteVersion(snapshot(w, DEV), '13.2', m.detect);
    expect(m.changes.map((c) => `${c.fromVersion}->${c.toVersion}`)).toEqual(['13.2->14.0', '14.0->13.2']);
  });
});

describe('the re-verify list', () => {
  it('lists the version-sensitive facts with no verification for the new version, and only those (moment 3)', async () => {
    const { w, m } = await upgraded();
    expect(await buildRecheckList(m.changes[0]!, m.repo)).toBe('listed');
    const listed = m.items.filter((i) => i.kind === 'fact').map((i) => w.facts.find((f) => f.id === i.refId)!.factKey);
    expect(listed.sort()).toEqual(['community_app_framework', 'max_upload_gb', 'runtime_3_9', 'web_frontend']);
    expect(m.changes[0]!.status).toBe('listed');
    // Safe to repeat: no second item.
    m.changes[0]!.status = 'open';
    await buildRecheckList(m.changes[0]!, m.repo);
    expect(m.items.filter((i) => i.kind === 'fact')).toHaveLength(4);
  });

  it('a fact already verified for the new version, or scoped to another environment, is not listed', async () => {
    const { w, m } = await upgraded();
    const web = factId(w, 'web_frontend');
    w.factVersions.push({ id: 1999, factId: web, version: '14.0', value: true, quote: null, verifiedBy: MARCO, verifiedAt: 'x', status: 'active' });
    w.facts.push({ id: 190, toolId: 1, environmentId: PROD, audienceGroup: null, status: 'active', factKey: 'gpu_compute', versionSensitive: true });
    w.factVersions.push({ id: 1998, factId: 190, version: '13.2', value: true, quote: null, verifiedBy: MARCO, verifiedAt: 'x', status: 'active' });
    await buildRecheckList(m.changes[0]!, m.repo);
    const listed = m.items.filter((i) => i.kind === 'fact').map((i) => i.refId);
    expect(listed).not.toContain(web);
    expect(listed).not.toContain(190);
  });

  it('marks recent asks in that environment whose evidence used an affected fact as "may have changed"', async () => {
    const w0 = demoWorld();
    const uploadV = w0.factVersions.find((v) => v.factId === factId(w0, 'max_upload_gb'))!.id;
    const ssoV = w0.factVersions.find((v) => v.factId === factId(w0, 'single_sign_on'))!.id;
    const asks: MemAsk[] = [
      { id: 1, environmentId: DEV, factVersionIds: [uploadV], daysAgo: 1, mayHaveChanged: false },
      { id: 2, environmentId: DEV, factVersionIds: [ssoV], daysAgo: 1, mayHaveChanged: false }, // not version-sensitive
      { id: 3, environmentId: PROD, factVersionIds: [uploadV], daysAgo: 1, mayHaveChanged: false }, // other environment
      { id: 4, environmentId: DEV, factVersionIds: [uploadV], daysAgo: 45, mayHaveChanged: false }, // too old
    ];
    const { m } = await upgraded(asks);
    await buildRecheckList(m.changes[0]!, m.repo);
    expect(asks.map((a) => a.mayHaveChanged)).toEqual([true, false, false, false]);
    expect(m.items.filter((i) => i.kind === 'ask').map((i) => i.refId)).toEqual([1]);
  });

  it('a failing list is retried, then marked failed after three tries; answers are unaffected', async () => {
    const { w, m } = await upgraded();
    m.failNextScope(3);
    expect(await sweepChanges(m.repo, 10)).toEqual({ listed: 0, failed: 0 });
    expect(await sweepChanges(m.repo, 10)).toEqual({ listed: 0, failed: 0 });
    expect(await sweepChanges(m.repo, 10)).toEqual({ listed: 0, failed: 1 });
    expect(m.changes[0]).toMatchObject({ status: 'failed', attempts: 3, error: expect.stringContaining('SQL timed out') });
    expect(await verdict(w, DEV)).toBe('dont_know');
  });
});

describe('detection by the sweep (F6: "by the sweep if E10 allows")', () => {
  it('reads each environment and notes a new version; a read that fails notes nothing', async () => {
    const w = demoWorld();
    const m = memoryChanges(w);
    w.records.get(DEV)!.Version = ['14.0.2'];
    w.readFailures.set(PROD, 'unreachable');
    const reader = depsFor(w, modelReplying(UPLOAD_3GB)).environments;
    const n = await detectVersions([{ tool: w.tool, environments: w.environments }], reader, (tool, e: Environment, v) => noteVersion({ ...snapshot(w, e.id), granularity: tool.versionGranularity }, v, m.detect));
    expect(n).toBe(1);
    expect(m.changes.map((c) => `${c.environmentId}:${c.fromVersion}->${c.toVersion}:${c.origin}`)).toEqual([`${DEV}:13.2->14.0:detected`]);
  });
});

describe('the Changes screen and "Still true"', () => {
  async function owner() {
    const x = loopWorld();
    const m = memoryChanges(x.w);
    x.w.records.get(DEV)!.Version = ['14.0'];
    await noteVersion(snapshot(x.w, DEV), '14.0', m.detect);
    await buildRecheckList(m.changes[0]!, m.repo);
    const writer = memoryWriter(x.w);
    const deps: ChangeDeps = {
      loop: x.deps,
      changes: m.repo,
      writer,
      check: { isJiraAdmin: async () => false },
      listEnvironments: async () => x.w.environments,
      loadRegistry: async () => ({
        facts: x.w.facts.map((f) => ({ ...f, versions: x.w.factVersions.filter((v) => v.factId === f.id) })),
        rules: x.w.rules,
        readinessKeys: x.w.readiness,
        accessMappings: x.w.access,
      }),
    };
    return { x, m, deps, writer };
  }

  it('shows the change, where it was found, the facts to re-verify, and what stayed untouched (owner only)', async () => {
    const { deps } = await owner();
    const view = await handleChanges({ toolId: 1 }, { accountId: MARCO }, deps);
    expect(view).toMatchObject({
      ok: true,
      changes: [
        {
          environment: 'KS-DEV',
          from: '13.2',
          to: '14.0',
          found: 'Found in Assets record',
          status: 'listed',
          toRecheck: expect.arrayContaining([expect.objectContaining({ key: 'max_upload_gb', label: 'Upload a file of a given size', was: 2, scope: 'all environments' })]),
          notListed: 2,
          rulesUntouched: 8,
          otherEnvironments: ['KS-PROD (13.2)'],
        },
      ],
    });
    if (view.ok) expect(view.changes[0]!.toRecheck).toHaveLength(4);
    expect(await handleChanges({ toolId: 1 }, { accountId: SAM }, deps)).toMatchObject({ ok: false });
  });

  it('"Still true on 14.0" adds the verification in one click; the answer in KS-DEV comes back, KS-PROD untouched', async () => {
    const { x, m, deps } = await owner();
    const runtime = factId(x.w, 'runtime_3_9');
    const RUNTIME = picks({ key: 'runtime_3_9' });
    expect(await verdict(x.w, DEV, RUNTIME)).toBe('dont_know');
    const r = await handleStillTrue({ changeId: 1, factId: runtime }, { accountId: MARCO }, deps);
    expect(r).toMatchObject({ ok: true });
    expect(x.w.factVersions.find((v) => v.factId === runtime && v.version === '14.0')).toMatchObject({ value: true, verifiedBy: MARCO });
    expect(m.items.find((i) => i.refId === runtime)!.status).toBe('done');
    expect(await verdict(x.w, DEV, RUNTIME)).toBe('yes');
    expect(await verdict(x.w, PROD, RUNTIME)).toBe('yes');
    expect(await handleStillTrue({ changeId: 1, factId: runtime }, { accountId: SAM }, deps)).toMatchObject({ ok: false });
  });

  it('"Changed: 5 GB" through the fact form closes the item: KS-DEV on 14.0 says Yes to 3 GB, KS-PROD on 13.2 still No (moment 3)', async () => {
    const { x, m, deps } = await owner();
    const edit: EditDeps = { writer: { ...memoryWriter(x.w), upsertTool: async () => 0, upsertEnvironment: async () => 0, upsertCatalogKey: async () => {}, upsertLink: async () => {}, upsertRule: async () => {}, upsertReadinessKey: async () => {}, upsertAccessMapping: async () => {} }, check: deps.check, loop: x.deps, listEnvironments: deps.listEnvironments, loadRegistry: deps.loadRegistry, changes: m.repo };
    expect(await verdict(x.w, DEV)).toBe('dont_know');
    const r = await handleEdit({ entity: 'fact', toolId: 1, key: 'max_upload_gb', environmentId: null, audienceGroup: null, value: 5, version: '14.0', everyVersion: false, quote: null }, { accountId: MARCO }, edit);
    expect(r).toMatchObject({ ok: true });
    expect(m.items.find((i) => i.refId === factId(x.w, 'max_upload_gb'))!.status).toBe('done');
    expect(await verdict(x.w, DEV)).toBe('yes');
    expect(await verdict(x.w, PROD)).toBe('no');
  });

  it('"Still true" works only for a fact on that change\'s list', async () => {
    const { x, deps } = await owner();
    expect(await handleStillTrue({ changeId: 1, factId: factId(x.w, 'single_sign_on') }, { accountId: MARCO }, deps)).toMatchObject({ ok: false });
    expect(await handleStillTrue({ changeId: 99, factId: factId(x.w, 'runtime_3_9') }, { accountId: MARCO }, deps)).toMatchObject({ ok: false });
  });
});

describe('recent questions (spec F6: "May have changed: ask again")', () => {
  const ROWS: Array<RecentAsk & { askerAccountId: string; toolId: number; environmentId: number | null }> = [
    { askId: 7, askerAccountId: PRIYA, toolId: 1, environmentId: DEV, question: 'Can I upload a 3 GB file?', verdict: 'no', mayHaveChanged: true, createdAt: 't1', tool: '', environment: '' },
    { askId: 8, askerAccountId: PRIYA, toolId: 1, environmentId: null, question: null, verdict: 'yes', mayHaveChanged: false, createdAt: 't2', tool: '', environment: '' },
  ];
  const deps = {
    recentAsksFor: async (asker: string) => ROWS.filter((r) => r.askerAccountId === asker),
    loadTool: async () => demoWorld().tool,
    loadEnvironment: async (id: number) => demoWorld().environments.find((e) => e.id === id) ?? null,
  };

  it("lists the caller's own recent questions with the badge, and nobody else's", async () => {
    expect(await handleRecentAsks({ accountId: PRIYA }, deps)).toEqual({
      asks: [
        { askId: 7, question: 'Can I upload a 3 GB file?', tool: 'Kestrel Studio', environment: 'KS-DEV', verdict: 'no', mayHaveChanged: true, createdAt: 't1' },
        { askId: 8, question: null, tool: 'Kestrel Studio', environment: 'Any environment', verdict: 'yes', mayHaveChanged: false, createdAt: 't2' },
      ],
    });
    expect(await handleRecentAsks({ accountId: SAM }, deps)).toEqual({ asks: [] });
    expect(await handleRecentAsks({}, deps)).toEqual({ asks: [] });
  });
});

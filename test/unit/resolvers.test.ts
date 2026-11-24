import { describe, expect, it, vi } from 'vitest';
import type { SavedAsk } from '../../src/db/asks';
import { handleAsk, handleEnvironments, handleLoadDemo, type AskHandlerDeps } from '../../src/resolvers/handlers';
import { mayWriteTool } from '../../src/registry/authorise';
import { DASHBOARD, demoWorld, depsFor, DEV, modelReplying, PRIYA, SAM, WEB, type World } from '../support/demo-world';

/**
 * Resolver handlers (spec section 19 unit tests): every resolver ignores an account id in the payload; write
 * resolvers refuse anyone who isn't the tool owner or a Jira administrator.
 */

function askDeps(w: World, over: Partial<AskHandlerDeps> = {}) {
  const base = depsFor(w, modelReplying(WEB));
  const saved: SavedAsk[] = [];
  const groupsRead: string[] = [];
  const deps: AskHandlerDeps = {
    loadTool: async (id) => (id === w.tool.id ? w.tool : null),
    loadEnvironment: async (id) => w.environments.find((e) => e.id === id) ?? null,
    loadCatalog: async () => w.catalog,
    readGroups: async (accountId) => {
      groupsRead.push(accountId);
      return w.groups.get(accountId) ?? { ok: false };
    },
    chat: () => base.chat,
    repo: base.repo,
    environments: base.environments,
    saveAsk: async (a) => {
      saved.push(a);
      return 77;
    },
    ...over,
  };
  return { deps, saved, groupsRead };
}

describe('ask resolver', () => {
  it('takes the asker from the Forge context and ignores an account id in the payload', async () => {
    const w = demoWorld();
    const { deps, saved, groupsRead } = askDeps(w);
    const r = await handleAsk({ toolId: 1, environmentId: DEV, question: DASHBOARD, accountId: SAM, asker: SAM }, { accountId: PRIYA }, deps);
    expect(r).toMatchObject({ ok: true, askId: 77, card: { verdict: 'not_ready' } });
    expect(groupsRead).toEqual([PRIYA]);
    expect(saved[0]!.askerAccountId).toBe(PRIYA);
  });

  it('refuses without a signed-in user, and reads nothing', async () => {
    const w = demoWorld();
    const loadTool = vi.fn();
    const { deps } = askDeps(w, { loadTool });
    expect(await handleAsk({ toolId: 1, environmentId: DEV, question: DASHBOARD }, {}, deps)).toMatchObject({ ok: false, error: 'not_signed_in' });
    expect(loadTool).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload', async () => {
    const { deps } = askDeps(demoWorld());
    for (const p of [null, {}, { toolId: '1', environmentId: DEV, question: 'q' }, { toolId: 1, question: 'q' }, { toolId: 1, environmentId: DEV, question: 'x'.repeat(2001) }]) {
      expect(await handleAsk(p, { accountId: PRIYA }, deps)).toMatchObject({ ok: false, error: 'bad_request' });
    }
  });

  it('unknown tool or environment is not found', async () => {
    const { deps } = askDeps(demoWorld());
    expect(await handleAsk({ toolId: 9, environmentId: null, question: 'q' }, { accountId: PRIYA }, deps)).toMatchObject({ error: 'not_found' });
    expect(await handleAsk({ toolId: 1, environmentId: 99, question: 'q' }, { accountId: PRIYA }, deps)).toMatchObject({ error: 'not_found' });
  });

  it('saves keys, verdict and evidence, but not the model\'s wording', async () => {
    const w = demoWorld();
    const { deps, saved } = askDeps(w, { chat: () => modelReplying({ ...WEB, restated: 'MODEL WORDING' }) });
    await handleAsk({ toolId: 1, environmentId: DEV, question: `  ${DASHBOARD}  ` }, { accountId: PRIYA }, deps);
    expect(saved[0]).toMatchObject({ toolId: 1, environmentId: DEV, questionText: DASHBOARD, requirement: [{ key: 'web_frontend' }], verdict: 'not_ready', factVersionIds: [1000] });
    expect(JSON.stringify(saved)).not.toContain('MODEL WORDING');
  });

  it('a failure anywhere is Try again, never a verdict', async () => {
    const { deps } = askDeps(demoWorld(), { loadCatalog: async () => { throw new Error('Unreadable catalog_keys.kind'); } });
    expect(await handleAsk({ toolId: 1, environmentId: DEV, question: 'q' }, { accountId: PRIYA }, deps)).toMatchObject({ ok: false, error: 'try_again', card: { kind: 'try_again', verdict: null } });
  });

  it('an ask that cannot be saved still answers', async () => {
    const { deps } = askDeps(demoWorld(), { saveAsk: async () => { throw new Error('SQL down'); } });
    expect(await handleAsk({ toolId: 1, environmentId: DEV, question: DASHBOARD }, { accountId: PRIYA }, deps)).toMatchObject({ ok: true, askId: null });
  });
});

describe('environments resolver', () => {
  it('lists only environments the person may pick, enforced on the server', async () => {
    const w = demoWorld();
    w.environments.find((e) => e.id === DEV)!.audienceGroup = 'kestrel-admins';
    const deps = {
      listTools: async () => [],
      loadTool: async () => w.tool,
      listEnvironments: async () => w.environments,
      loadCatalog: async () => w.catalog,
      readGroups: async (a: string) => w.groups.get(a) ?? { ok: false as const },
    };
    expect((await handleEnvironments({ toolId: 1 }, { accountId: PRIYA }, deps)).environments.map((e) => e.name)).toEqual(['KS-PROD']);
    w.groups.set(PRIYA, { ok: true, names: ['kestrel-admins'] });
    const r = await handleEnvironments({ toolId: 1, accountId: SAM }, { accountId: PRIYA }, deps);
    expect(r.environments.map((e) => e.name)).toEqual(['KS-DEV', 'KS-PROD']);
    expect(r.suggestions[0]).toBe('Can I build a custom web front end or dashboard?');
    expect((await handleEnvironments({ toolId: 1 }, {}, deps)).environments).toEqual([]);
  });
});

describe('write authorisation', () => {
  const tool = { ownerAccountId: 'acct-marco' };
  const admin = (v: boolean) => ({ isJiraAdmin: async () => v });

  it('the owner or a Jira administrator may write; nobody else', async () => {
    expect(await mayWriteTool('acct-marco', tool, admin(false))).toEqual({ ok: true });
    expect(await mayWriteTool(PRIYA, tool, admin(true))).toEqual({ ok: true });
    expect((await mayWriteTool(PRIYA, tool, admin(false))).ok).toBe(false);
    expect((await mayWriteTool(undefined, tool, admin(true))).ok).toBe(false);
    expect((await mayWriteTool(PRIYA, tool, { isJiraAdmin: async () => { throw new Error('403'); } })).ok).toBe(false);
  });

  it('lets the consent error through so Forge can ask for consent', async () => {
    const consent = Object.assign(new Error('x'), { name: 'NEEDS_AUTHENTICATION_ERR' });
    await expect(mayWriteTool(PRIYA, tool, { isJiraAdmin: async () => { throw consent; } })).rejects.toBe(consent);
  });

  it('Load demo data refuses a non-administrator and seeds as the signed-in person, in the mode asked for', async () => {
    const seed = vi.fn(async () => ({ ok: true as const, toolId: 1, environments: [], counts: {} }));
    expect(await handleLoadDemo({}, { accountId: PRIYA }, { check: admin(false), seed })).toMatchObject({ ok: false });
    expect(await handleLoadDemo({}, {}, { check: admin(true), seed })).toMatchObject({ ok: false });
    expect(await handleLoadDemo({ mode: 'sideways' }, { accountId: 'acct-admin' }, { check: admin(true), seed })).toMatchObject({ ok: false });
    expect(seed).not.toHaveBeenCalled();
    await handleLoadDemo({ accountId: SAM }, { accountId: 'acct-admin' }, { check: admin(true), seed });
    expect(seed).toHaveBeenLastCalledWith('acct-admin', 'assets');
    await handleLoadDemo({ mode: 'registry' }, { accountId: 'acct-admin' }, { check: admin(true), seed });
    expect(seed).toHaveBeenLastCalledWith('acct-admin', 'registry');
  });
});

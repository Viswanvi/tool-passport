import { describe, expect, it } from 'vitest';
import { DEMO_GROUPS, ensureDemoGroups, type GroupsClient } from '../../src/setup/groups';
import type { Reply } from '../../src/setup/assets-records';

/**
 * The demo's two groups (spec section 16: "the two groups (adding you to kestrel-dev-builders)"). Jira's
 * "Create group" and "Add user to group" need site administration and the granular scopes read:group:jira,
 * read:user:jira, write:group:jira and read:avatar:jira (Jira REST v3 docs, read 2026-11-24). Created only if
 * missing; the person loading the demo is added to kestrel-dev-builders only; as the app first, then as the
 * signed-in admin if the app is refused.
 */

function fakeJira(opts: { refuseAs?: Array<'app' | 'user'>; existing?: string[]; members?: Record<string, string[]> } = {}) {
  const groups = new Map<string, Set<string>>((opts.existing ?? []).map((g) => [g, new Set(opts.members?.[g] ?? [])]));
  const writes: Array<{ as: 'app' | 'user'; what: string }> = [];
  const ok = (body: unknown, status = 200): Reply => ({ status, body });
  const client = (as: 'app' | 'user'): GroupsClient => ({
    findGroup: async (name) => ok({ values: groups.has(name) ? [{ name, groupId: `g-${name}` }] : [] }),
    userGroups: async (accountId) => ok([...groups.entries()].filter(([, m]) => m.has(accountId)).map(([name]) => ({ name }))),
    createGroup: async (name) => {
      if (opts.refuseAs?.includes(as)) return { status: 401, body: 'Unauthorized; scope does not match' };
      writes.push({ as, what: `create ${name}` });
      groups.set(name, new Set());
      return ok({ name, groupId: `g-${name}` }, 201);
    },
    addUser: async (name, accountId) => {
      if (opts.refuseAs?.includes(as)) return { status: 403, body: 'Forbidden' };
      writes.push({ as, what: `add ${accountId} to ${name}` });
      groups.get(name)!.add(accountId);
      return ok({ name }, 201);
    },
  });
  return { groups, writes, app: client('app'), user: client('user') };
}

describe('the demo groups', () => {
  it('creates both groups and adds the person loading the demo to kestrel-dev-builders only', async () => {
    const f = fakeJira();
    expect(await ensureDemoGroups(f.app, f.user, 'acct-admin')).toEqual({ ok: true, created: ['kestrel-dev-builders', 'kestrel-prod-deployers'], joined: true, as: 'app' });
    expect([...f.groups.get('kestrel-dev-builders')!]).toEqual(['acct-admin']);
    expect([...f.groups.get('kestrel-prod-deployers')!]).toEqual([]);
    expect(DEMO_GROUPS).toEqual(['kestrel-dev-builders', 'kestrel-prod-deployers']);
  });

  it('run again, it changes nothing', async () => {
    const f = fakeJira({ existing: [...DEMO_GROUPS], members: { 'kestrel-dev-builders': ['acct-admin'] } });
    expect(await ensureDemoGroups(f.app, f.user, 'acct-admin')).toEqual({ ok: true, created: [], joined: false, as: 'app' });
    expect(f.writes).toEqual([]);
  });

  it('where the app is refused (it is not a site admin), the signed-in admin does it', async () => {
    const f = fakeJira({ refuseAs: ['app'] });
    expect(await ensureDemoGroups(f.app, f.user, 'acct-admin')).toMatchObject({ ok: true, as: 'user', joined: true });
    expect(f.writes.every((w) => w.as === 'user')).toBe(true);
  });

  it('refused as both, it stops and says which step and why', async () => {
    const f = fakeJira({ refuseAs: ['app', 'user'] });
    const r = await ensureDemoGroups(f.app, f.user, 'acct-admin');
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('create group kestrel-dev-builders: 401') });
    expect(f.writes).toEqual([]);
  });

  it("a consent request from the admin's side is passed up, so Forge can show the consent screen", async () => {
    const f = fakeJira({ refuseAs: ['app'] });
    const consent = Object.assign(new Error('x'), { name: 'NEEDS_AUTHENTICATION_ERR' });
    await expect(ensureDemoGroups(f.app, { ...f.user, createGroup: () => Promise.reject(consent) }, 'acct-admin')).rejects.toBe(consent);
  });
});

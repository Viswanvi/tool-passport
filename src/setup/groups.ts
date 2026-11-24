import type { Reply } from './assets-records';

/**
 * The demo's two Jira groups (spec section 16, judge path step 2: "the two groups (adding you to
 * kestrel-dev-builders)"). Mapped access in the demo needs them: without kestrel-dev-builders the person asking
 * fails the access check. Created only if missing, and only the person loading the demo is added, to
 * kestrel-dev-builders. Jira's "Create group" and "Add user to group" need site administration and the
 * granular scopes read:group:jira, read:user:jira, write:group:jira and read:avatar:jira (Jira REST v3 docs, read
 * 2026-11-24; Phase 0 got 401 "scope does not match" without the last two). So: as the app first, then as the
 * signed-in admin; a consent request is passed up so Forge can show its consent screen. No Forge imports.
 */

export const DEMO_GROUPS = ['kestrel-dev-builders', 'kestrel-prod-deployers'] as const;
const JOIN = 'kestrel-dev-builders';

export interface GroupsClient {
  /** GET /rest/api/3/group/bulk?groupName=… */
  findGroup(name: string): Promise<Reply>;
  /** GET /rest/api/3/user/groups?accountId=… */
  userGroups(accountId: string): Promise<Reply>;
  /** POST /rest/api/3/group */
  createGroup(name: string): Promise<Reply>;
  /** POST /rest/api/3/group/user?groupname=… */
  addUser(name: string, accountId: string): Promise<Reply>;
}

export type GroupsResult = { ok: true; created: string[]; joined: boolean; as: 'app' | 'user' } | { ok: false; reason: string };

const field = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const values = (o: unknown): unknown[] => (Array.isArray(o) ? o : Array.isArray(field(o, 'values')) ? (field(o, 'values') as unknown[]) : []);
const ok = (r: Reply) => r.status !== null && r.status >= 200 && r.status < 300;
const refused = (r: Reply) => r.status === 401 || r.status === 403;
const note = (r: Reply) => `${r.status ?? 'no reply'}${typeof r.body === 'string' ? ` ${r.body.slice(0, 120)}` : ''}`;

export async function ensureDemoGroups(app: GroupsClient, user: GroupsClient | undefined, accountId: string): Promise<GroupsResult> {
  let as: 'app' | 'user' = 'app';
  const write = async (step: string, f: (c: GroupsClient) => Promise<Reply>): Promise<string | null> => {
    let r = as === 'app' ? await f(app) : await f(user!);
    if (as === 'app' && refused(r) && user) {
      r = await f(user);
      if (ok(r)) as = 'user';
    }
    return ok(r) ? null : `${step}: ${note(r)}`;
  };

  const created: string[] = [];
  for (const name of DEMO_GROUPS) {
    const found = await app.findGroup(name);
    if (!ok(found)) return { ok: false, reason: `find group ${name}: ${note(found)}` };
    if (values(found.body).some((g) => field(g, 'name') === name)) continue;
    const failed = await write(`create group ${name}`, (c) => c.createGroup(name));
    if (failed) return { ok: false, reason: failed };
    created.push(name);
  }

  const mine = await app.userGroups(accountId);
  if (!ok(mine)) return { ok: false, reason: `read your groups: ${note(mine)}` };
  if (values(mine.body).some((g) => field(g, 'name') === JOIN)) return { ok: true, created, joined: false, as };
  const failed = await write(`add you to ${JOIN}`, (c) => c.addUser(JOIN, accountId));
  return failed ? { ok: false, reason: failed } : { ok: true, created, joined: true, as };
}

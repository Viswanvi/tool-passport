/**
 * E6: can the app read the asker's groups, with a user present and from a trigger?
 * Also checks gap J from the kickoff: can the demo seed create the demo groups and add the judge?
 * Phase 0 only.
 */
import { route } from '@forge/api';
import { call, field, list, text, type Requester, type Step } from '../providers/assets-api';

export interface GroupsResult {
  mode: string;
  ok: boolean;
  steps: Step[];
  groups: string[];
}

/** As the user (or impersonated user): GET /rest/api/3/myself?expand=groups. */
export async function myGroups(r: Requester): Promise<GroupsResult> {
  const steps: Step[] = [];
  const res = await call(r, 'myself?expand=groups', route`/rest/api/3/myself?expand=groups`);
  steps.push(res.step);
  const groups = list(field(field(res.body, 'groups'), 'items'))
    .map((g) => text(field(g, 'name')))
    .filter((n): n is string => !!n);
  return { mode: r.mode, ok: res.step.ok, steps, groups };
}

/** As the app, for a named account: GET /rest/api/3/user/groups?accountId=… */
export async function groupsOf(r: Requester, accountId: string): Promise<GroupsResult> {
  const steps: Step[] = [];
  const res = await call(r, 'user/groups', route`/rest/api/3/user/groups?accountId=${accountId}`);
  steps.push(res.step);
  const groups = list(res.body, 'values')
    .map((g) => text(field(g, 'name')))
    .filter((n): n is string => !!n);
  return { mode: r.mode, ok: res.step.ok, steps, groups };
}

export const DEMO_GROUPS = ['kestrel-dev-builders', 'kestrel-prod-deployers'] as const;

export interface SeedGroupsResult {
  mode: string;
  ok: boolean;
  steps: Step[];
}

/**
 * Creates the two demo groups if missing and adds `memberAccountId` (the admin, who plays Priya) to
 * kestrel-dev-builders, as spec section 16 describes. Safe to repeat.
 */
export async function seedGroups(r: Requester, memberAccountId: string): Promise<SeedGroupsResult> {
  const steps: Step[] = [];
  const ids = new Map<string, string>();
  for (const name of DEMO_GROUPS) {
    const found = await call(r, `find group ${name}`, route`/rest/api/3/group/bulk?groupName=${name}`);
    steps.push(found.step);
    let id = text(field(list(found.body, 'values').find((g) => field(g, 'name') === name), 'groupId'));
    if (!id) {
      const created = await call(r, `create group ${name}`, route`/rest/api/3/group`, 'POST', { name });
      steps.push(created.step);
      id = text(field(created.body, 'groupId'));
    } else steps.push({ step: `group ${name} exists`, status: null, ok: true });
    if (id) ids.set(name, id);
  }
  const devId = ids.get('kestrel-dev-builders');
  if (devId) {
    const added = await call(r, 'add member to kestrel-dev-builders', route`/rest/api/3/group/user?groupId=${devId}`, 'POST', {
      accountId: memberAccountId,
    });
    // Already a member comes back as 400; that is the outcome we want, so record it as ok.
    const already = added.step.status === 400 && /already/i.test(added.step.note ?? '');
    steps.push(already ? { ...added.step, ok: true, note: 'already a member' } : added.step);
  }
  return { mode: r.mode, ok: steps.every((s) => s.ok) && ids.size === DEMO_GROUPS.length, steps };
}

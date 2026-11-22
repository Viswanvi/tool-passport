import type { Groups } from '../engine/model';

/**
 * Group membership (spec F2; E6). Read as the app with `GET /rest/api/3/user/groups?accountId=…`, which
 * works in resolvers, triggers and the sweep alike and returns an array of { name, groupId }. Anything but a
 * clean reply is { ok: false }, so access and group-scoped rules become Not verified, never a guess.
 */
export function parseGroups(status: number, body: unknown): Groups {
  if (status !== 200) return { ok: false, reason: `Group lookup returned ${status}` };
  if (!Array.isArray(body)) return { ok: false, reason: 'Group lookup reply was not a list' };
  const names = body.map((g) => (g !== null && typeof g === 'object' ? (g as { name?: unknown }).name : undefined));
  if (!names.every((n): n is string => typeof n === 'string' && n !== '')) return { ok: false, reason: 'Group lookup reply had entries without a name' };
  return { ok: true, names };
}

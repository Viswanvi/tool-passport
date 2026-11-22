import type { Effect, Groups, Scoped } from './model';

/**
 * Choosing the applicable fact or rule (spec section 11, `mostSpecific`). Most specific wins: environment and
 * group, then environment, then group, then everyone. At the same level, deny beats approval beats allow.
 * If group membership is unknown and a group-scoped row exists, nothing is chosen: never fall back to a
 * broader row, because the narrower one might be a deny.
 */

export type Selection<T> = { row: T | null } | { unknown: string; why: 'groups' | 'conflict' };

/**
 * The asker's group names, or null when they can't be trusted. An empty list counts as unread (D28): every
 * site user is in at least one group, so an empty reply most likely means the lookup returned nothing, and
 * treating it as "in no groups" would let a group-scoped deny be skipped.
 */
export function knownGroups(groups: Groups | null | undefined): string[] | null {
  if (!groups || !groups.ok) return null;
  const names = (groups as { names?: unknown }).names;
  if (!Array.isArray(names) || names.length === 0) return null;
  return names.filter((n): n is string => typeof n === 'string');
}

const LEVEL = (r: Scoped) => (r.environmentId != null ? 2 : 0) + (r.audienceGroup != null ? 1 : 0);
const EFFECT: Record<Effect, number> = { deny: 3, approval: 2, allow: 1 };
// An effect this code doesn't know (effect is a VARCHAR, D11) ranks above deny, so it is chosen and then
// refused by the policy check, instead of being skipped in favour of an allow.
const rank = (e: Effect | undefined) => (e !== undefined && e in EFFECT ? EFFECT[e] : 4);

export function mostSpecific<T extends Scoped & { effect?: Effect }>(rows: T[], environmentId: number | null, groups: Groups): Selection<T> {
  const here = rows.filter((r) => r.status === 'active' && (r.environmentId == null || r.environmentId === environmentId));
  const names = knownGroups(groups);
  if (names === null && here.some((r) => r.audienceGroup != null)) {
    return { unknown: 'Group membership could not be read', why: 'groups' };
  }
  const mine = here.filter((r) => r.audienceGroup == null || (names ?? []).includes(r.audienceGroup));
  if (mine.length === 0) return { row: null };
  const top = Math.max(...mine.map(LEVEL));
  const best = mine.filter((r) => LEVEL(r) === top);
  if (best.every((r) => r.effect !== undefined)) {
    // Rules: the strictest effect at the most specific level wins.
    best.sort((a, b) => rank(b.effect) - rank(a.effect));
    return { row: best[0] ?? null };
  }
  // Facts: two at the same level for this person's groups is a conflict, not a choice.
  return best.length === 1 ? { row: best[0] ?? null } : { unknown: 'Two answers conflict for your groups', why: 'conflict' };
}

import type { Environment, Groups } from './model';
import { knownGroups } from './select';

/**
 * Who may pick an environment (spec sections 10 and 14). Assets is read as the app (D25), which ignores the
 * asker's own Assets permissions, so this check is one of the only protections: an environment with an
 * audience group is refused unless membership is confirmed.
 */
export function canPick(environment: Environment, groups: Groups): { ok: true } | { ok: false; reason: string } {
  if (environment.audienceGroup == null) return { ok: true };
  const names = knownGroups(groups);
  if (names === null) return { ok: false, reason: `Your group membership could not be confirmed, so ${environment.name} can't be checked for you` };
  if (!names.includes(environment.audienceGroup)) return { ok: false, reason: `${environment.name} is limited to another team` };
  return { ok: true };
}

/**
 * Approval outcomes from a request's resolution (spec sections 11 and 14). Only a resolution name the admin
 * mapped to Approved or Declined in setup counts; anything else (unmapped, missing, or a mapping value this
 * code doesn't know) returns null, and the approval stays pending. Names match exactly, as Jira stores them.
 * No Forge imports: the event handler passes the name it read back from the issue (D22).
 */

export type ResolutionMap = Record<string, unknown>;

export function approvalOutcome(resolutionName: string | null | undefined, map: ResolutionMap | null | undefined): 'approved' | 'declined' | null {
  if (!resolutionName || !map || typeof map !== 'object') return null;
  if (!Object.hasOwn(map, resolutionName)) return null;
  const outcome = map[resolutionName];
  return outcome === 'approved' || outcome === 'declined' ? outcome : null;
}

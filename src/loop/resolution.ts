/**
 * Approval outcomes from a request's resolution (spec sections 11 and 14). Only a resolution name the admin
 * mapped to Approved or Declined in setup counts; anything else (unmapped, missing, or a mapping value this
 * code doesn't know) returns null, and the approval stays pending. Names match exactly, as Jira stores them.
 * No Forge imports: the event handler passes the name it read back from the issue (D22).
 */

export type ResolutionMap = Record<string, unknown>;

const own = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Who set the resolution most recently, from an issue's `changelog.histories`: the author of the newest entry
 * that sets a resolution. Null when the changelog shows none, which decides nothing (D34).
 */
export function resolvedBy(histories: unknown): string | null {
  if (!Array.isArray(histories)) return null;
  const sets = histories.filter((h) => {
    const items = own(h, 'items');
    return Array.isArray(items) && items.some((i) => own(i, 'field') === 'resolution' && (str(own(i, 'to')) ?? str(own(i, 'toString'))));
  });
  const created = (h: unknown) => Date.parse(String(own(h, 'created') ?? '')) || 0;
  const newest = sets.sort((a, b) => created(b) - created(a))[0];
  return str(own(own(newest, 'author'), 'accountId'));
}

export function approvalOutcome(resolutionName: string | null | undefined, map: ResolutionMap | null | undefined): 'approved' | 'declined' | null {
  if (!resolutionName || !map || typeof map !== 'object') return null;
  if (!Object.hasOwn(map, resolutionName)) return null;
  const outcome = map[resolutionName];
  return outcome === 'approved' || outcome === 'declined' ? outcome : null;
}

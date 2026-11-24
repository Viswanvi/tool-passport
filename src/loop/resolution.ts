/**
 * Approval outcomes from a request's resolution (spec sections 11 and 14). Only a name the admin mapped to
 * Approved or Declined in setup counts; anything else (unmapped, missing, or a mapping value this code doesn't
 * know) returns null, and the approval stays pending. Names match exactly, as Jira stores them.
 *
 * The name is the issue's resolution, or, when it has none, its status if that status is done (D41: a fresh
 * developer site has no Jira resolutions at all, so a resolved request kept `resolution: null`, found live).
 * No Forge imports: the event handler passes what it read back from the issue (D22).
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
  return authorOfNewest(sets);
}

const created = (h: unknown) => Date.parse(String(own(h, 'created') ?? '')) || 0;
const authorOfNewest = (entries: unknown[]) => str(own(own([...entries].sort((a, b) => created(b) - created(a))[0], 'author'), 'accountId'));

/** Who last moved the issue into this status: the author of the newest entry whose status change goes there. */
export function statusSetBy(histories: unknown, status: { id: string | null; name: string }): string | null {
  if (!Array.isArray(histories)) return null;
  const into = histories.filter((h) => {
    const items = own(h, 'items');
    return Array.isArray(items) && items.some((i) => own(i, 'field') === 'status' && (status.id !== null && str(own(i, 'to')) !== null ? str(own(i, 'to')) === status.id : str(own(i, 'toString')) === status.name));
  });
  return authorOfNewest(into);
}

/**
 * What reading a request back shows (`GET /issue/{key}?fields=resolution,status,assignee&expand=changelog`):
 * the deciding name and who set it. A resolution wins; with none, a done status counts. Anything else, or a
 * body that doesn't read, is no outcome.
 */
export function readOutcome(body: unknown): { name: string | null; resolvedBy: string | null; assignee: string | null } {
  const fields = own(body, 'fields');
  const histories = own(own(body, 'changelog'), 'histories');
  const assignee = str(own(own(fields, 'assignee'), 'accountId'));
  const resolution = str(own(own(fields, 'resolution'), 'name'));
  if (resolution) return { name: resolution, resolvedBy: resolvedBy(histories), assignee };
  const status = own(fields, 'status');
  const name = str(own(status, 'name'));
  if (!name || own(own(status, 'statusCategory'), 'key') !== 'done') return { name: null, resolvedBy: null, assignee };
  return { name, resolvedBy: statusSetBy(histories, { id: str(own(status, 'id')), name }), assignee };
}

/** A desk's done statuses, once each, from `GET /project/{id}/statuses` (statuses per issue type). */
export function doneStatusNames(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  const names: string[] = [];
  for (const type of body) {
    const statuses = own(type, 'statuses');
    if (!Array.isArray(statuses)) continue;
    for (const s of statuses) {
      const name = str(own(s, 'name'));
      if (name && own(own(s, 'statusCategory'), 'key') === 'done' && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

export function approvalOutcome(resolutionName: string | null | undefined, map: ResolutionMap | null | undefined): 'approved' | 'declined' | null {
  if (!resolutionName || !map || typeof map !== 'object') return null;
  if (!Object.hasOwn(map, resolutionName)) return null;
  const outcome = map[resolutionName];
  return outcome === 'approved' || outcome === 'declined' ? outcome : null;
}

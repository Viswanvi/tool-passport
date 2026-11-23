import { fixTargets, pieceName, recheckAsk, saveResult, type LoopDeps, type Rechecked, type RequestRow } from './requests';

/**
 * avi:jira:updated:issue and the sweep (spec section 11, F4). An issue the app didn't raise is ignored. A
 * resolution is found in `changelog.items` and confirmed by reading the issue back as the app; the event's
 * `issue.fields` never carries it (D22, E5). The stored requirement is then re-checked for the asker and the
 * new verdict is commented on the request. The sweep does the same for requests whose event never came (E5
 * saw a window of missed events), and finishes re-checks that stopped part way. No Forge imports here.
 */

export type EventOutcome = 'ignored' | 'not_ours' | 'unresolved' | 'already' | 'not_handled' | 'rechecked' | 'comment_failed';

/** Own properties only: `toString` must not find Object.prototype.toString. */
const own = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);

/** The issue key, and whether a resolution was set (true) or cleared (false); null if no resolution changed. */
export function resolutionChange(event: unknown): { key: string; resolved: boolean } | null {
  const key = own(own(event, 'issue'), 'key');
  if (typeof key !== 'string' || !key) return null;
  const items = own(own(event, 'changelog'), 'items');
  if (!Array.isArray(items)) return null;
  const item = items.find((i) => own(i, 'field') === 'resolution' || own(i, 'fieldId') === 'resolution');
  if (!item) return null;
  const to = own(item, 'toString') ?? own(item, 'to');
  return { key, resolved: typeof to === 'string' ? to.trim() !== '' : to !== null && to !== undefined };
}

export async function handleIssueEvent(event: unknown, deps: LoopDeps): Promise<EventOutcome> {
  const change = resolutionChange(event);
  if (!change || !change.resolved) return 'ignored';
  const row = await deps.requests.byKey(change.key);
  if (!row) return 'not_ours';
  return settleIfResolved(row, deps);
}

async function settleIfResolved(row: RequestRow, deps: LoopDeps): Promise<EventOutcome> {
  // Approvals and questions get their own outcomes in Phase 2 (resolution mapping, publishAnswer).
  if (row.kind !== 'fix') return 'not_handled';
  if (row.status !== 'open' || !row.requestKey) return 'already';
  const back = await deps.jsm.resolution(row.requestKey);
  if (!back.name) return 'unresolved';
  // Compare-and-set: of an event and a sweep arriving together, one re-checks and comments.
  if (!(await deps.requests.markResolved(row.id))) return 'already';
  return finishRecheck(row, deps);
}

/** Re-check for the asker, comment the verdict, close the row. A failed comment leaves it for the sweep. */
export async function finishRecheck(row: RequestRow, deps: LoopDeps): Promise<'rechecked' | 'comment_failed'> {
  const ask = await deps.loadAsk(row.askId);
  const now = ask ? await recheckAsk(ask, deps) : null;
  if (ask && now) await saveResult(deps, ask.id, now.answer);
  try {
    await deps.jsm.comment(row.requestKey!, recheckComment(row, now));
  } catch (e) {
    deps.log?.(`[request] comment on ${row.requestKey} failed: ${String(e).slice(0, 200)}`);
    return 'comment_failed';
  }
  await deps.requests.markRechecked(row.id, {
    verdict: now?.answer.state === 'checked' ? now.answer.verdict : null,
    reason: now?.card.reason ?? 'The question this request came from is no longer stored.',
    at: new Date().toISOString(),
  });
  return 'rechecked';
}

/** The comment the asker sees on their request. Built from the card, so it uses the card's fixed words. */
export function recheckComment(row: RequestRow, now: Rechecked | null): string {
  if (!now) return 'Tool Passport could not check this again: the question it came from is no longer stored. Ask it again in Tool Passport.';
  const lines = ['Tool Passport checked again after this request was resolved.', '', `Answer now: ${now.card.title}. ${now.card.reason}`];
  const still = fixTargets(now.answer).find((t) => t.target === row.target);
  if (still) lines.push(`${pieceName(still.result)} is still missing, so the answer stays Not ready until it is in place.`);
  else if (now.answer.state === 'checked' && now.answer.verdict === 'yes_with_approval') lines.push('Next step: request approval in Tool Passport.');
  return lines.join('\n');
}

export interface SweepCount {
  looked: number;
  rechecked: number;
  failed: number;
}

/** The sweep's share of the loop. One request failing never stops the others. */
export async function sweepRequests(deps: LoopDeps, limit: number): Promise<SweepCount> {
  const count: SweepCount = { looked: 0, rechecked: 0, failed: 0 };
  for (const row of await deps.requests.listOpen(limit)) {
    count.looked += 1;
    try {
      const out = await settleIfResolved(row, deps);
      if (out === 'rechecked') count.rechecked += 1;
      else if (out === 'comment_failed') count.failed += 1;
      else await deps.requests.touch(row.id);
    } catch (e) {
      count.failed += 1;
      deps.log?.(`[sweep] request ${row.requestKey ?? row.id}: ${String(e).slice(0, 200)}`);
    }
  }
  for (const row of await deps.requests.listUnfinished(limit)) {
    count.looked += 1;
    try {
      if ((await finishRecheck(row, deps)) === 'rechecked') count.rechecked += 1;
      else count.failed += 1;
    } catch (e) {
      count.failed += 1;
      deps.log?.(`[sweep] request ${row.requestKey ?? row.id}: ${String(e).slice(0, 200)}`);
    }
  }
  return count;
}

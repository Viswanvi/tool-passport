import {
  APPROVAL_TARGET,
  fixTargets,
  howToDecide,
  pieceName,
  recheckAsk,
  saveResult,
  type LoopDeps,
  type Rechecked,
  type RequestRow,
  type ResolutionRead,
} from './requests';
import { approvalOutcome, type ResolutionMap } from './resolution';
import { tellStoriesSafely } from './stories';

/**
 * avi:jira:updated:issue and the sweep (spec section 11, F4). An issue the app didn't raise is ignored. A
 * resolution is found in `changelog.items` and confirmed by reading the issue back as the app; the event's
 * `issue.fields` never carries it (D22, E5). The stored requirement is then re-checked for the asker and the
 * new verdict is commented on the request. The sweep does the same for requests whose event never came (E5
 * saw a window of missed events), and finishes re-checks that stopped part way. No Forge imports here.
 */

export type EventOutcome = 'ignored' | 'not_ours' | 'unresolved' | 'already' | 'not_handled' | 'undecided' | 'rechecked' | 'comment_failed';

/** Own properties only: `toString` must not find Object.prototype.toString. */
const own = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);

/**
 * The issue key, and whether the change may have resolved it (true) or only cleared a resolution (false); null
 * if neither the resolution nor the status changed. A status change alone counts: on a site with no Jira
 * resolutions, resolving a request changes nothing else (D41, found live). The read-back decides either way.
 */
export function resolutionChange(event: unknown): { key: string; resolved: boolean } | null {
  const key = own(own(event, 'issue'), 'key');
  if (typeof key !== 'string' || !key) return null;
  const items = own(own(event, 'changelog'), 'items');
  if (!Array.isArray(items)) return null;
  const is = (i: unknown, f: string) => own(i, 'field') === f || own(i, 'fieldId') === f;
  const item = items.find((i) => is(i, 'resolution'));
  if (!item) return items.some((i) => is(i, 'status')) ? { key, resolved: true } : null;
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
  // A question is usually settled by the owner's published answer (loop/questions.ts), which closes the row
  // first; one the owner resolves in the service desk instead is checked again like a fix.
  if (row.status !== 'open' || !row.requestKey) return 'already';
  const back = await deps.jsm.resolution(row.requestKey);
  if (!back.name) return 'unresolved';
  if (row.kind === 'approval') {
    if (row.environmentId === null) return 'not_handled';
    const map = await deps.resolutionMap();
    const decision = approvalDecision(row, back, map);
    if (!decision.ok) {
      // The request stays open so a later decision still counts; the asker is told once.
      if (!(await deps.requests.markUndecided(row.id))) return 'already';
      try {
        await deps.jsm.comment(row.requestKey, undecidedComment(decision.why, back.name, map));
      } catch (e) {
        deps.log?.(`[request] comment on ${row.requestKey} failed: ${String(e).slice(0, 200)}`);
        return 'comment_failed';
      }
      return 'undecided';
    }
    // Recorded before the compare-and-set below, and safe to repeat: if this stops part way, the next event
    // or sweep records the same decision again and carries on.
    await deps.approvals.decide({
      askerAccountId: row.askerAccountId,
      toolId: row.toolId,
      environmentId: row.environmentId,
      actionKey: row.target.slice(APPROVAL_TARGET.length),
      requestKey: row.requestKey,
      status: decision.outcome,
    });
  }
  // Compare-and-set: of an event and a sweep arriving together, one re-checks and comments.
  if (!(await deps.requests.markResolved(row.id))) return 'already';
  return finishRecheck(row, deps);
}

type Decision = { ok: true; outcome: 'approved' | 'declined' } | { ok: false; why: 'unmapped' | 'not_approver' };

/**
 * Whether a resolution decides an approval (spec section 14, D34). It must be a name setup mapped to Approved
 * or Declined, set by the approver the request was routed to, or by the person it is assigned to now if that
 * isn't the asker. A customer resolving their own request in the portal decides nothing, and neither does a
 * resolution whose author can't be read.
 */
export function approvalDecision(row: Pick<RequestRow, 'ownerAccountId' | 'askerAccountId'>, back: ResolutionRead, map: ResolutionMap | null): Decision {
  const outcome = approvalOutcome(back.name, map);
  if (!outcome) return { ok: false, why: 'unmapped' };
  const by = back.resolvedBy;
  const counts = by !== null && (by === row.ownerAccountId || (by === back.assignee && by !== row.askerAccountId));
  return counts ? { ok: true, outcome } : { ok: false, why: 'not_approver' };
}

function undecidedComment(why: 'unmapped' | 'not_approver', name: string, map: ResolutionMap | null): string {
  const first =
    why === 'unmapped'
      ? `Tool Passport: "${name}" is not an approval decision, so the approval is still pending.`
      : 'Tool Passport: this request was not resolved by the approver, so the approval is still pending.';
  return `${first} To decide, the approver reopens it. ${howToDecide(map)}`;
}

/** Re-check for the asker, comment the verdict, close the row. A failed comment leaves it for the sweep. */
export async function finishRecheck(row: RequestRow, deps: LoopDeps): Promise<'rechecked' | 'comment_failed'> {
  const ask = await deps.loadAsk(row.askId);
  const now = ask ? await recheckAsk(ask, deps) : null;
  if (ask && now) await saveResult(deps, ask.id, now.answer);
  await tellStoriesSafely({ askId: row.askId, asker: row.askerAccountId, now, trigger: row.requestKey }, deps);
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

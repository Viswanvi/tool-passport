import { describe, expect, it } from 'vitest';
import { handleIssueEvent, sweepRequests } from '../../src/loop/events';
import { raiseApproval, recheckForAsker } from '../../src/loop/requests';
import { resolvedBy } from '../../src/loop/resolution';
import { handleRequestApproval, handleResolutionSetup, handleSaveResolutionMap, type ResolutionSetupDeps } from '../../src/resolvers/request-handlers';
import { DEV, MARCO, PRIYA, PROD, SAM } from '../support/demo-world';
import { loopWorld, resolvedEvent } from '../support/fix-world';

/**
 * Approvals through the request loop (spec F4, sections 11 and 14). Request approval raises a private request
 * for the asker, routed to the approver, and records a pending grant. Only a resolution the admin mapped to
 * Approved or Declined decides it, and only when the approver (or the current assignee, if that isn't the
 * asker) resolved it: anything else leaves the approval pending (D34).
 */

const ANA = 'acct-ana';

/** Moment 2 after the fix: KS-DEV has the frontend build, so the dashboard answer is Yes, with approval. */
function approvalWorld() {
  const x = loopWorld();
  x.w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
  return x;
}

async function requested() {
  const x = approvalWorld();
  const askId = x.addAsk(DEV);
  const r = await raiseApproval(askId, PRIYA, x.deps);
  if (!r.ok) throw new Error(`raise failed: ${r.error}`);
  return { x, askId };
}

describe('Request approval', () => {
  it('raises one private approval request for the asker, routed to the approver, and records it as pending', async () => {
    const x = approvalWorld();
    const askId = x.addAsk(DEV);
    const r = await raiseApproval(askId, PRIYA, x.deps);
    expect(r).toMatchObject({
      ok: true,
      raised: ['TPD-1'],
      card: { verdict: 'yes_with_approval', action: { kind: 'approval_requested', label: 'Approval requested', requests: [{ key: 'TPD-1', ownerAccountId: MARCO }] } },
    });
    const c = x.jsm.created[0]!;
    // No approval request type set: the fix request type is used (D34).
    expect(c).toMatchObject({ serviceDeskId: '14', requestTypeId: '320', raiseOnBehalfOf: PRIYA });
    expect(c.summary).toBe('Approval needed in KS-DEV: custom ui (Needs design review)');
    expect(c.description).toContain('Needs design review');
    expect(c.description).toContain('Resolve this request as "Done" to approve or "Declined" to decline.');
    expect(c.description).toContain('Any other resolution leaves the approval pending.');
    // The rule's route is one this code doesn't know: the tool owner gets it.
    expect(x.jsm.assigned).toEqual([{ issueKey: 'TPD-1', accountId: MARCO }]);
    expect(x.requests.rows[0]).toMatchObject({ kind: 'approval', target: 'approval:custom_ui', status: 'open', askerAccountId: PRIYA });
    expect(x.w.grants).toMatchObject([{ askerAccountId: PRIYA, toolId: 1, environmentId: DEV, actionKey: 'custom_ui', requestKey: 'TPD-1', status: 'pending' }]);
    // The pending grant keeps the answer at Yes, with approval: requesting is not approving.
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'yes_with_approval', action: { kind: 'approval_requested' } } });
  });

  it('uses the approval request type when setup has one', async () => {
    const x = approvalWorld();
    x.setSetup({ serviceDeskId: '14', requestTypeIds: { fix: '320', approval: '400' } });
    await raiseApproval(x.addAsk(DEV), PRIYA, x.deps);
    expect(x.jsm.created[0]!.requestTypeId).toBe('400');
  });

  it('raises nothing unless the answer now is Yes, with approval', async () => {
    const x = loopWorld(); // frontend build missing: Not ready, approval only "next"
    expect(await raiseApproval(x.addAsk(DEV), PRIYA, x.deps)).toMatchObject({ ok: true, raised: [], card: { verdict: 'not_ready' } });
    expect(await raiseApproval(x.addAsk(PROD), PRIYA, x.deps)).toMatchObject({ ok: true, raised: [], card: { verdict: 'no' } });
    expect(x.jsm.created).toHaveLength(0);
    expect(x.w.grants).toHaveLength(0);
  });

  it("refuses another person's ask, and reads nothing", async () => {
    const x = approvalWorld();
    expect(await raiseApproval(x.addAsk(DEV, PRIYA), SAM, x.deps)).toMatchObject({ ok: false, error: 'not_found' });
    expect(x.groupsRead).toEqual([]);
    expect(x.jsm.created).toHaveLength(0);
  });

  it('needs a resolution mapped to Approved before any approval request is raised', async () => {
    const x = approvalWorld();
    for (const map of [null, {}, { Declined: 'declined' as const }]) {
      x.setResolutionMap(map);
      const r = await raiseApproval(x.addAsk(DEV), PRIYA, x.deps);
      expect(r).toMatchObject({ ok: false, error: 'approvals_not_set_up' });
      if (!r.ok) expect(r.message).toContain('Approved');
    }
    expect(x.jsm.created).toHaveLength(0);
  });

  it('keeps one open approval request per person, environment and action', async () => {
    const { x } = await requested();
    expect(await raiseApproval(x.addAsk(DEV), PRIYA, x.deps)).toMatchObject({ ok: true, raised: [], card: { action: { kind: 'approval_requested', requests: [{ key: 'TPD-1' }] } } });
    expect(x.jsm.created).toHaveLength(1);
  });
});

describe('approval decisions', () => {
  it('Approved by the approver: the grant is approved, the answer turns Yes, and the request gets the verdict', async () => {
    const { x, askId } = await requested();
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.w.grants[0]).toMatchObject({ status: 'approved' });
    expect(x.jsm.comments).toHaveLength(1);
    expect(x.jsm.comments[0]!.body).toContain('Answer now: Yes.');
    expect(x.requests.rows[0]).toMatchObject({ status: 'closed', result: { verdict: 'yes' } });
    const card = await recheckForAsker(askId, PRIYA, x.deps);
    expect(card).toMatchObject({ ok: true, card: { verdict: 'yes', action: null } });
    if (card.ok) expect(card.card.chips.map((c) => c.label)).toContain('Approved');
  });

  it('Declined: the answer turns No and says so', async () => {
    const { x, askId } = await requested();
    x.jsm.resolutions.set('TPD-1', 'Declined');
    expect(await handleIssueEvent(resolvedEvent('TPD-1', 'Declined'), x.deps)).toBe('rechecked');
    expect(x.w.grants[0]).toMatchObject({ status: 'declined' });
    expect(x.jsm.comments[0]!.body).toContain('Answer now: No. Your approval request TPD-1 was declined.');
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'no' } });
  });

  it('an unmapped resolution never approves: the asker is told once, and a later decision still counts', async () => {
    const { x } = await requested();
    x.jsm.resolutions.set('TPD-1', "Won't Do");
    expect(await handleIssueEvent(resolvedEvent('TPD-1', "Won't Do"), x.deps)).toBe('undecided');
    expect(x.w.grants[0]).toMatchObject({ status: 'pending' });
    expect(x.jsm.comments).toHaveLength(1);
    expect(x.jsm.comments[0]!.body).toContain('"Won\'t Do" is not an approval decision');
    expect(x.jsm.comments[0]!.body).toContain('still pending');
    expect(x.requests.rows[0]!.status).toBe('open');
    // Delivered again, and seen by the sweep: no second comment, nothing decided.
    expect(await handleIssueEvent(resolvedEvent('TPD-1', "Won't Do"), x.deps)).toBe('already');
    expect(await sweepRequests(x.deps, 25)).toMatchObject({ looked: 1, rechecked: 0 });
    expect(x.jsm.comments).toHaveLength(1);
    expect(x.approvals.decided).toEqual([]);
    // The approver reopens it and resolves it as Done.
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.w.grants[0]).toMatchObject({ status: 'approved' });
  });

  it('the asker resolving their own request never approves it', async () => {
    const { x } = await requested();
    x.jsm.resolutions.set('TPD-1', 'Done');
    x.jsm.resolvedBy.set('TPD-1', PRIYA);
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('undecided');
    expect(x.w.grants[0]).toMatchObject({ status: 'pending' });
    expect(x.jsm.comments[0]!.body).toContain('was not resolved by the approver');
    // Even if the asker made themselves the assignee first.
    x.jsm.assigned.push({ issueKey: 'TPD-1', accountId: PRIYA });
    x.requests.rows[0]!.undecided = false;
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('undecided');
    expect(x.w.grants[0]).toMatchObject({ status: 'pending' });
  });

  it('the current assignee can decide when the approver handed the request on', async () => {
    const { x } = await requested();
    x.jsm.assigned.push({ issueKey: 'TPD-1', accountId: ANA });
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.w.grants[0]).toMatchObject({ status: 'approved' });
  });

  it('a decision whose author cannot be read never counts', async () => {
    const { x } = await requested();
    x.jsm.resolutions.set('TPD-1', 'Done');
    x.jsm.resolvedBy.set('TPD-1', null);
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('undecided');
    expect(x.w.grants[0]).toMatchObject({ status: 'pending' });
  });

  it('trusts the read-back of the issue over the event', async () => {
    const { x } = await requested();
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('unresolved');
    expect(x.w.grants[0]).toMatchObject({ status: 'pending' });
    expect(x.jsm.comments).toEqual([]);
  });

  it('a decision recorded before a failed comment is finished by the sweep, and recorded once', async () => {
    const { x } = await requested();
    x.jsm.resolutions.set('TPD-1', 'Done');
    x.jsm.failComment = true;
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('comment_failed');
    expect(x.w.grants[0]).toMatchObject({ status: 'approved' });
    x.jsm.failComment = false;
    x.requests.rows[0]!.resolvedLongAgo = true;
    expect(await sweepRequests(x.deps, 25)).toMatchObject({ rechecked: 1 });
    expect(x.jsm.comments).toHaveLength(1);
    expect(x.jsm.comments[0]!.body).toContain('Answer now: Yes.');
    expect(x.approvals.decided).toEqual([{ requestKey: 'TPD-1', status: 'approved' }]);
  });

  it('records the decision even if the pending grant was never written', async () => {
    const { x, askId } = await requested();
    x.w.grants.length = 0;
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.w.grants).toMatchObject([{ askerAccountId: PRIYA, environmentId: DEV, actionKey: 'custom_ui', requestKey: 'TPD-1', status: 'approved' }]);
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'yes' } });
  });

  it('the sweep decides an approval whose event never arrived', async () => {
    const { x } = await requested();
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await sweepRequests(x.deps, 25)).toMatchObject({ looked: 1, rechecked: 1 });
    expect(x.w.grants[0]).toMatchObject({ status: 'approved' });
  });
});

describe('who resolved it, from the changelog', () => {
  const entry = (created: string, accountId: string | null, items: unknown[]) => ({ created, author: accountId ? { accountId } : {}, items });
  const resolved = (to: string | null) => ({ field: 'resolution', fieldtype: 'jira', from: null, fromString: null, to: to ? '1' : null, toString: to });

  it('is the author of the newest entry that sets a resolution', () => {
    const histories = [
      entry('2026-11-23T03:50:00.000-0500', MARCO, [resolved("Won't Do")]),
      entry('2026-11-23T03:55:00.000-0500', PRIYA, [resolved(null), { field: 'status', toString: 'In Progress' }]),
      entry('2026-11-23T03:59:00.000-0500', ANA, [resolved('Done'), { field: 'status', toString: 'Resolved' }]),
      entry('2026-11-23T04:01:00.000-0500', PRIYA, [{ field: 'assignee', toString: 'x' }]),
    ];
    expect(resolvedBy(histories)).toBe(ANA);
    expect(resolvedBy([...histories].reverse())).toBe(ANA);
  });

  it('is null when no entry sets a resolution, or the author is missing', () => {
    for (const h of [undefined, null, 'x', [], [entry('2026-11-23T03:50:00.000-0500', MARCO, [resolved(null)])], [entry('2026-11-23T03:50:00.000-0500', null, [resolved('Done')])]]) {
      expect(resolvedBy(h)).toBeNull();
    }
  });
});

describe('approval resolvers', () => {
  it('take the asker from the Forge context, never the payload', async () => {
    const x = approvalWorld();
    const askId = x.addAsk(DEV, PRIYA);
    expect(await handleRequestApproval({ askId, accountId: PRIYA }, { accountId: SAM }, x.deps)).toMatchObject({ ok: false, error: 'not_found' });
    expect(await handleRequestApproval({ askId }, {}, x.deps)).toMatchObject({ ok: false, error: 'not_signed_in' });
    expect(await handleRequestApproval({ askId: 'x' }, { accountId: PRIYA }, x.deps)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(x.jsm.created).toHaveLength(0);
    expect(await handleRequestApproval({ askId }, { accountId: PRIYA }, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
  });
});

describe('resolution mapping (Jira administrators only)', () => {
  function deps(admin: boolean) {
    const saved: unknown[] = [];
    const d: ResolutionSetupDeps = {
      check: { isJiraAdmin: async () => admin },
      resolutions: async () => [
        { id: '1', name: 'Done' },
        { id: '2', name: "Won't Do" },
        { id: '3', name: 'Declined' },
      ],
      getMap: async () => null,
      saveMap: async (m) => {
        saved.push(m);
      },
    };
    return { d, saved };
  }

  it('refuses anyone who is not a Jira administrator', async () => {
    const { d, saved } = deps(false);
    expect(await handleResolutionSetup({ accountId: PRIYA }, d)).toMatchObject({ ok: false });
    expect(await handleSaveResolutionMap({ map: { Done: 'approved' } }, { accountId: PRIYA }, d)).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
  });

  it('saves only resolutions Jira has, mapped only to approved or declined', async () => {
    const { d, saved } = deps(true);
    expect(await handleSaveResolutionMap({ map: { Approved: 'approved' } }, { accountId: MARCO }, d)).toMatchObject({ ok: false });
    expect(await handleSaveResolutionMap({ map: { Done: 'maybe' } }, { accountId: MARCO }, d)).toMatchObject({ ok: false });
    expect(await handleSaveResolutionMap({ map: 'Done' }, { accountId: MARCO }, d)).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
    expect(await handleSaveResolutionMap({ map: { Done: 'approved', Declined: 'declined' } }, { accountId: MARCO }, d)).toMatchObject({ ok: true });
    expect(saved).toEqual([{ Done: 'approved', Declined: 'declined' }]);
    expect(await handleResolutionSetup({ accountId: MARCO }, d)).toMatchObject({ ok: true, resolutions: [{ name: 'Done' }, { name: "Won't Do" }, { name: 'Declined' }] });
  });
});

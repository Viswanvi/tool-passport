import { describe, expect, it } from 'vitest';
import { handleIssueEvent, sweepRequests } from '../../src/loop/events';
import { raiseApproval, recheckForAsker } from '../../src/loop/requests';
import { doneStatusNames, readOutcome, resolvedBy } from '../../src/loop/resolution';
import { handleRequestApproval, handleResolutionSetup, handleSaveResolutionMap, type ResolutionSetupDeps } from '../../src/resolvers/request-handlers';
import { DEV, MARCO, PRIYA, PROD, SAM } from '../support/demo-world';
import { loopWorld, resolvedEvent, statusEvent } from '../support/fix-world';

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
    // Worded for a resolution or a status (D41).
    expect(c.description).toContain('Set this request to "Done" to approve or "Declined" to decline.');
    expect(c.description).toContain('Any other outcome leaves the approval pending.');
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

  // D41: a site with no Jira resolutions (found live on a fresh developer site). Setup maps done statuses, and a
  // status change alone brings the request back to the app.
  it('on a site with no resolutions, the approver moving it to a mapped done status decides it', async () => {
    const { x, askId } = await requested();
    x.setResolutionMap({ Resolved: 'approved', Canceled: 'declined' });
    x.jsm.resolutions.set('TPD-1', 'Resolved'); // the read-back: no resolution, status Resolved (done)
    x.jsm.resolvedBy.set('TPD-1', MARCO);
    expect(await handleIssueEvent(statusEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.w.grants[0]).toMatchObject({ requestKey: 'TPD-1', status: 'approved' });
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'yes' } });
  });

  it('on a site with no resolutions, Canceled by the approver declines, and the asker moving it decides nothing', async () => {
    const declined = await requested();
    declined.x.setResolutionMap({ Resolved: 'approved', Canceled: 'declined' });
    declined.x.jsm.resolutions.set('TPD-1', 'Canceled');
    declined.x.jsm.resolvedBy.set('TPD-1', MARCO);
    expect(await handleIssueEvent(statusEvent('TPD-1', 'Canceled'), declined.x.deps)).toBe('rechecked');
    expect(declined.x.w.grants[0]).toMatchObject({ status: 'declined' });

    const own = await requested();
    own.x.setResolutionMap({ Resolved: 'approved', Canceled: 'declined' });
    own.x.jsm.resolutions.set('TPD-1', 'Resolved');
    own.x.jsm.resolvedBy.set('TPD-1', PRIYA); // the asker, from the portal's "Resolve this issue"
    expect(await handleIssueEvent(statusEvent('TPD-1'), own.x.deps)).toBe('undecided');
    expect(own.x.w.grants[0]).toMatchObject({ status: 'pending' });
  });
});

describe('reading a request back (D41)', () => {
  const at = (created: string, accountId: string | null, items: unknown[]) => ({ created, author: accountId ? { accountId } : {}, items });
  const status = (id: string, name: string, key: string) => ({ id, name, statusCategory: { key } });
  const moved = (to: string, toString: string, fromString = 'Waiting for support') => ({ field: 'status', fieldtype: 'jira', from: '10001', fromString, to, toString });

  it('a resolution wins, with whoever set it', () => {
    const body = {
      fields: { resolution: { id: '1', name: 'Done' }, status: status('5', 'Resolved', 'done'), assignee: { accountId: MARCO } },
      changelog: { histories: [at('2026-11-23T03:59:00.000-0500', ANA, [{ field: 'resolution', to: '1', toString: 'Done' }, moved('5', 'Resolved')])] },
    };
    expect(readOutcome(body)).toEqual({ name: 'Done', resolvedBy: ANA, assignee: MARCO });
  });

  it('with no resolution, a done status counts, decided by whoever last moved it there (TPD-1, found live)', () => {
    const body = {
      fields: { resolution: null, status: status('5', 'Resolved', 'done'), assignee: { accountId: MARCO } },
      changelog: {
        histories: [
          at('2026-11-24T08:03:40.513+0530', null, [{ field: 'assignee', toString: 'x' }]),
          at('2026-11-24T08:04:00.000+0530', MARCO, [moved('5', 'Resolved')]),
          at('2026-11-24T08:05:00.000+0530', SAM, [moved('3', 'In progress', 'Resolved')]),
          at('2026-11-24T08:06:45.527+0530', PRIYA, [moved('5', 'Resolved', 'In progress')]),
        ],
      },
    };
    expect(readOutcome(body)).toEqual({ name: 'Resolved', resolvedBy: PRIYA, assignee: MARCO });
  });

  it('a status that is not done, or a body that does not read, is no outcome', () => {
    const open = { fields: { resolution: null, status: status('10001', 'Waiting for support', 'indeterminate') }, changelog: { histories: [at('2026-11-24T08:04:00.000+0530', MARCO, [moved('10001', 'Waiting for support')])] } };
    expect(readOutcome(open)).toEqual({ name: null, resolvedBy: null, assignee: null });
    for (const junk of [null, undefined, 'x', {}, { fields: { status: { name: 'Resolved' } } }, { fields: { status: status('5', '', 'done') } }]) {
      expect(readOutcome(junk)).toMatchObject({ name: null, resolvedBy: null });
    }
  });

  it('a done status nobody can be named for has no author, so it decides no approval', () => {
    const body = { fields: { resolution: null, status: status('5', 'Resolved', 'done') }, changelog: { histories: [at('2026-11-24T08:04:00.000+0530', null, [moved('5', 'Resolved')])] } };
    expect(readOutcome(body)).toEqual({ name: 'Resolved', resolvedBy: null, assignee: null });
  });

  it("a desk's done statuses, once each, from the project's statuses", () => {
    const body = [
      { id: '10', name: 'Service Request', statuses: [status('10001', 'Waiting for support', 'indeterminate'), status('5', 'Resolved', 'done'), status('10006', 'Canceled', 'done')] },
      { id: '11', name: 'Incident', statuses: [status('5', 'Resolved', 'done'), status('6', 'Closed', 'done'), status('3', 'In progress', 'indeterminate')] },
    ];
    expect(doneStatusNames(body)).toEqual(['Resolved', 'Canceled', 'Closed']);
    for (const junk of [null, 'x', {}, [{ statuses: 'x' }]]) expect(doneStatusNames(junk)).toEqual([]);
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
  function deps(admin: boolean, by: 'resolution' | 'status' = 'resolution') {
    const saved: unknown[] = [];
    const names =
      by === 'resolution'
        ? [
            { id: '1', name: 'Done' },
            { id: '2', name: "Won't Do" },
            { id: '3', name: 'Declined' },
          ]
        : [
            { id: '5', name: 'Resolved' },
            { id: '10006', name: 'Canceled' },
            { id: '6', name: 'Closed' },
          ];
    const d: ResolutionSetupDeps = {
      check: { isJiraAdmin: async () => admin },
      decisionNames: async () => ({ by, names }),
      getMap: async () => null,
      saveMap: async (m) => {
        saved.push(m);
      },
    };
    return { d, saved };
  }

  it("on a site with no resolutions, offers the desk's done statuses and saves only those (D41)", async () => {
    const { d, saved } = deps(true, 'status');
    expect(await handleResolutionSetup({ accountId: MARCO }, d)).toMatchObject({ ok: true, by: 'status', outcomes: [{ name: 'Resolved' }, { name: 'Canceled' }, { name: 'Closed' }] });
    expect(await handleSaveResolutionMap({ map: { Done: 'approved' } }, { accountId: MARCO }, d)).toMatchObject({ ok: false });
    expect(await handleSaveResolutionMap({ map: { Resolved: 'approved', Canceled: 'declined' } }, { accountId: MARCO }, d)).toMatchObject({ ok: true });
    expect(saved).toEqual([{ Resolved: 'approved', Canceled: 'declined' }]);
  });

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
    expect(await handleResolutionSetup({ accountId: MARCO }, d)).toMatchObject({ ok: true, by: 'resolution', outcomes: [{ name: 'Done' }, { name: "Won't Do" }, { name: 'Declined' }] });
  });
});

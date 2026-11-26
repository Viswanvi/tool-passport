import { describe, expect, it } from 'vitest';
import { answerQuestion } from '../../src/engine/answer';
import { buildCard } from '../../src/engine/card';
import { approvalValidity } from '../../src/engine/evaluate';
import { handleIssueEvent } from '../../src/loop/events';
import { raiseApproval, recheckForAsker } from '../../src/loop/requests';
import { askInput, DASHBOARD, depsFor, DEV, modelReplying, PRIYA, WEB, yesWorld, type World } from '../support/demo-world';
import { loopWorld, resolvedEvent } from '../support/fix-world';

/**
 * Approvals that expire (D52): a rule can say how many days an approval counts after it is decided. After that
 * the answer is "Yes, with approval" again with the reason, and a new request can be raised. An approval whose
 * decision time can't be read never counts under a limit.
 */

const DECIDED = '2026-11-24T15:00:00.000Z'; // yesWorld's grant TPD-12
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.parse(DECIDED) + days * DAY);

function limited(days: number | null): World {
  const w = yesWorld();
  w.rules.find((r) => r.actionKey === 'custom_ui' && r.environmentId === DEV)!.approvalDays = days;
  return w;
}

async function askAt(w: World, now: Date) {
  const answer = await answerQuestion(askInput(w, DASHBOARD, DEV), { ...depsFor(w, modelReplying(WEB)), now: () => now });
  return { answer, card: buildCard(answer, { toolName: w.tool.name, environment: w.environments.find((e) => e.id === DEV)!, catalog: w.catalog }) };
}

describe('approvalValidity', () => {
  it('a rule with no limit: the approval always counts', () => {
    expect(approvalValidity(DECIDED, null, at(1000))).toEqual({ ok: true, until: null });
    expect(approvalValidity(null, null, at(1000))).toEqual({ ok: true, until: null });
  });

  it('counts until the limit, and not at or after it', () => {
    const until = at(30).toISOString();
    expect(approvalValidity(DECIDED, 30, at(29.9))).toEqual({ ok: true, until });
    expect(approvalValidity(DECIDED, 30, at(30))).toEqual({ ok: false, expiredAt: until });
    expect(approvalValidity(DECIDED, 30, at(45))).toEqual({ ok: false, expiredAt: until });
  });

  it('reads the decision time as stored in Forge SQL once it is marked UTC', () => {
    expect(approvalValidity('2026-11-24T15:00:00Z', 1, at(0.5))).toEqual({ ok: true, until: '2026-11-25T15:00:00.000Z' });
  });

  it('a decision time that is missing or unreadable, or a limit that is not whole days, counts as run out', () => {
    expect(approvalValidity(null, 30, at(1))).toEqual({ ok: false, expiredAt: null });
    expect(approvalValidity('yesterday', 30, at(1))).toEqual({ ok: false, expiredAt: null });
    for (const days of [0, -3, 1.5, Number.NaN]) expect(approvalValidity(DECIDED, days, at(1))).toEqual({ ok: false, expiredAt: null });
  });
});

describe('an approval under a 30-day rule', () => {
  it('within 30 days: Yes, and the stamp says until when', async () => {
    const { answer, card } = await askAt(limited(30), at(10));
    expect(answer).toMatchObject({ state: 'checked', verdict: 'yes' });
    const policy = card.stamps.find((s) => s.dimension === 'policy')!;
    expect(policy).toMatchObject({ state: 'pass', chip: { label: 'Approved', detail: 'TPD-12', until: at(30).toISOString() } });
  });

  it('after 30 days: Yes, with approval again, with the reason, a new step and no pending request', async () => {
    const { answer, card } = await askAt(limited(30), at(31));
    expect(answer).toMatchObject({ state: 'checked', verdict: 'yes_with_approval' });
    expect(card.reason).toBe('Your approval TPD-12 has expired, so this needs approval again: Needs design review.');
    expect(card.stamps.find((s) => s.dimension === 'policy')).toMatchObject({ state: 'approval', statusText: 'Needs approval', chip: { label: 'Approval expired', detail: 'TPD-12', until: at(30).toISOString() } });
    expect(card.path.map((s) => s.label)).toEqual(['Asked', 'Get approval again', 'Yes']);
    expect(card.action).toEqual({ kind: 'request_approval', label: 'Request approval' });
  });

  it('with no limit on the rule, the same approval still counts a year later', async () => {
    const { answer, card } = await askAt(limited(null), at(365));
    expect(answer).toMatchObject({ state: 'checked', verdict: 'yes' });
    expect(card.stamps.find((s) => s.dimension === 'policy')!.chip).toEqual({ label: 'Approved', detail: 'TPD-12' });
  });

  it('a new request can be raised, says the old one expired, and its approval counts for 30 days again', async () => {
    const x = loopWorld(limited(30));
    x.deps.now = () => at(31);
    const askId = x.addAsk(DEV);
    const r = await raiseApproval(askId, PRIYA, x.deps);
    expect(r).toMatchObject({ ok: true, raised: ['TPD-1'] });
    expect(x.jsm.created[0]!.description).toContain('Their earlier approval, TPD-12, has expired');
    // The new grant is the newest: pending, so the card shows the open request.
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'yes_with_approval', action: { kind: 'approval_requested' } } });

    // The approver resolves it with Done; the fake records the decision time as 2026-11-24 15:00 UTC.
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    x.deps.now = () => at(29);
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'yes' } });
  });
});

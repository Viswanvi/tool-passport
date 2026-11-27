import { describe, expect, it } from 'vitest';
import type { Card, CardAction, Stamp } from '../../src/engine/card';
import { frameView, primaryOf } from '../../src/frontend/card-frame';
import { stampLines } from '../../src/frontend/card-text';

/**
 * The answer card in its Custom UI frame (D59). The page decides what the card's button does and sends the frame
 * a view; the frame only draws it. These are the page's decisions, the same as the UI Kit card makes.
 */

function card(action: CardAction | null, over: Partial<Card> = {}): Card {
  return {
    kind: 'verdict',
    verdict: 'not_ready',
    title: 'Not ready',
    lozenge: 'moved',
    reason: "Frontend build isn't set up in KS-DEV.",
    where: 'KS-DEV · 13.2',
    chips: [],
    action,
    next: [],
    checked: [],
    checks: [{ subject: 'Frontend build', dimension: 'environment', status: 'missing', statusText: 'Missing', chip: { label: 'Assets record', detail: 'Build environments' } }],
    stamps: [],
    path: [],
    banner: null,
    read: ['Build a custom web front end or dashboard'],
    readBy: 'model',
    ...over,
  };
}

describe("the card's button", () => {
  it('raises the fix, the approval or the question the server offers, or checks again', () => {
    expect(primaryOf(card({ kind: 'request_fix', label: 'Request the fix' }))).toEqual({ label: 'Request the fix', does: 'fix' });
    expect(primaryOf(card({ kind: 'request_approval', label: 'Request approval' }))).toEqual({ label: 'Request approval', does: 'approval' });
    expect(primaryOf(card({ kind: 'ask_owner', label: 'Ask the owner' }))).toEqual({ label: 'Ask the owner', does: 'question' });
    expect(primaryOf(card({ kind: 'try_again', label: 'Try again' }))).toEqual({ label: 'Try again', does: 'recheck' });
  });

  it('is words, not a button, when there is nothing to click: an approval already requested, a question outside the catalog, a request open', () => {
    expect(primaryOf(card({ kind: 'request_approval', label: 'Approval requested · TPD-12', requestKey: 'TPD-12' }))).toBeNull();
    expect(primaryOf(card({ kind: 'ask_owner', label: 'Ask the owner' }, { checks: [] }))).toBeNull();
    expect(primaryOf(card({ kind: 'fix_requested', label: 'Fix requested', requests: [] }))).toBeNull();
    expect(primaryOf(card(null))).toBeNull();
  });
});

describe('the view sent to the frame', () => {
  it('says the next step in words where there is no button, and lists what comes next', () => {
    expect(frameView(card({ kind: 'request_approval', label: 'Approval requested · TPD-12', requestKey: 'TPD-12' }), { busy: false, canRecheck: true }).note).toBe('Approval requested · TPD-12');
    expect(frameView(card({ kind: 'ask_owner', label: 'Ask the owner' }, { checks: [] }), { busy: false, canRecheck: true }).note).toBe('Next step: ask the tool owner.');
    expect(frameView(card({ kind: 'request_fix', label: 'Request the fix' }, { next: ['Needs design review'] }), { busy: false, canRecheck: true })).toMatchObject({
      primary: 'Request the fix',
      note: 'Next: Needs design review',
    });
  });

  it('offers Re-check only while a request is open and the answer can be checked again', () => {
    const waiting = card({ kind: 'fix_requested', label: 'Fix requested', requests: [] });
    expect(frameView(waiting, { busy: false, canRecheck: true })).toMatchObject({ primary: null, recheck: true });
    expect(frameView(waiting, { busy: false, canRecheck: false }).recheck).toBe(false);
    expect(frameView(card({ kind: 'request_fix', label: 'Request the fix' }), { busy: true, canRecheck: true })).toMatchObject({ recheck: false, busy: true });
  });
});

describe("a stamp's words", () => {
  const stamp = (over: Partial<Stamp>): Stamp => ({ dimension: 'capability', title: 'Tool can do it', state: 'pass', statusText: 'Yes', detail: null, chip: null, more: 0, ...over });

  it('a passing stamp shows its evidence in a few words; the tooltip has the whole line', () => {
    expect(stampLines(stamp({ chip: { label: 'Owner-verified', detail: '13.2' } }))).toEqual({ third: 'Owner-verified · 13.2', tip: 'Evidence: Owner-verified · 13.2' });
  });

  it('a stamp that did not pass shows what is missing, and counts any further checks in the tooltip', () => {
    const s = stamp({ dimension: 'environment', title: 'Set up here', state: 'missing', statusText: 'Missing', detail: 'Frontend build', chip: { label: 'Policy rule', detail: 'Needs design review' }, more: 1 });
    expect(stampLines(s)).toEqual({ third: 'Frontend build', tip: 'Frontend build · Evidence: Policy rule · Needs design review · +1 more check' });
  });
});

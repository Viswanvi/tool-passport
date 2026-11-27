import { describe, expect, it } from 'vitest';
import type { Card, CardAction, Stamp } from '../../src/engine/card';
import { cellOf, frameView, markChanges, namesText, NO_MARKS, primaryOf, type GridRead, type PassportFrameView } from '../../src/frontend/card-frame';
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

describe('a Passport cell clicked in the frame (D60)', () => {
  const passport: PassportFrameView = {
    tool: 'Kestrel Studio',
    checkedAt: '2026-11-27T12:00:00.000Z',
    environments: [
      { id: 1, name: 'KS-DEV', version: '13.2', change: null },
      { id: 2, name: 'KS-PROD', version: '13.2', change: null },
    ],
    rows: [{ key: 'web_frontend', label: 'Build a custom web front end or dashboard', cells: [{ environmentId: 1, verdict: 'not_ready', title: 'Not ready', change: null }] }],
    picked: null,
    answer: null,
    status: null,
    refreshing: false,
    watch: { seconds: 30 },
    fill: false,
  };

  it('opens only a cell the page sent', () => {
    expect(cellOf({ frameId: 'f', action: 'open-cell', cell: { key: 'web_frontend', environmentId: 1 } }, passport)).toEqual({ key: 'web_frontend', environmentId: 1 });
    // A key or environment the page never showed, another action, or no view at all: nothing is opened.
    expect(cellOf({ frameId: 'f', action: 'open-cell', cell: { key: 'gpu_compute', environmentId: 1 } }, passport)).toBeNull();
    expect(cellOf({ frameId: 'f', action: 'open-cell', cell: { key: 'web_frontend', environmentId: 2 } }, passport)).toBeNull();
    expect(cellOf({ frameId: 'f', action: 'primary', cell: { key: 'web_frontend', environmentId: 1 } }, passport)).toBeNull();
    expect(cellOf({ frameId: 'f', action: 'open-cell', cell: { key: 'web_frontend', environmentId: 1 } }, null)).toBeNull();
  });
});

describe('the Passport keeps itself true (D61)', () => {
  const read = (dev: string, devTitle: string, prodTitle = 'No'): GridRead => ({
    environments: [
      { id: 1, version: dev },
      { id: 2, version: '13.2' },
    ],
    rows: [
      {
        key: 'web_frontend',
        cells: [
          { environmentId: 1, title: devTitle },
          { environmentId: 2, title: prodTitle },
        ],
      },
    ],
  });
  const at = '2026-11-27T12:00:30.000Z';

  it('marks a cell whose answer changed, with what it was, and a version that moved', () => {
    const m = markChanges(read('13.2', 'Yes'), read('14.0', "Don't know yet"), NO_MARKS, { at, byItself: true });
    expect(m.cells).toEqual({ 'web_frontend|1': { from: 'Yes', at, byItself: true } });
    expect(m.versions).toEqual({ 1: { from: '13.2', at } });
  });

  it('marks nothing on a first read, or when nothing changed', () => {
    expect(markChanges(null, read('14.0', "Don't know yet"), NO_MARKS, { at, byItself: true })).toBe(NO_MARKS);
    expect(markChanges(read('13.2', 'Yes'), read('13.2', 'Yes'), NO_MARKS, { at, byItself: true })).toEqual(NO_MARKS);
  });

  it('keeps earlier marks and the latest change of each cell; a cell new in this read is not a change', () => {
    const first = markChanges(read('13.2', 'Yes'), read('14.0', "Don't know yet"), NO_MARKS, { at, byItself: true });
    const later = '2026-11-27T12:05:00.000Z';
    const back = markChanges(read('14.0', "Don't know yet"), read('13.2', 'Yes', 'Yes'), first, { at: later, byItself: false });
    expect(back.cells).toEqual({ 'web_frontend|1': { from: "Don't know yet", at: later, byItself: false }, 'web_frontend|2': { from: 'No', at: later, byItself: false } });
    expect(back.versions).toEqual({ 1: { from: '14.0', at: later } });
    const added: GridRead = { ...read('13.2', 'Yes'), rows: [...read('13.2', 'Yes').rows, { key: 'gpu_compute', cells: [{ environmentId: 1, title: 'No' }] }] };
    expect(markChanges(read('13.2', 'Yes'), added, NO_MARKS, { at, byItself: true })).toEqual(NO_MARKS);
  });

  it('names the environments it watches in plain words', () => {
    expect(namesText(['KS-DEV'])).toBe('KS-DEV');
    expect(namesText(['KS-DEV', 'KS-PROD'])).toBe('KS-DEV and KS-PROD');
    expect(namesText(['A', 'B', 'C'])).toBe('A, B and C');
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

import type { Card } from '../engine/card';
import type { Verdict } from '../engine/model';

/**
 * The answer card drawn in a Custom UI frame (D59). UI Kit's blocks couldn't give the card the look it needs (four
 * stamps in one row, a real verdict banner), so the page draws it in a `Frame`. The frame only draws: the UI Kit
 * page around it keeps every server call (the docs don't say a Frame can call resolvers), decides what the card's
 * button does, and sends the frame this view. The frame sends back which button was clicked. They talk through
 * @forge/bridge events, tagged with the frame's own id so two frames never mix. No Forge imports here: both sides
 * and the tests use it.
 */

export const FRAME_RESOURCE = 'card';

/** Event names. The frame says it is ready (again and again until it gets a view); the page answers with the view. */
export const EVENT = {
  ready: 'tool-passport:card-ready',
  view: 'tool-passport:card-view',
  action: 'tool-passport:card-action',
  /** The page asks frames to say ready again: a page that (re)subscribes after a frame stopped saying it still links. */
  hello: 'tool-passport:card-hello',
} as const;

/** primary and recheck: the card's buttons. open-cell: a Passport cell was clicked. refresh: Check again. */
export type FrameAction = 'primary' | 'recheck' | 'open-cell' | 'refresh';

export interface CardFrameView {
  card: Card;
  /** The main button's label, or none (the card's next step is then words, in `note`). */
  primary: string | null;
  /** While a request is open: a quieter Re-check button. */
  recheck: boolean;
  /** A next step said in words rather than a button. */
  note: string | null;
  busy: boolean;
}

/** One cell of the Passport grid, as the server worked it out for the person looking. */
export interface PassportFrameCell {
  environmentId: number;
  verdict: Verdict | null;
  title: string;
}

/**
 * The Passport tab in the frame (D60): every capability against every environment, and the card of the cell the
 * person opened. Loading and errors are said in `status`; the page keeps every call, as for the card.
 */
export interface PassportFrameView {
  tool: string;
  checkedAt: string;
  environments: Array<{ id: number; name: string; version: string | null }>;
  rows: Array<{ key: string; label: string; cells: PassportFrameCell[] }>;
  picked: { key: string; environmentId: number } | null;
  /** The opened cell's card, once it has come back. */
  answer: CardFrameView | null;
  /** "Checking…" while the opened cell is being checked, or a problem in words. */
  status: string | null;
  /** True while the grid itself is being checked again. */
  refreshing: boolean;
}

export type FrameView = { kind: 'card'; card: CardFrameView } | { kind: 'passport'; passport: PassportFrameView };

export interface ReadyMessage {
  frameId: string;
}

export interface ViewMessage {
  frameId: string;
  view: FrameView | null;
}

export interface ActionMessage {
  frameId: string;
  action: FrameAction;
  /** open-cell only. */
  cell?: { key: string; environmentId: number };
}

/** A clicked cell as the page will act on it: only cells it sent may be opened (the frame decides nothing). */
export function cellOf(m: ActionMessage, view: PassportFrameView | null): { key: string; environmentId: number } | null {
  if (m.action !== 'open-cell' || !m.cell || !view) return null;
  const row = view.rows.find((r) => r.key === m.cell!.key);
  return row && row.cells.some((c) => c.environmentId === m.cell!.environmentId) ? { key: row.key, environmentId: m.cell.environmentId } : null;
}

/** Requests the card waits on: while one is open the card checks again by itself and offers Re-check. */
export const WAITING_KINDS = new Set(['fix_requested', 'approval_requested', 'owner_asked']);

/**
 * What the card's main button does, from the server's action. An approval already requested, or a question outside
 * the catalog (no checks, so the owner can't answer it here, D35), is a next step in words, not a button.
 */
export function primaryOf(card: Card): { label: string; does: 'fix' | 'approval' | 'question' | 'recheck' } | null {
  const a = card.action;
  if (!a) return null;
  switch (a.kind) {
    case 'request_fix':
      return { label: a.label, does: 'fix' };
    case 'request_approval':
      return a.requestKey ? null : { label: a.label, does: 'approval' };
    case 'ask_owner':
      return card.checks.length > 0 ? { label: a.label, does: 'question' } : null;
    case 'recheck':
    case 'try_again':
      return { label: a.label, does: 'recheck' };
    default:
      return null;
  }
}

/** The view the page sends the frame. */
export function frameView(card: Card, x: { busy: boolean; canRecheck: boolean }): CardFrameView {
  const primary = primaryOf(card);
  const kind = card.action?.kind;
  const notes: string[] = [];
  if (kind === 'request_approval' && !primary) notes.push(card.action!.label);
  if (kind === 'ask_owner' && !primary) notes.push('Next step: ask the tool owner.');
  if (card.next.length) notes.push(`Next: ${card.next.join(', ')}`);
  return {
    card,
    primary: primary?.label ?? null,
    recheck: Boolean(kind && WAITING_KINDS.has(kind) && x.canRecheck),
    note: notes.length ? notes.join(' · ') : null,
    busy: x.busy,
  };
}

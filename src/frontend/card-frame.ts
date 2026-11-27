import type { Card } from '../engine/card';

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
} as const;

export type FrameAction = 'primary' | 'recheck';

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

export interface ReadyMessage {
  frameId: string;
}

export interface ViewMessage {
  frameId: string;
  view: CardFrameView | null;
}

export interface ActionMessage {
  frameId: string;
  action: FrameAction;
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

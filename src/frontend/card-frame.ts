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

/**
 * primary and recheck: the card's buttons. open-cell: a Passport cell was clicked. refresh: Check again.
 * fill-docs: the owner's way from the unverified rows to Fill in from your docs.
 */
export type FrameAction = 'primary' | 'recheck' | 'open-cell' | 'refresh' | 'fill-docs';

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

/** A cell whose answer changed between two reads of the grid while the tab was open (D61). */
export interface CellChange {
  /** The answer before. */
  from: string;
  at: string;
  /** True when the tab's own re-check found it; false after a click on Check again. */
  byItself: boolean;
}

/** One cell of the Passport grid, as the server worked it out for the person looking. */
export interface PassportFrameCell {
  environmentId: number;
  verdict: Verdict | null;
  title: string;
  change: CellChange | null;
}

/** An environment whose recorded version changed between two reads. */
export interface VersionChange {
  from: string | null;
  at: string;
}

/**
 * The Passport tab in the frame (D60): every capability against every environment, and the card of the cell the
 * person opened. Loading and errors are said in `status`; the page keeps every call, as for the card.
 */
export interface PassportFrameView {
  tool: string;
  checkedAt: string;
  environments: Array<{ id: number; name: string; version: string | null; change: VersionChange | null }>;
  rows: Array<{ key: string; label: string; cells: PassportFrameCell[] }>;
  picked: { key: string; environmentId: number } | null;
  /** The opened cell's card, once it has come back. */
  answer: CardFrameView | null;
  /** "Checking…" while the opened cell is being checked, or a problem in words. */
  status: string | null;
  /** True while the grid itself is being checked again. */
  refreshing: boolean;
  /** While the tab is open the page reads the grid again by itself, this often (D61); null once it has stopped. */
  watch: { seconds: number } | null;
  /** The person owns this tool: the unverified rows offer Fill in from your docs (D62). The server checks again. */
  fill: boolean;
}

/** What changed on the Passport tab since it opened: cells by `cellId`, versions by environment id. */
export interface PassportMarks {
  cells: Record<string, CellChange>;
  versions: Record<number, VersionChange>;
}

export const NO_MARKS: PassportMarks = { cells: {}, versions: {} };

export const cellId = (key: string, environmentId: number) => `${key}|${environmentId}`;

/** The parts of a grid read that changes are found in. */
export interface GridRead {
  environments: Array<{ id: number; version: string | null }>;
  rows: Array<{ key: string; cells: Array<{ environmentId: number; title: string }> }>;
}

/**
 * Adds what changed from one read of the grid to the next (D61). A cell is marked when its answer differs from the
 * read before; it keeps the latest change. A cell or environment only in one read is not a change. Nothing before
 * (a first read, a new tool) marks nothing.
 */
export function markChanges(before: GridRead | null, after: GridRead, marks: PassportMarks, x: { at: string; byItself: boolean }): PassportMarks {
  if (!before) return marks;
  const was = new Map<string, string>();
  for (const r of before.rows) for (const c of r.cells) was.set(cellId(r.key, c.environmentId), c.title);
  const cells = { ...marks.cells };
  for (const r of after.rows) {
    for (const c of r.cells) {
      const id = cellId(r.key, c.environmentId);
      const from = was.get(id);
      if (from !== undefined && from !== c.title) cells[id] = { from, at: x.at, byItself: x.byItself };
    }
  }
  const versions = { ...marks.versions };
  for (const e of after.environments) {
    const b = before.environments.find((y) => y.id === e.id);
    if (b && b.version !== e.version) versions[e.id] = { from: b.version, at: x.at };
  }
  return { cells, versions };
}

/** "KS-DEV and KS-PROD", "A, B and C". */
export function namesText(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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

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
 * fill-docs: the owner's way from the unverified rows to Fill in from your docs. ask: a question typed or picked on
 * the Ask tab. open-recent: one of the person's recent questions, opened again.
 */
export type FrameAction = 'primary' | 'recheck' | 'open-cell' | 'refresh' | 'fill-docs' | 'ask' | 'open-recent';

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

/** A cell whose answer is not what it was when the tab first read it (D61, D66). */
export interface CellChange {
  /** The answer when the tab first read it. */
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
  /** Each cell's answer and each environment's version when the tab first read them. */
  base: { cells: Record<string, string>; versions: Record<number, string | null> };
}

export const NO_MARKS: PassportMarks = { cells: {}, versions: {}, base: { cells: {}, versions: {} } };

export const cellId = (key: string, environmentId: number) => `${key}|${environmentId}`;

/** The parts of a grid read that changes are found in. */
export interface GridRead {
  environments: Array<{ id: number; version: string | null }>;
  rows: Array<{ key: string; cells: Array<{ environmentId: number; title: string }> }>;
}

/**
 * Adds what changed from one read of the grid to the next (D61). A cell is marked when its answer is no longer what
 * it was when the tab first read it, and the mark says what that was; a cell that goes back to it is no longer
 * marked (D66: KS-DEV moved to 14.0 and back to 13.2 shows as it started). The same for an environment's version.
 * A cell or environment only in one read is not a change. Nothing before (a first read, a new tool) marks nothing.
 */
export function markChanges(before: GridRead | null, after: GridRead, marks: PassportMarks, x: { at: string; byItself: boolean }): PassportMarks {
  if (!before) return marks;
  const was = new Map<string, string>();
  for (const r of before.rows) for (const c of r.cells) was.set(cellId(r.key, c.environmentId), c.title);
  const cells = { ...marks.cells };
  const baseCells = { ...marks.base.cells };
  for (const r of after.rows) {
    for (const c of r.cells) {
      const id = cellId(r.key, c.environmentId);
      const prev = was.get(id);
      if (prev === undefined) continue;
      if (!Object.hasOwn(baseCells, id)) baseCells[id] = prev;
      if (prev === c.title) continue;
      if (c.title === baseCells[id]) delete cells[id];
      else cells[id] = { from: baseCells[id]!, at: x.at, byItself: x.byItself };
    }
  }
  const versions = { ...marks.versions };
  const baseVersions = { ...marks.base.versions };
  for (const e of after.environments) {
    const b = before.environments.find((y) => y.id === e.id);
    if (!b) continue;
    if (!Object.hasOwn(baseVersions, e.id)) baseVersions[e.id] = b.version;
    if (b.version === e.version) continue;
    if (e.version === baseVersions[e.id]) delete versions[e.id];
    else versions[e.id] = { from: baseVersions[e.id] ?? null, at: x.at };
  }
  return { cells, versions, base: { cells: baseCells, versions: baseVersions } };
}

/** "KS-DEV and KS-PROD", "A, B and C". */
export function namesText(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** An answer that changed under the open card ("Not ready → Yes, with approval"). */
export interface ChangedNote {
  from: { title: string; verdict: Verdict | null };
  to: { title: string; verdict: Verdict | null };
  at: string;
  byItself: boolean;
}

/** One of the person's recent questions, as the Ask tab lists it. */
export interface RecentRow {
  askId: number;
  question: string;
  environment: string;
  /** The verdict in the card's words ("Yes, with approval"), or a dash. */
  title: string;
  verdict: string | null;
  mayHaveChanged: boolean;
}

/**
 * The Ask tab in the frame (D63): the question box, the environments to ask about, suggestions, the answer card and
 * the person's recent questions. The page keeps every call; the frame sends what was typed or picked, and the page
 * acts only on an environment or a recent question it sent (`askOf`, `recentOf`).
 */
export interface AskFrameView {
  tool: string;
  /** `value` is what the page asks with: an environment id, or ANY_ENVIRONMENT. */
  environments: Array<{ value: string; name: string }>;
  suggestions: string[];
  /** The question on screen, so the box shows it after an answer or a recent question opened again. */
  asked: { question: string; environment: string } | null;
  /** What the page is waiting for, in plain words, while it waits. */
  working: string | null;
  answer: CardFrameView | null;
  changed: ChangedNote | null;
  /** A problem in words. */
  status: string | null;
  recent: RecentRow[];
}

export type FrameView = { kind: 'card'; card: CardFrameView } | { kind: 'passport'; passport: PassportFrameView } | { kind: 'ask'; ask: AskFrameView };

/** The page's value for "Any environment". */
export const ANY_ENVIRONMENT = 'any';
/** The ask resolver's own limit. */
export const MAX_QUESTION = 500;

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
  /** ask only: the words typed or picked, and the environment's `value`. */
  question?: string;
  environment?: string;
  /** open-recent only. */
  askId?: number;
}

/** A question from the Ask tab as the page will ask it: words within the limit, in an environment the page sent. */
export function askOf(m: ActionMessage, view: AskFrameView | null): { question: string; environment: string } | null {
  if (m.action !== 'ask' || !view || typeof m.question !== 'string' || typeof m.environment !== 'string') return null;
  const question = m.question.trim();
  if (!question || question.length > MAX_QUESTION) return null;
  return view.environments.some((e) => e.value === m.environment) ? { question, environment: m.environment } : null;
}

/** A recent question to open again: only one the page listed. */
export function recentOf(m: ActionMessage, view: AskFrameView | null): number | null {
  if (m.action !== 'open-recent' || !view || typeof m.askId !== 'number') return null;
  return view.recent.some((r) => r.askId === m.askId) ? m.askId : null;
}

/** Verdicts in the card's words, for lists that hold only the stored verdict. */
export const VERDICT_WORDS: Record<string, string> = {
  yes: 'Yes',
  yes_with_approval: 'Yes, with approval',
  not_ready: 'Not ready',
  no: 'No',
  dont_know: "Don't know yet",
  unsupported: "Don't know yet",
};

/**
 * The recent questions the Ask tab lists: this tool's, the newest answer for each question and environment (the
 * server lists newest first), at most `limit`. A question whose text was deleted after 30 days is left out.
 */
export function recentRows(
  asks: Array<{ askId: number; question: string | null; tool: string; environment: string; verdict: string | null; mayHaveChanged: boolean }>,
  tool: string,
  limit = 4,
): RecentRow[] {
  const mine = asks.filter((a): a is typeof a & { question: string } => a.tool === tool && typeof a.question === 'string' && a.question.length > 0);
  return mine
    .filter((a, i) => mine.findIndex((b) => b.question === a.question && b.environment === a.environment) === i)
    .slice(0, limit)
    .map((a) => ({ askId: a.askId, question: a.question, environment: a.environment, title: VERDICT_WORDS[a.verdict ?? ''] ?? '—', verdict: a.verdict, mayHaveChanged: a.mayHaveChanged }));
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

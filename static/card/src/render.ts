import type { Card, PathStep, Stamp } from '../../../src/engine/card';
import {
  cellId,
  MAX_QUESTION,
  namesText,
  type AskFrameView,
  type CardFrameView,
  type ChangedNote,
  type FrameAction,
  type PassportFrameView,
} from '../../../src/frontend/card-frame';
import { checkLine, chipText, stampLines, time } from '../../../src/frontend/card-text';
import { ICONS, type IconName } from './icons';

/**
 * Draws the answer card (D59) from the view the page sent. Everything shown comes from the server's card; this
 * only lays it out. Text always goes in through textContent; only the fixed icons are markup. No inline styles:
 * Forge's default content policy blocks them, so every look is a class in card.css.
 */

type State = Stamp['state'];

const VERDICT_STATE: Record<string, State> = { yes: 'pass', yes_with_approval: 'approval', not_ready: 'missing', no: 'fail', dont_know: 'unknown' };
const STATE_ICON: Record<State, IconName> = { pass: 'check', approval: 'clock', missing: 'alert', unknown: 'question', fail: 'ban', not_checked: 'minus', none: 'minus' };
const DIMENSION_ICON: Record<Stamp['dimension'], IconName> = { capability: 'cube', policy: 'shield', environment: 'server', access: 'key' };

const RULES_DECIDE =
  "The AI only matches your words to this tool's list. Fixed rules check the evidence and give the answer, so the AI can never say Yes on its own.";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name: IconName, cls = 'tp-icon'): HTMLSpanElement {
  const s = el('span', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}

/** "AI read your question as [label] · Rules decide", or "Checked [label]" for a Passport cell. */
function readStrip(c: Card): HTMLElement {
  const ai = c.readBy === 'model';
  const s = el('div', 'tp-read');
  s.append(icon(ai ? 'sparkles' : 'search', 'tp-icon tp-icon-ai'), el('span', 'tp-read-label', ai ? 'AI read your question as' : 'Checked'));
  for (const r of c.read) s.append(el('span', 'tp-pill', r));
  if (ai) {
    const b = el('span', 'tp-badge', 'Rules decide');
    b.title = RULES_DECIDE;
    s.append(b);
  }
  return s;
}

function hero(c: Card, state: State): HTMLElement {
  const h = el('div', 'tp-hero');
  const badge = el('div', 'tp-hero-icon');
  badge.append(icon(STATE_ICON[state]));
  const words = el('div', 'tp-hero-words');
  words.append(el('div', 'tp-verdict', c.title), el('div', 'tp-reason', c.reason));
  h.append(badge, words);
  if (c.where) {
    const w = el('div', 'tp-where');
    w.append(icon('passport'), document.createTextNode(c.where));
    h.append(w);
  }
  return h;
}

/** The four passport stamps: what was checked, the answer, and a few words of evidence; the rest in the tooltip. */
function stamps(list: Stamp[]): HTMLElement {
  const g = el('div', 'tp-stamps');
  for (const st of list) {
    const { third, tip } = stampLines(st);
    const card = el('div', `tp-stamp tp-s-${st.state}`);
    if (tip) card.title = tip;
    const ring = el('div', 'tp-ring');
    const mark = el('span', 'tp-mark');
    mark.append(icon(STATE_ICON[st.state]));
    ring.append(icon(DIMENSION_ICON[st.dimension]), mark);
    card.append(ring, el('div', 'tp-stamp-title', st.title), el('div', 'tp-stamp-status', st.statusText));
    if (third) card.append(el('div', 'tp-stamp-evidence', third));
    g.append(card);
  }
  return g;
}

/** Asked → each fix or approval → Yes. Done steps are filled; the first step not done is the current one. */
function path(steps: PathStep[]): HTMLElement {
  const wrap = el('div', 'tp-path');
  wrap.append(el('span', 'tp-path-label', 'Path to Yes'));
  const list = el('ol', 'tp-steps');
  const current = steps.findIndex((s) => s.state !== 'done');
  steps.forEach((s, i) => {
    const kind = s.state === 'done' ? 'done' : i === current ? 'current' : s.state === 'requested' ? 'requested' : 'todo';
    const li = el('li', `tp-step tp-step-${kind}`);
    const dot = el('span', 'tp-step-dot');
    if (s.state === 'done') dot.append(icon('check'));
    li.append(dot, el('span', 'tp-step-label', s.label));
    list.append(li);
  });
  wrap.append(list);
  return wrap;
}

export interface RenderOptions {
  /** Stamps land with a short animation: the first time, and when the answer changes. */
  animate: boolean;
  detailsOpen: boolean;
  onAction(a: FrameAction): void;
  onToggleDetails(): void;
}

function button(label: string, cls: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

export function renderCard(v: CardFrameView, o: RenderOptions): HTMLElement {
  const c = v.card;
  const state: State = c.verdict ? (VERDICT_STATE[c.verdict] ?? 'none') : 'none';
  const root = el('article', `tp-card tp-v-${state}${o.animate ? ' tp-animate' : ''}`);
  root.setAttribute('aria-busy', String(v.busy));

  if (c.read.length) root.append(readStrip(c));
  root.append(hero(c, state));
  if (c.banner) root.append(el('div', 'tp-banner', c.banner));
  if (c.stamps.length) root.append(stamps(c.stamps));
  else if (c.chips.length) {
    const chips = el('div', 'tp-chips');
    for (const ch of c.chips) chips.append(el('span', 'tp-chip', chipText(ch)));
    root.append(chips);
  }
  if (c.path.length) root.append(path(c.path));

  const foot = el('div', 'tp-foot');
  if (v.primary) foot.append(button(v.primary, 'tp-btn tp-btn-primary', v.busy, () => o.onAction('primary')));
  if (v.recheck) foot.append(button('Re-check', 'tp-btn', v.busy, () => o.onAction('recheck')));
  if (v.note) foot.append(el('span', 'tp-note', v.note));
  if (c.checks.length) foot.append(button(o.detailsOpen ? 'Hide details' : 'Details', 'tp-btn tp-btn-link', false, o.onToggleDetails));
  if (foot.childElementCount) root.append(foot);

  if (o.detailsOpen && c.checks.length) {
    const d = el('ul', 'tp-details');
    for (const k of c.checks) d.append(el('li', undefined, checkLine(k)));
    root.append(d);
  }
  if (c.checked.length && !c.stamps.length && !c.read.length) root.append(el('p', 'tp-small', `I checked: ${c.checked.join(' · ')}`));
  return root;
}

// ---- The Passport tab (D60): every capability against every environment, then the opened cell's card ----

type Cell = { key: string; environmentId: number };

export interface PassportOptions {
  /** The grid rises in once, when the tab first shows. */
  animateGrid: boolean;
  /** Cells (by cellId) whose change is new in this view: they flip once. */
  flips: ReadonlySet<string>;
  /** The opened card's stamps land when its answer first shows or changes. */
  animateCard: boolean;
  detailsOpen: boolean;
  showUnknown: boolean;
  onAction(a: FrameAction, cell?: Cell): void;
  onToggleDetails(): void;
  onToggleUnknown(): void;
}

// "unsupported" is stored for questions outside the catalog; the card calls it Don't know yet.
const stateOf = (verdict: string | null): State => (verdict ? (VERDICT_STATE[verdict === 'unsupported' ? 'dont_know' : verdict] ?? 'none') : 'none');

/** A verdict as a coloured chip that isn't a button: in notes and lists. */
function verdictChip(verdict: string | null, title: string): HTMLElement {
  const s = stateOf(verdict);
  const c = el('span', `tp-cell tp-cell-static tp-v-${s}`);
  c.append(icon(STATE_ICON[s]), document.createTextNode(title));
  return c;
}

/** Capabilities down the side, environments across the top; each cell is a coloured verdict that opens its card. */
function grid(p: PassportFrameView, rows: PassportFrameView['rows'], o: PassportOptions, label: string): HTMLElement {
  const wrap = el('div', 'tp-grid-wrap');
  const table = el('table', 'tp-grid');
  table.setAttribute('aria-label', label);
  const head = el('tr');
  head.append(el('th', 'tp-th-cap', 'Capability'));
  for (const e of p.environments) {
    const th = el('th');
    const yes = rows.filter((r) => r.cells.some((c) => c.environmentId === e.id && c.verdict === 'yes')).length;
    th.append(el('span', 'tp-env-name', e.name));
    if (e.change) {
      // The version moved while the tab was open: old one struck through, new one marked.
      const v = el('span', 'tp-env-meta tp-env-moved');
      if (e.change.from) v.append(el('s', 'tp-ver-was', e.change.from), document.createTextNode(' → '));
      v.append(el('strong', undefined, e.version ?? 'no version'));
      v.title = `${e.name}'s recorded version changed at ${time(e.change.at)}.`;
      th.append(v, el('span', 'tp-env-meta', `${yes} of ${rows.length} Yes`));
    } else th.append(el('span', 'tp-env-meta', `${e.version ? `${e.version} · ` : ''}${yes} of ${rows.length} Yes`));
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    tr.append(el('td', 'tp-cap', r.label));
    for (const e of p.environments) {
      const td = el('td');
      const c = r.cells.find((x) => x.environmentId === e.id);
      if (c) {
        const state = stateOf(c.verdict);
        const picked = p.picked?.key === r.key && p.picked.environmentId === e.id;
        const id = cellId(r.key, e.id);
        const cls = ['tp-cell', `tp-v-${state}`];
        if (picked) cls.push('tp-cell-picked');
        if (c.change) cls.push('tp-cell-changed');
        if (o.flips.has(id)) cls.push('tp-cell-flip');
        const b = el('button', cls.join(' '));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(picked));
        b.title = c.change
          ? `${r.label} in ${e.name}: ${c.title}. It was ${c.change.from} until ${time(c.change.at)}. Click to see why.`
          : `${r.label} in ${e.name}: ${c.title}. Click to see why.`;
        b.append(icon(STATE_ICON[state]), document.createTextNode(c.title));
        b.addEventListener('click', () => o.onAction('open-cell', { key: r.key, environmentId: e.id }));
        td.append(b);
        if (c.change) td.append(el('span', 'tp-was', `was ${c.change.from}`));
      }
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(thead, body);
  wrap.append(table);
  return wrap;
}

/** "Watching KS-DEV and KS-PROD · checks again every 30 seconds", or that the watch has stopped. */
function watchLine(p: PassportFrameView): HTMLElement {
  if (!p.watch) return el('div', 'tp-watch tp-watch-off', 'Stopped checking by itself after 30 minutes. Check again to start.');
  const w = el('div', 'tp-watch');
  w.title = 'While this tab is open it checks every cell again by itself, so an answer that stops being true changes here without anyone asking.';
  w.append(el('span', 'tp-pulse'), el('span', undefined, `Watching ${namesText(p.environments.map((e) => e.name))} · checks again every ${p.watch.seconds} seconds`));
  return w;
}

/** What changed since the tab opened: how many answers, when, and any version that moved. */
function changesBanner(p: PassportFrameView, fresh: boolean): HTMLElement | null {
  const changed = p.rows.flatMap((r) => r.cells.filter((c) => c.change).map((c) => c.change!));
  const moved = p.environments.filter((e) => e.change);
  if (!changed.length && !moved.length) return null;
  const latest = [...changed.map((c) => c.at), ...moved.map((e) => e.change!.at)].sort().pop()!;
  const b = el('div', `tp-changes${fresh ? ' tp-animate' : ''}`);
  b.setAttribute('role', 'status');
  const words = el('div', 'tp-changes-words');
  const n = changed.length;
  words.append(el('div', 'tp-changes-title', n ? `${n} answer${n === 1 ? '' : 's'} changed at ${time(latest)}` : `A version changed at ${time(latest)}`));
  const lines: string[] = moved.map((e) => (e.change!.from ? `${e.name} moved from ${e.change!.from} to ${e.version ?? 'no version'}.` : `${e.name} now reads ${e.version ?? 'no version'}.`));
  if (n && changed.every((c) => c.byItself)) lines.push('Nobody asked: the passport checked again by itself.');
  // The rule behind a cell that turned Don't know yet when its version moved (spec: facts are per tool version).
  const unknownNow = p.rows.some((r) => r.cells.some((c) => c.change && c.verdict === 'dont_know'));
  if (moved.length && unknownNow) lines.push('Facts recorded for the old version are not vouched for on the new one until the owner checks them again.');
  if (lines.length) words.append(el('div', 'tp-changes-sub', lines.join(' ')));
  b.append(icon('alert', 'tp-icon tp-changes-icon'), words);
  return b;
}

// ---- The Ask tab (D63): the question box, environments, suggestions, the card and recent questions ----

export interface AskOptions {
  animateCard: boolean;
  detailsOpen: boolean;
  /** The words in the box and the environment picked: the frame's own, so a redraw never loses them. */
  draft: string;
  environment: string;
  onDraft(text: string): void;
  onEnvironment(value: string): void;
  onAsk(question: string): void;
  onRecent(askId: number): void;
  onAction(a: FrameAction): void;
  onToggleDetails(): void;
}

/** "Changed by itself at 10:44: Not ready → Yes, with approval". */
function changedNote(c: ChangedNote, fresh: boolean): HTMLElement {
  const n = el('div', `tp-changed-note${fresh ? ' tp-animate' : ''}`);
  n.setAttribute('role', 'status');
  n.append(
    el('span', 'tp-changed-when', c.byItself ? `Changed by itself at ${time(c.at)}` : `Checked again at ${time(c.at)}`),
    verdictChip(c.from.verdict, c.from.title),
    el('span', 'tp-arrow', '→'),
    verdictChip(c.to.verdict, c.to.title),
  );
  return n;
}

export function renderAsk(v: AskFrameView, o: AskOptions): HTMLElement {
  const root = el('section', 'tp-ask');
  const busy = v.working !== null;

  const hero = el('div', 'tp-ask-hero');
  const title = el('div', 'tp-ask-title');
  title.append(icon('passport', 'tp-icon tp-pp-icon'), document.createTextNode(`Can I … with ${v.tool}?`));
  hero.append(title);

  const form = el('form', 'tp-ask-box');
  const input = el('input', 'tp-ask-input');
  input.type = 'text';
  input.maxLength = MAX_QUESTION;
  input.placeholder = 'Can I build a dashboard for the sales team?';
  input.value = o.draft;
  input.setAttribute('aria-label', `Your question about ${v.tool}`);
  input.addEventListener('input', () => o.onDraft(input.value));
  const go = button(busy ? 'Checking…' : 'Ask', 'tp-btn tp-btn-primary tp-ask-go', busy, () => undefined);
  go.type = 'submit';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!busy && input.value.trim()) o.onAsk(input.value);
  });
  form.append(icon('search', 'tp-icon tp-ask-search'), input, go);
  hero.append(form);

  const envs = el('div', 'tp-ask-row');
  envs.setAttribute('role', 'radiogroup');
  envs.setAttribute('aria-label', 'Environment');
  envs.append(el('span', 'tp-ask-label', 'In'));
  for (const e of v.environments) {
    const on = e.value === o.environment;
    const b = button(e.name, `tp-env-pill${on ? ' tp-env-on' : ''}`, false, () => o.onEnvironment(e.value));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    envs.append(b);
  }
  hero.append(envs);

  if (v.suggestions.length) {
    const tries = el('div', 'tp-ask-row');
    tries.append(el('span', 'tp-ask-label', 'Try'));
    for (const s of v.suggestions) {
      tries.append(
        button(s, 'tp-suggest', busy, () => {
          o.onDraft(s);
          o.onAsk(s);
        }),
      );
    }
    hero.append(tries);
  }
  const note = el('div', 'tp-ask-note');
  note.append(icon('sparkles', 'tp-icon tp-icon-ai'), document.createTextNode('The AI only reads your question. Fixed rules check the evidence and decide.'));
  hero.append(note);
  root.append(hero);

  if (v.working) {
    const w = el('div', 'tp-working');
    w.setAttribute('role', 'status');
    w.append(el('span', 'tp-spinner'), el('span', undefined, v.working));
    root.append(w);
  }
  if (v.changed && v.answer) root.append(changedNote(v.changed, o.animateCard));
  if (v.status) root.append(el('div', 'tp-status', v.status));
  if (v.answer) root.append(renderCard(v.answer, { animate: o.animateCard, detailsOpen: o.detailsOpen, onAction: o.onAction, onToggleDetails: o.onToggleDetails }));

  if (v.recent.length) {
    const list = el('div', 'tp-recent');
    list.append(el('div', 'tp-recent-title', 'Your recent questions'));
    for (const r of v.recent) {
      const row = el('button', 'tp-recent-row');
      row.type = 'button';
      row.disabled = busy;
      row.title = r.mayHaveChanged ? 'A version change touched the evidence: ask again for the answer today.' : 'Open this answer again, checked today.';
      const words = el('span', 'tp-recent-words');
      words.append(el('span', 'tp-recent-q', r.question), el('span', 'tp-recent-env', r.environment));
      row.append(verdictChip(r.verdict, r.title), words);
      if (r.mayHaveChanged) row.append(el('span', 'tp-recent-moved', 'May have changed'));
      row.append(el('span', 'tp-recent-go', 'Ask again'));
      row.addEventListener('click', () => o.onRecent(r.askId));
      list.append(row);
    }
    root.append(list);
  }
  return root;
}

export function renderPassport(p: PassportFrameView, o: PassportOptions): HTMLElement {
  const root = el('section', `tp-passport${o.animateGrid ? ' tp-animate-grid' : ''}`);

  const head = el('div', 'tp-pp-head');
  const titles = el('div');
  const title = el('div', 'tp-pp-title');
  title.append(icon('passport', 'tp-icon tp-pp-icon'), document.createTextNode(`Your passport for ${p.tool}`));
  titles.append(title, el('div', 'tp-pp-sub', `Checked as you at ${time(p.checkedAt)}. Click any answer to see why.`), watchLine(p));
  head.append(titles, button(p.refreshing ? 'Checking…' : 'Check again', 'tp-btn', p.refreshing, () => o.onAction('refresh')));
  root.append(head);
  const banner = changesBanner(p, o.flips.size > 0);
  if (banner) root.append(banner);

  // Rows nobody has verified anywhere are folded away, so the grid leads with what is known. A row with a change
  // stays in view: the change is the news.
  const unknown = p.rows.filter((r) => r.cells.length > 0 && r.cells.every((c) => c.verdict === 'dont_know' && !c.change));
  const known = p.rows.filter((r) => !unknown.includes(r));
  root.append(grid(p, known, o, `What you can do with ${p.tool}, by environment`));
  if (unknown.length) {
    const fold = el('div', 'tp-fold');
    fold.append(
      el('span', 'tp-fold-badge', `Not verified yet · ${unknown.length}`),
      el('span', 'tp-small', p.fill ? 'Nobody has verified these yet.' : "Nobody has verified these, so they are Don't know yet everywhere."),
      button(o.showUnknown ? 'Hide them' : 'Show them', 'tp-btn tp-btn-link', false, o.onToggleUnknown),
    );
    // The owner goes straight from the gap to filling it: the AI drafts each fact from their docs, they accept.
    if (p.fill) {
      const b = button('Fill them in from your docs', 'tp-btn tp-btn-primary tp-btn-small', false, () => o.onAction('fill-docs'));
      b.prepend(icon('sparkles', 'tp-icon tp-icon-ai'));
      fold.append(b);
    }
    root.append(fold);
    if (o.showUnknown) root.append(grid(p, unknown, o, `Capabilities of ${p.tool} nobody has verified yet`));
  }

  if (p.picked) {
    const row = p.rows.find((r) => r.key === p.picked!.key);
    const env = p.environments.find((e) => e.id === p.picked!.environmentId);
    root.append(el('div', 'tp-pp-answer-title', `${row?.label ?? ''} · ${env?.name ?? ''}`));
    if (p.status) root.append(el('div', 'tp-small', p.status));
    if (p.answer) {
      root.append(
        renderCard(p.answer, {
          animate: o.animateCard,
          detailsOpen: o.detailsOpen,
          onAction: (a) => o.onAction(a),
          onToggleDetails: o.onToggleDetails,
        }),
      );
    }
  }
  return root;
}

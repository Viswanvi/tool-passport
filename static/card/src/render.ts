import type { Card, PathStep, Stamp } from '../../../src/engine/card';
import type { CardFrameView, FrameAction } from '../../../src/frontend/card-frame';
import { checkLine, chipText, stampLines } from '../../../src/frontend/card-text';
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

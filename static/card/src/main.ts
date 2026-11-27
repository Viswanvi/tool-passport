import { events, view } from '@forge/bridge';
import { cellId, EVENT, type ActionMessage, type FrameAction, type FrameView, type ReadyMessage, type ViewMessage } from '../../../src/frontend/card-frame';
import { renderAsk, renderCard, renderPassport, yesCounts } from './render';
import './card.css';

/**
 * The answer card frame (D59), and the Passport tab (D60). It draws what the page sends and reports what was
 * clicked; it calls no resolver and holds nothing worth keeping. Its own id keeps it from reading another frame's
 * messages.
 */

const frameId = `card-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
const root = document.getElementById('root')!;

let current: FrameView | null = null;
let shownAnswer: string | null = null;
let gridShown = false;
let detailsOpen = false;
let showUnknown = false;
let answered = false;
let showSame = false;
// Changes already flipped (cell and time), so a cell flips once per change and not on every redraw.
const flipped = new Set<string>();
// Version changes already shown moving (environment and time), so a card lights up once per change.
const stamped = new Set<string>();
// Each environment's Yes count as last shown, so a changed count counts to the new one.
const lastYes = new Map<number, number>();
let freshEnvs = new Set<number>();
let countFrom = new Map<number, number>();

/** What moved in this view: environments with a new version change, and counts that differ from the last view. */
function takeMoves(v: FrameView | null) {
  freshEnvs = new Set();
  countFrom = new Map();
  if (v?.kind !== 'passport') return;
  const p = v.passport;
  for (const e of p.environments) {
    if (!e.change) continue;
    const sig = `${e.id}@${e.change.at}`;
    if (!stamped.has(sig)) {
      stamped.add(sig);
      freshEnvs.add(e.id);
    }
  }
  for (const [id, n] of yesCounts(p)) {
    const before = lastYes.get(id);
    if (before !== undefined && before !== n) countFrom.set(id, before);
    lastYes.set(id, n);
  }
}

const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Counts each changed number from the old value to the new one, as its bar grows in again. */
function runCounters() {
  for (const n of Array.from(root.querySelectorAll<HTMLElement>('.tp-visa-n[data-from]'))) {
    const from = Number(n.dataset.from);
    const to = Number(n.dataset.to);
    delete n.dataset.from;
    if (calm() || !Number.isFinite(from) || !Number.isFinite(to)) {
      n.textContent = String(to);
      continue;
    }
    const start = performance.now() + 450;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / 900));
      n.textContent = String(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(step);
      else n.classList.add('tp-visa-n-done');
    };
    requestAnimationFrame(step);
  }
}

/** Cells whose change is new in this view. */
function newFlips(v: FrameView | null): Set<string> {
  const fresh = new Set<string>();
  if (v?.kind !== 'passport') return fresh;
  for (const r of v.passport.rows) {
    for (const c of r.cells) {
      if (!c.change) continue;
      const sig = `${cellId(r.key, c.environmentId)}@${c.change.at}`;
      if (flipped.has(sig)) continue;
      flipped.add(sig);
      fresh.add(cellId(r.key, c.environmentId));
    }
  }
  return fresh;
}

// The Ask tab's box and environment are the frame's own: a view arriving while someone types must not undo it.
let askDraft = '';
let askEnv: string | null = null;
let askedShown: string | null = null;

function send(action: FrameAction, extra: Omit<ActionMessage, 'frameId' | 'action'> = {}) {
  const m: ActionMessage = { frameId, action, ...extra };
  void events.emit(EVENT.action, m);
}

/** What the card shows, so it animates when the answer (or the opened cell) changes and not on a quiet re-check. */
function answerKey(v: FrameView | null): string | null {
  if (!v) return null;
  if (v.kind === 'card') return v.card.card.title;
  if (v.kind === 'ask') return v.ask.answer ? `${v.ask.asked?.question}|${v.ask.asked?.environment}|${v.ask.answer.card.title}` : null;
  const p = v.passport;
  return p.answer ? `${p.picked?.key}|${p.picked?.environmentId}|${p.answer.card.title}` : null;
}

/** The page says which question is on screen (asked, or a recent one opened again): the box shows it. */
function takeAsked(v: FrameView | null) {
  if (v?.kind !== 'ask') return;
  const a = v.ask;
  const key = a.asked ? `${a.asked.question}|${a.asked.environment}` : null;
  if (key !== askedShown && a.asked) {
    askDraft = a.asked.question;
    if (a.environments.some((e) => e.value === a.asked!.environment)) askEnv = a.asked.environment;
  }
  askedShown = key;
  if (!a.environments.some((e) => e.value === askEnv)) askEnv = a.environments[0]?.value ?? null;
}

/** Redraws keep the question box focused, with the caret where it was. */
function keepFocus(redraw: () => void) {
  const before = document.activeElement;
  const typing = before instanceof HTMLInputElement && before.classList.contains('tp-ask-input');
  const caret = typing ? [before.selectionStart, before.selectionEnd] : null;
  redraw();
  if (!typing) return;
  const input = root.querySelector<HTMLInputElement>('.tp-ask-input');
  if (!input) return;
  input.focus();
  const [start, end] = caret ?? [null, null];
  if (typeof start === 'number' && typeof end === 'number') input.setSelectionRange(start, end);
}

function draw(animateCard: boolean, flips: ReadonlySet<string> = new Set()) {
  if (!current) {
    root.replaceChildren();
    return;
  }
  const onToggleDetails = () => {
    detailsOpen = !detailsOpen;
    draw(false);
  };
  if (current.kind === 'card') {
    root.replaceChildren(renderCard(current.card, { animate: animateCard, detailsOpen, onAction: (a) => send(a), onToggleDetails }));
    return;
  }
  if (current.kind === 'ask') {
    const ask = current.ask;
    keepFocus(() =>
      root.replaceChildren(
        renderAsk(ask, {
          animateCard,
          detailsOpen,
          draft: askDraft,
          environment: askEnv ?? '',
          onDraft: (text) => {
            askDraft = text;
          },
          onEnvironment: (value) => {
            askEnv = value;
            draw(false);
          },
          onAsk: (question) => {
            if (askEnv !== null) send('ask', { question, environment: askEnv });
          },
          onRecent: (askId) => send('open-recent', { askId }),
          onAction: (a) => send(a),
          onToggleDetails,
        }),
      ),
    );
    return;
  }
  const animateGrid = !gridShown;
  gridShown = true;
  root.replaceChildren(
    renderPassport(current.passport, {
      animateGrid,
      flips,
      // Set only while drawing the view that brought the move (cleared after it), so a redraw for a click shows it settled.
      freshEnvs,
      countFrom,
      showSame,
      onToggleSame: () => {
        showSame = !showSame;
        draw(false);
      },
      animateCard,
      detailsOpen,
      showUnknown,
      onAction: (a, cell) => send(a, cell ? { cell } : {}),
      onToggleDetails,
      onToggleUnknown: () => {
        showUnknown = !showUnknown;
        draw(false);
      },
    }),
  );
}

async function start() {
  // The host's theme (light or dark) and Atlassian's design tokens; the card has plain colours to fall back on.
  await view.theme.enable().catch(() => undefined);
  await events.on(EVENT.view, async (m: ViewMessage) => {
    if (!m || m.frameId !== frameId) return;
    answered = true;
    const key = answerKey(m.view);
    const animate = key !== null && key !== shownAnswer;
    if (key !== shownAnswer) detailsOpen = false;
    current = m.view;
    shownAnswer = key;
    takeAsked(m.view);
    takeMoves(m.view);
    draw(animate, newFlips(m.view));
    runCounters();
    freshEnvs = new Set();
    countFrom = new Map();
  });
  // The page may start listening after this frame starts, so say ready until it answers (about 15 seconds at most),
  // and again whenever a page asks (it subscribed again after this frame had stopped saying it).
  const ready: ReadyMessage = { frameId };
  await events.on(EVENT.hello, async () => {
    await events.emit(EVENT.ready, ready);
  });
  void events.emit(EVENT.ready, ready);
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (answered || tries > 50) clearInterval(timer);
    else void events.emit(EVENT.ready, ready);
  }, 300);
}

void start();

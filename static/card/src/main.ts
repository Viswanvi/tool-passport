import { events, view } from '@forge/bridge';
import { EVENT, type ActionMessage, type FrameAction, type FrameView, type ReadyMessage, type ViewMessage } from '../../../src/frontend/card-frame';
import { renderCard, renderPassport } from './render';
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

function send(action: FrameAction, cell?: ActionMessage['cell']) {
  const m: ActionMessage = cell ? { frameId, action, cell } : { frameId, action };
  void events.emit(EVENT.action, m);
}

/** What the card shows, so it animates when the answer (or the opened cell) changes and not on a quiet re-check. */
function answerKey(v: FrameView | null): string | null {
  if (!v) return null;
  if (v.kind === 'card') return v.card.card.title;
  const p = v.passport;
  return p.answer ? `${p.picked?.key}|${p.picked?.environmentId}|${p.answer.card.title}` : null;
}

function draw(animateCard: boolean) {
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
  const animateGrid = !gridShown;
  gridShown = true;
  root.replaceChildren(
    renderPassport(current.passport, {
      animateGrid,
      animateCard,
      detailsOpen,
      showUnknown,
      onAction: send,
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
    draw(animate);
  });
  // The page may start listening after this frame starts, so say ready until it answers (about 15 seconds at most).
  const ready: ReadyMessage = { frameId };
  void events.emit(EVENT.ready, ready);
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (answered || tries > 50) clearInterval(timer);
    else void events.emit(EVENT.ready, ready);
  }, 300);
}

void start();

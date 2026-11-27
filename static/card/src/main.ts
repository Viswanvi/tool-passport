import { events, view } from '@forge/bridge';
import { EVENT, type ActionMessage, type CardFrameView, type FrameAction, type ReadyMessage, type ViewMessage } from '../../../src/frontend/card-frame';
import { renderCard } from './render';
import './card.css';

/**
 * The answer card frame (D59). It draws what the page sends and reports which button was clicked; it calls no
 * resolver and holds no state worth keeping. Its own id keeps it from reading another frame's messages.
 */

const frameId = `card-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
const root = document.getElementById('root')!;

let current: CardFrameView | null = null;
let shownTitle: string | null = null;
let detailsOpen = false;
let answered = false;

function send(action: FrameAction) {
  const m: ActionMessage = { frameId, action };
  void events.emit(EVENT.action, m);
}

function draw(animate: boolean) {
  if (!current) {
    root.replaceChildren();
    return;
  }
  root.replaceChildren(
    renderCard(current, {
      animate,
      detailsOpen,
      onAction: send,
      onToggleDetails: () => {
        detailsOpen = !detailsOpen;
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
    const title = m.view?.card.title ?? null;
    // Animate when the answer first shows or changes, not on every quiet re-check.
    const animate = title !== shownTitle;
    if (animate) detailsOpen = false;
    current = m.view;
    shownTitle = title;
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

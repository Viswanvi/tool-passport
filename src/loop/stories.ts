import { verdictTitle, type Card, type Chip } from '../engine/card';
import { cardWithRequests, type LoopDeps, type Rechecked } from './requests';

/**
 * "Add to story" (D53), without Forge. The person posts the answer to the work item as their own comment, built by
 * code from the stored ask checked again now: the card's fixed words, its stamps and their evidence, the path to Yes.
 * The story is remembered with the verdict it was told. When a later re-check of that ask (a request resolved, a
 * question answered) gives a different verdict, the app adds the new answer to the story once: compare-and-set on
 * the remembered verdict, so an event and the sweep arriving together post one update.
 */

export interface StoryShare {
  id: number;
  issueKey: string;
  /** The verdict the story was last told. */
  verdict: string;
}

export interface StoryShareStore {
  /** Remember (or update) the story an ask's answer was posted on; safe to repeat. */
  save(s: { askId: number; toolId: number; issueKey: string; verdict: string }): Promise<void>;
  forAsk(askId: number): Promise<StoryShare[]>;
  /** Move the remembered verdict from `from` to `to`; true if this call made the move. */
  moveVerdict(id: number, from: string, to: string): Promise<boolean>;
}

export type Adf = { type: 'doc'; version: 1; content: AdfNode[] };
type AdfNode = { type: string; [k: string]: unknown };

export class StoryCommentError extends Error {
  constructor(
    readonly code: 'not_allowed' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'StoryCommentError';
  }
}

export interface StoryCommenter {
  /** As the person, so Jira checks they may comment and shows them as the author. */
  asUser(issueKey: string, body: Adf): Promise<void>;
  /** As the app: the update after a re-check, when nobody is signed in. */
  asApp(issueKey: string, body: Adf): Promise<void>;
}

export interface StoryLinks {
  shares: StoryShareStore;
  comments: StoryCommenter;
}

// ---- the comment ---------------------------------------------------------------------------------------

const text = (t: string, strong = false): AdfNode => ({ type: 'text', text: t, ...(strong ? { marks: [{ type: 'strong' }] } : {}) });
const paragraph = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content: content.filter((n) => n.type !== 'text' || n.text !== '') });
const mention = (accountId: string): AdfNode => ({ type: 'mention', attrs: { id: accountId } });
const bullets = (items: string[]): AdfNode => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [paragraph(text(i))] })) });

/** Evidence in words for a comment: no viewer time zone here, so dates are YYYY-MM-DD (UTC). */
function evidence(c: Chip): string {
  const when = c.until ? ` · ${c.label === 'Approval expired' ? 'on' : 'until'} ${c.until.slice(0, 10)}` : '';
  return `${c.label} · ${c.detail}${when}`;
}

/** The card as comment blocks: what was checked and how it stands. */
function cardBlocks(card: Card): AdfNode[] {
  const blocks: AdfNode[] = [paragraph(text(card.reason))];
  if (card.stamps.length) {
    blocks.push(bullets(card.stamps.map((s) => `${s.title}: ${s.statusText}${s.detail ? ` · ${s.detail}` : ''}${s.chip ? ` (${evidence(s.chip)})` : ''}`)));
  } else if (card.chips.length) {
    blocks.push(bullets(card.chips.map(evidence)));
  }
  if (card.path.length) blocks.push(paragraph(text('Path to Yes: ', true), text(card.path.map((p) => p.label).join(' → '))));
  return blocks;
}

const heading = (card: Card, toolName: string) => ` · ${toolName}${card.where ? ` in ${card.where}` : ''}`;

/** The comment the person posts. */
export function storyComment(card: Card, x: { toolName: string; asker: string }): Adf {
  return {
    type: 'doc',
    version: 1,
    content: [
      paragraph(text(`Tool Passport: ${card.title}`, true), text(heading(card, x.toolName))),
      ...cardBlocks(card),
      paragraph(
        text('Checked for '),
        mention(x.asker),
        text('. Access and approvals are personal, so the answer can differ for someone else. When a request for it is resolved, Tool Passport adds the new answer here.'),
      ),
    ],
  };
}

/** The app's update when the answer has changed. */
export function storyUpdate(card: Card, x: { toolName: string; asker: string; was: string; trigger: string | null }): Adf {
  const was = verdictTitle(x.was);
  return {
    type: 'doc',
    version: 1,
    content: [
      paragraph(text(`Tool Passport update: ${card.title}`, true), text(`${was ? ` (was ${was})` : ''}${heading(card, x.toolName)}`)),
      ...cardBlocks(card),
      paragraph(text('Checked again for '), mention(x.asker), text(x.trigger ? ` after ${x.trigger} was resolved.` : '.')),
    ],
  };
}

// ---- the follow-up -------------------------------------------------------------------------------------

/**
 * After a re-check of an ask: tell each story it was added to, once, if the verdict changed. A failure here never
 * stops the request loop (the caller catches); a comment that fails after the move is logged, not retried, so a
 * story never gets the same update twice.
 */
export async function tellStories(
  x: { askId: number; asker: string; now: Rechecked | null; trigger: string | null },
  deps: Pick<LoopDeps, 'stories' | 'requests' | 'log'>,
): Promise<number> {
  const links = deps.stories;
  const now = x.now;
  if (!links || !now || now.card.kind !== 'verdict' || !now.card.verdict) return 0;
  const verdict = now.card.verdict;
  const changed = (await links.shares.forAsk(x.askId)).filter((s) => s.verdict !== verdict);
  if (!changed.length) return 0;
  const card = await cardWithRequests(now, x.asker, deps.requests);
  let told = 0;
  for (const share of changed) {
    if (!(await links.shares.moveVerdict(share.id, share.verdict, verdict))) continue;
    try {
      await links.comments.asApp(share.issueKey, storyUpdate(card, { toolName: now.tool.name, asker: x.asker, was: share.verdict, trigger: x.trigger }));
      told += 1;
    } catch (e) {
      deps.log?.(`[story] update on ${share.issueKey} failed: ${String(e).slice(0, 200)}`);
    }
  }
  if (told) deps.log?.(`[story] updated ${told} ${told === 1 ? 'story' : 'stories'} verdict=${verdict}`);
  return told;
}

/** tellStories for the request loop: whatever goes wrong (the table not there yet, a read failing) is only logged. */
export async function tellStoriesSafely(x: Parameters<typeof tellStories>[0], deps: Pick<LoopDeps, 'stories' | 'requests' | 'log'>): Promise<void> {
  try {
    await tellStories(x, deps);
  } catch (e) {
    deps.log?.(`[story] could not check the stories for ask ${x.askId}: ${String(e).slice(0, 200)}`);
  }
}

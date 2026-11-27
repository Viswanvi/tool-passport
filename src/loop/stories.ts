import { verdictTitle, type Card, type Chip } from '../engine/card';
import type { CatalogChoice } from '../engine/catalog';
import { cardWithRequests, recheckAsk, requirementHash, saveResult, type LoopDeps, type Rechecked, type StoredAsk } from './requests';

/**
 * "Add to story" (D53), without Forge. The person posts the answer to the work item as their own comment, built by
 * code from the stored ask checked again now: the card's fixed words, its stamps and their evidence, the path to Yes.
 * The story is remembered with the verdict it was told. When a later re-check of the same question (the same person,
 * tool, environment and catalog keys, whichever of their asks it is: checking the story again makes a new one) gives
 * a different verdict, the app adds the new answer to the story once: compare-and-set on the remembered verdict, so an
 * event and the sweep arriving together post one update, and one story hears once however many times it was added.
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
  /** Stories told an answer to the same question as this ask: same person, tool, environment and requirement. */
  related(ask: StoredAsk): Promise<StoryShare[]>;
  /** Asks whose answer was added to a story, for this tool (and environment, unless null), newest first. */
  askIdsFor(toolId: number, environmentId: number | null, limit: number): Promise<number[]>;
  /** Move the remembered verdict from `from` to `to`; true if this call made the move. */
  moveVerdict(id: number, from: string, to: string): Promise<boolean>;
}

/** Whether two stored requirements are the same question (order of keys doesn't matter). */
export function sameRequirement(a: CatalogChoice[] | null, b: CatalogChoice[] | null): boolean {
  return a !== null && b !== null && a.length > 0 && requirementHash(a) === requirementHash(b);
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

/** What made the app check again: a request resolved, the environment's version changing, or the owner's facts. */
export type StoryTrigger = { kind: 'request'; key: string } | { kind: 'version'; from: string; to: string } | { kind: 'facts' };

function because(t: StoryTrigger | null, environment: string | null): string {
  if (!t) return '.';
  if (t.kind === 'request') return ` after ${t.key} was resolved.`;
  if (t.kind === 'version') return ` after ${environment ?? 'the environment'} moved from ${t.from} to ${t.to}.`;
  return ' after the tool owner updated its verified facts.';
}

/** The app's update when the answer has changed. */
export function storyUpdate(card: Card, x: { toolName: string; asker: string; was: string; trigger: StoryTrigger | null; environment: string | null }): Adf {
  const was = verdictTitle(x.was);
  return {
    type: 'doc',
    version: 1,
    content: [
      paragraph(text(`Tool Passport update: ${card.title}`, true), text(`${was ? ` (was ${was})` : ''}${heading(card, x.toolName)}`)),
      ...cardBlocks(card),
      paragraph(text('Checked again for '), mention(x.asker), text(because(x.trigger, x.environment))),
    ],
  };
}

// ---- the follow-up -------------------------------------------------------------------------------------

/**
 * After a re-check of an ask: tell each story the same question was added to, once, if the verdict changed. Each
 * story gets at most one update per change, even if the person added it twice. A failure here never stops the request
 * loop (the caller catches); a comment that fails after the move is logged, not retried, so a story never gets the
 * same update twice.
 */
export async function tellStories(x: { now: Rechecked | null; trigger: StoryTrigger | null }, deps: Pick<LoopDeps, 'stories' | 'requests' | 'log'>): Promise<number> {
  const links = deps.stories;
  const now = x.now;
  if (!links || !now || now.card.kind !== 'verdict' || !now.card.verdict || !now.ask.requirement) return 0;
  const verdict = now.card.verdict;
  const asker = now.ask.askerAccountId;
  const byStory = new Map<string, StoryShare[]>();
  for (const s of await links.shares.related(now.ask)) {
    if (s.verdict !== verdict) byStory.set(s.issueKey, [...(byStory.get(s.issueKey) ?? []), s]);
  }
  if (!byStory.size) return 0;
  const card = await cardWithRequests(now, asker, deps.requests);
  let told = 0;
  for (const [issueKey, shares] of byStory) {
    // Every remembered row for this story moves; the story hears once if this call moved any of them.
    let won: StoryShare | null = null;
    for (const s of shares) if ((await links.shares.moveVerdict(s.id, s.verdict, verdict)) && !won) won = s;
    if (!won) continue;
    try {
      await links.comments.asApp(issueKey, storyUpdate(card, { toolName: now.tool.name, asker, was: won.verdict, trigger: x.trigger, environment: now.environment?.name ?? null }));
      told += 1;
    } catch (e) {
      deps.log?.(`[story] update on ${issueKey} failed: ${String(e).slice(0, 200)}`);
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
    deps.log?.(`[story] could not check the stories for ask ${x.now?.ask.id ?? '?'}: ${String(e).slice(0, 200)}`);
  }
}

/** How many story-linked asks one refresh checks again: each costs a record read, and stories are few. */
export const STORY_REFRESH_LIMIT = 25;

/**
 * The ground moved under the stories (D55): an environment changed version, or the owner changed what is verified.
 * Every ask whose answer was added to a story, for the tool (and that environment), is checked again for its asker,
 * and each story whose verdict changed hears once, saying why. Nobody asked: the story learns that its Yes no longer
 * holds, or that its Don't know yet is settled. Each ask fails on its own; nothing here stops the caller.
 */
export async function refreshStories(x: { toolId: number; environmentId: number | null; trigger: StoryTrigger }, deps: LoopDeps): Promise<number> {
  const links = deps.stories;
  if (!links) return 0;
  let told = 0;
  for (const askId of await links.shares.askIdsFor(x.toolId, x.environmentId, STORY_REFRESH_LIMIT)) {
    try {
      const ask = await deps.loadAsk(askId);
      const now = ask ? await recheckAsk(ask, deps) : null;
      if (ask && now) await saveResult(deps, ask.id, now.answer);
      told += await tellStories({ now, trigger: x.trigger }, deps);
    } catch (e) {
      deps.log?.(`[story] refresh of ask ${askId} failed: ${String(e).slice(0, 200)}`);
    }
  }
  return told;
}

/** The stories to tell once a version change is listed: those in that environment, saying what moved. */
export const storiesAfterChange = (c: { toolId: number; environmentId: number; fromVersion: string; toVersion: string }) => ({
  toolId: c.toolId,
  environmentId: c.environmentId,
  trigger: { kind: 'version' as const, from: c.fromVersion, to: c.toVersion },
});

/** refreshStories for callers that must not fail because of it (the sweep, the Changes screen, saving a fact). */
export async function refreshStoriesSafely(x: Parameters<typeof refreshStories>[0], deps: LoopDeps): Promise<void> {
  try {
    await refreshStories(x, deps);
  } catch (e) {
    deps.log?.(`[story] could not refresh the stories of tool ${x.toolId}: ${String(e).slice(0, 200)}`);
  }
}

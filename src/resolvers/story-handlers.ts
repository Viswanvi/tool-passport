import { z } from 'zod';
import { answerQuestion } from '../engine/answer';
import { canPick } from '../engine/audience';
import type { Card } from '../engine/card';
import type { Environment } from '../engine/model';
import { cardWithRequests, recheckAsk, saveResult, type LoopDeps } from '../loop/requests';
import { storyComment, StoryCommentError, type StoryLinks } from '../loop/stories';
import { finishAsk, type AskHandlerDeps, type AskReply } from './handlers';

/**
 * "Check this story" (a panel on a Jira work item): is what this story asks for possible where it is meant to
 * run? The work item comes from the Forge context only and is read as the person looking, so it shows only what
 * Jira lets them see. The environment is suggested when the story names exactly one (plain text matching; the
 * model never picks it). The story's text then goes through the same pipeline as a typed question: the model maps
 * it to catalog keys only, code checks them, and the answer is saved like any ask so its card can raise requests.
 * No Forge imports.
 */

export interface StoryContext {
  accountId?: string;
  /** From the Forge context of the issue panel, never from the payload. */
  issueKey?: string;
}

export type StoryDeps = Pick<
  AskHandlerDeps,
  'loadTool' | 'loadEnvironment' | 'loadCatalog' | 'readGroups' | 'chat' | 'translations' | 'repo' | 'environments' | 'noteVersion' | 'saveAsk' | 'requests'
> & {
  listTools(): Promise<Array<{ id: number; name: string }>>;
  listEnvironments(toolId: number): Promise<Environment[]>;
  /** As the person looking; null if they can't read it or it is gone. */
  readIssue(issueKey: string): Promise<{ summary: string; description: unknown } | null>;
};

export type StoryContextReply =
  | {
      ok: true;
      issueKey: string;
      summary: string;
      tools: Array<{ id: number; name: string }>;
      environments: Array<{ id: number; name: string; toolId: number }>;
      /** The one environment the story names, if it names exactly one. */
      suggestedEnvironmentId: number | null;
    }
  | { ok: false; reason: string };

/** What the model reads: the summary, then as much of the description as fits a question's length. */
export const STORY_MAX = 500;

/** The plain text of a work item description: Atlassian Document Format, or a plain string from an older field. */
export function adfText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (node === null || typeof node !== 'object') return '';
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  if (!Array.isArray(n.content)) return '';
  const parts = n.content.map(adfText).filter((s) => s !== '');
  // Blocks (paragraphs, list items) are separated by a space; inline text runs are joined as written.
  const inline = n.content.every((c) => (c as { type?: unknown })?.type === 'text' || (c as { type?: unknown })?.type === 'hardBreak');
  return (inline ? parts.join('') : parts.join(' ')).replace(/\s+/g, ' ').trim();
}

export function storyText(summary: string, description: unknown): string {
  const s = summary.trim();
  const d = adfText(description);
  return (d ? `${s}. ${d}` : s).slice(0, STORY_MAX).trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An environment the story names on its own (KS-DEV, not KS-DEVELOPER), when exactly one is named. */
function namedEnvironment(text: string, environments: Array<{ id: number; name: string }>): number | null {
  const named = environments.filter((e) => new RegExp(`(^|[^A-Za-z0-9_-])${escape(e.name)}(?![A-Za-z0-9_-])`, 'i').test(text));
  return named.length === 1 ? named[0]!.id : null;
}

export async function handleStoryContext(ctx: StoryContext, deps: StoryDeps): Promise<StoryContextReply> {
  if (!ctx.accountId) return { ok: false, reason: 'Not signed in' };
  if (!ctx.issueKey) return { ok: false, reason: 'Open this from a work item' };
  const issue = await deps.readIssue(ctx.issueKey);
  if (!issue) return { ok: false, reason: "This work item can't be read" };
  const [tools, groups] = await Promise.all([deps.listTools(), deps.readGroups(ctx.accountId)]);
  const environments = (
    await Promise.all(tools.map(async (t) => (await deps.listEnvironments(t.id)).filter((e) => canPick(e, groups).ok).map((e) => ({ id: e.id, name: e.name, toolId: t.id }))))
  ).flat();
  return {
    ok: true,
    issueKey: ctx.issueKey,
    summary: issue.summary,
    tools,
    environments,
    suggestedEnvironmentId: namedEnvironment(`${issue.summary} ${adfText(issue.description)}`, environments),
  };
}

const StoryCheck = z.object({ toolId: z.number().int().positive(), environmentId: z.number().int().positive().nullable() });

export async function handleStoryCheck(payload: unknown, ctx: StoryContext, deps: StoryDeps): Promise<AskReply> {
  const asker = ctx.accountId;
  if (!asker) return { ok: false, error: 'not_signed_in', card: null };
  const p = StoryCheck.safeParse(payload);
  if (!p.success || !ctx.issueKey) return { ok: false, error: 'bad_request', card: null };
  try {
    const issue = await deps.readIssue(ctx.issueKey);
    if (!issue) return { ok: false, error: 'not_found', card: null };
    const tool = await deps.loadTool(p.data.toolId);
    if (!tool) return { ok: false, error: 'not_found', card: null };
    const environment = p.data.environmentId === null ? null : await deps.loadEnvironment(p.data.environmentId);
    if (p.data.environmentId !== null && !environment) return { ok: false, error: 'not_found', card: null };
    const [groups, catalog] = await Promise.all([deps.readGroups(asker), deps.loadCatalog(tool)]);
    const answer = await answerQuestion(
      { question: storyText(issue.summary, issue.description), tool, environment, asker, groups, catalog },
      {
        chat: deps.chat(),
        translations: deps.translations,
        repo: deps.repo,
        environments: deps.environments,
        noteVersion: deps.noteVersion ? (e, v) => deps.noteVersion!(tool, e, v) : undefined,
      },
    );
    return await finishAsk(answer, { asker, tool, environment, catalog, question: issue.summary.slice(0, STORY_MAX), source: 'story' }, deps);
  } catch (e) {
    console.error(`[story] failed: ${String(e).slice(0, 300)}`);
    return { ok: false, error: 'try_again', card: null };
  }
}

// ---- Add to story ---------------------------------------------------------------------------------------

export interface StoryShareDeps {
  loop: LoopDeps;
  stories: StoryLinks;
  /** Brings the tables up to date first (a minor upgrade fires no lifecycle event, D27). */
  prepare?(): Promise<unknown>;
}

export type StoryShareError = 'not_signed_in' | 'bad_request' | 'not_found' | 'nothing_to_share' | 'not_allowed' | 'try_again';

export type StoryShareReply =
  | { ok: true; card: Card; verdict: string; /** False if the story couldn't be remembered: no update will follow. */ following: boolean }
  | { ok: false; error: StoryShareError; message: string };

const SHARE_MESSAGES: Record<StoryShareError, string> = {
  not_signed_in: 'Sign in to add the answer.',
  bad_request: 'Open this from a work item, then try again.',
  not_found: 'That answer is no longer available. Check the story again.',
  nothing_to_share: 'There is no answer to add yet. Check the story first.',
  not_allowed: "You can't comment on this work item, so the answer wasn't added.",
  try_again: "The answer couldn't be added just now. Try again.",
};

const shareFailure = (error: StoryShareError): StoryShareReply => ({ ok: false, error, message: SHARE_MESSAGES[error] });

const StoryShare = z.object({ askId: z.number().int().positive() });

/**
 * Add to story: the person's own stored ask, checked again now, posted on the work item from the Forge context as
 * their comment. The payload names only the ask; the comment is built here from the card (CLAUDE.md rule 3). The
 * story is remembered with the verdict it was told, so a later change is added there once (loop/stories.ts).
 */
export async function handleStoryShare(payload: unknown, ctx: StoryContext, deps: StoryShareDeps): Promise<StoryShareReply> {
  const asker = ctx.accountId;
  if (!asker) return shareFailure('not_signed_in');
  const p = StoryShare.safeParse(payload);
  const issueKey = ctx.issueKey;
  if (!p.success || !issueKey) return shareFailure('bad_request');
  try {
    await deps.prepare?.();
    const ask = await deps.loop.loadAsk(p.data.askId);
    if (!ask || ask.askerAccountId !== asker) return shareFailure('not_found');
    const now = await recheckAsk(ask, deps.loop);
    if (!now) return shareFailure('not_found');
    await saveResult(deps.loop, ask.id, now.answer);
    const card = await cardWithRequests(now, asker, deps.loop.requests);
    if (card.kind !== 'verdict' || !card.verdict) return shareFailure('nothing_to_share');
    // The comment first: a story is only remembered once it has the answer, so an update never comes out of nowhere.
    await deps.stories.comments.asUser(issueKey, storyComment(card, { toolName: now.tool.name, asker }));
    let following = true;
    try {
      await deps.stories.shares.save({ askId: ask.id, toolId: now.tool.id, issueKey, verdict: card.verdict });
    } catch (e) {
      following = false;
      console.error(`[story] the share was posted but not remembered: ${String(e).slice(0, 200)}`);
    }
    console.log(`[story] added verdict=${card.verdict}`);
    return { ok: true, card, verdict: card.verdict, following };
  } catch (e) {
    if (e instanceof StoryCommentError && e.code === 'not_allowed') return shareFailure('not_allowed');
    console.error(`[story] add failed: ${String(e).slice(0, 300)}`);
    return shareFailure('try_again');
  }
}

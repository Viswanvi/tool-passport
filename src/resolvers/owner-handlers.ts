import { z } from 'zod';
import type { Environment } from '../engine/model';
import { afterFactWrite, checkAnswer, openQuestionGroups, writeAnswer, type AnswerWriter, type QuestionGroup } from '../loop/questions';
import type { LoopDeps } from '../loop/requests';
import { mayWriteTool, type WriteCheck } from '../registry/authorise';
import type { ResolverContext } from './handlers';

/**
 * Tool owners' resolvers (spec section 15, My tools; F5). Every one checks, on the server, that the caller is
 * the tool's owner or a Jira administrator (CLAUDE.md rule 4); identity comes from the Forge context only.
 */

export interface OwnerDeps {
  loop: LoopDeps;
  writer: AnswerWriter;
  check: WriteCheck;
  listTools(): Promise<Array<{ id: number; name: string }>>;
  listEnvironments(toolId: number): Promise<Environment[]>;
  /** Version changes: a published verification closes the matching re-verify items. */
  changes?: { closeFactRechecks(factId: number, version: string): Promise<void> };
}

type Refusal = { ok: false; reason: string };

const ToolRef = z.object({ toolId: z.number().int().positive() });

const PublishPayload = ToolRef.extend({
  key: z.string().min(1).max(128),
  value: z.union([z.boolean(), z.number(), z.string().max(500)]),
  environmentId: z.number().int().positive().nullable(),
  version: z.string().min(1).max(32),
  everyVersion: z.boolean(),
  quote: z.string().max(1000).nullable().optional(),
});

/** Tools the caller may answer for: their own, or every tool for a Jira administrator. */
export async function handleMyTools(ctx: ResolverContext, deps: Pick<OwnerDeps, 'loop' | 'check' | 'listTools'>): Promise<{ tools: Array<{ id: number; name: string }> }> {
  if (!ctx.accountId) return { tools: [] };
  const all = await deps.listTools();
  let admin: boolean | null = null;
  const mine: Array<{ id: number; name: string }> = [];
  for (const t of all) {
    const tool = await deps.loop.loadTool(t.id);
    if (!tool) continue;
    if (tool.ownerAccountId === ctx.accountId) {
      mine.push(t);
      continue;
    }
    admin ??= await deps.check.isJiraAdmin().catch(() => false);
    if (admin) mine.push(t);
  }
  return { tools: mine };
}

async function ownedTool(toolId: number, ctx: ResolverContext, deps: Pick<OwnerDeps, 'loop' | 'check'>) {
  const tool = await deps.loop.loadTool(toolId);
  if (!tool) return { ok: false as const, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  return allowed.ok ? { ok: true as const, tool } : { ok: false as const, reason: allowed.reason };
}

export async function handleOpenQuestions(
  payload: unknown,
  ctx: ResolverContext,
  deps: OwnerDeps,
): Promise<{ ok: true; tool: { id: number; name: string }; environments: Array<{ id: number; name: string; version: string | null }>; groups: QuestionGroup[] } | Refusal> {
  const p = ToolRef.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a tool' };
  const owned = await ownedTool(p.data.toolId, ctx, deps);
  if (!owned.ok) return owned;
  const tool = owned.tool;
  const [catalog, environments] = await Promise.all([deps.loop.loadCatalog(tool), deps.listEnvironments(tool.id)]);
  const groups = await openQuestionGroups(tool, catalog, environments, deps.loop);
  return {
    ok: true,
    tool: { id: tool.id, name: tool.name },
    environments: environments.map((e) => ({ id: e.id, name: e.name, version: e.lastSeenVersion })),
    groups,
  };
}

/** publishAnswer (spec section 11): owner only; one fact verification, then every open question is checked again. */
export async function handlePublishAnswer(payload: unknown, ctx: ResolverContext, deps: OwnerDeps): Promise<{ ok: true; settled: string[]; stillOpen: number } | Refusal> {
  const p = PublishPayload.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'The answer could not be read: give a value, a scope and a version' };
  try {
    const owned = await ownedTool(p.data.toolId, ctx, deps);
    if (!owned.ok) return owned;
    const tool = owned.tool;
    const [catalog, environments] = await Promise.all([deps.loop.loadCatalog(tool), deps.listEnvironments(tool.id)]);
    const checked = checkAnswer({ ...p.data, quote: p.data.quote ?? null }, tool, catalog, environments);
    if (!checked.ok) return checked;
    const factId = await writeAnswer(tool, checked.fact, ctx.accountId!, deps.writer);
    await deps.changes?.closeFactRechecks(factId, checked.fact.version);
    const result = await afterFactWrite(tool.id, deps.loop);
    console.log(`[publish] ${checked.fact.key} settled=${result.settled.length} open=${result.stillOpen}`);
    return { ok: true, ...result };
  } catch (e) {
    console.error(`[publish] failed: ${String(e).slice(0, 300)}`);
    return { ok: false, reason: 'Publishing stopped part way. Publish again: it is safe to repeat.' };
  }
}

import { z } from 'zod';
import type { SavedAsk } from '../db/asks';
import { answerQuestion } from '../engine/answer';
import { canPick } from '../engine/audience';
import { buildCard, type Card } from '../engine/card';
import type { Catalog, EngineRepo, Environment, EnvironmentReader, Groups, Tool } from '../engine/model';
import type { ChatFn, TranslationStore } from '../engine/translate';
import { mayAdminister, type WriteCheck } from '../registry/authorise';
import type { SeedResult } from '../seed/demo';

/**
 * Resolver handlers, with every read passed in so they run in unit tests. Identity comes from the Forge
 * context only (CLAUDE.md rule 3): payloads are parsed with zod, which drops any field it doesn't name, so an
 * `accountId` in a payload is never read. A thrown error is Try again, never a verdict.
 */

export interface ResolverContext {
  accountId?: string;
}

export const AskPayload = z.object({
  toolId: z.number().int().positive(),
  environmentId: z.number().int().positive().nullable(),
  question: z.string().max(2000),
});

export const ToolPayload = z.object({ toolId: z.number().int().positive() });

export interface AskHandlerDeps {
  loadTool(id: number): Promise<Tool | null>;
  loadEnvironment(id: number): Promise<Environment | null>;
  loadCatalog(tool: Tool): Promise<Catalog>;
  readGroups(accountId: string): Promise<Groups>;
  /** A fresh chat function per question. */
  chat(): ChatFn;
  translations?: TranslationStore;
  repo: EngineRepo;
  environments: EnvironmentReader;
  noteVersion?(tool: Tool, environment: Environment, observed: string | null): Promise<unknown>;
  saveAsk(a: SavedAsk): Promise<number | null>;
}

export type AskReply =
  | { ok: true; askId: number | null; card: Card }
  | { ok: false; error: 'not_signed_in' | 'bad_request' | 'not_found' | 'try_again'; card: Card | null };

const TRY_AGAIN: Card = {
  kind: 'try_again',
  verdict: null,
  title: "Couldn't check this",
  lozenge: 'default',
  reason: 'Something went wrong while checking. Try again.',
  where: null,
  chips: [],
  action: { kind: 'try_again', label: 'Try again' },
  next: [],
  checked: [],
  checks: [],
  banner: null,
};

export async function handleAsk(payload: unknown, ctx: ResolverContext, deps: AskHandlerDeps): Promise<AskReply> {
  const asker = ctx.accountId;
  if (!asker) return { ok: false, error: 'not_signed_in', card: null };
  const p = AskPayload.safeParse(payload);
  if (!p.success) return { ok: false, error: 'bad_request', card: null };
  try {
    const tool = await deps.loadTool(p.data.toolId);
    if (!tool) return { ok: false, error: 'not_found', card: null };
    const environment = p.data.environmentId === null ? null : await deps.loadEnvironment(p.data.environmentId);
    if (p.data.environmentId !== null && !environment) return { ok: false, error: 'not_found', card: null };
    const [groups, catalog] = await Promise.all([deps.readGroups(asker), deps.loadCatalog(tool)]);

    const answer = await answerQuestion(
      { question: p.data.question, tool, environment, asker, groups, catalog },
      {
        chat: deps.chat(),
        translations: deps.translations,
        repo: deps.repo,
        environments: deps.environments,
        noteVersion: deps.noteVersion ? (e, v) => deps.noteVersion!(tool, e, v) : undefined,
      },
    );
    const card = buildCard(answer, { toolName: tool.name, environment, catalog });
    // One line per question, for counting model calls (they cost money). No question text, no account id.
    console.log(
      `[ask] state=${answer.state}${answer.state === 'checked' ? ` verdict=${answer.verdict} cached=${answer.cached} model=${answer.modelId ?? '-'}` : ''}`,
    );

    let askId: number | null = null;
    if (answer.state === 'checked' || answer.state === 'unsupported') {
      try {
        askId = await deps.saveAsk({
          askerAccountId: asker,
          toolId: tool.id,
          environmentId: environment?.id ?? null,
          questionText: p.data.question.trim(),
          requirement: answer.state === 'checked' ? answer.requirement : null,
          verdict: answer.state === 'checked' ? answer.verdict : 'unsupported',
          factVersionIds: answer.state === 'checked' ? answer.outcome.results.flatMap((r) => (r.factVersionId ? [r.factVersionId] : [])) : [],
          modelId: answer.state === 'checked' ? answer.modelId ?? null : null,
        });
      } catch (e) {
        // The answer stands; it just can't be followed up (no request can be raised from it).
        console.error(`[ask] could not save the ask: ${String(e).slice(0, 200)}`);
      }
    }
    return { ok: true, askId, card };
  } catch (e) {
    console.error(`[ask] failed: ${String(e).slice(0, 300)}`);
    return { ok: false, error: 'try_again', card: TRY_AGAIN };
  }
}

export interface ListDeps {
  listTools(): Promise<Array<{ id: number; name: string }>>;
  loadTool(id: number): Promise<Tool | null>;
  listEnvironments(toolId: number): Promise<Environment[]>;
  loadCatalog(tool: Tool): Promise<Catalog>;
  readGroups(accountId: string): Promise<Groups>;
}

export async function handleTools(ctx: ResolverContext, deps: Pick<ListDeps, 'listTools'>): Promise<{ tools: Array<{ id: number; name: string }> }> {
  if (!ctx.accountId) return { tools: [] };
  return { tools: await deps.listTools() };
}

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** The environments this person may pick (audience groups enforced here, not in the page), and suggestions. */
export async function handleEnvironments(
  payload: unknown,
  ctx: ResolverContext,
  deps: ListDeps,
): Promise<{ environments: Array<{ id: number; name: string }>; suggestions: string[] }> {
  const p = ToolPayload.safeParse(payload);
  if (!ctx.accountId || !p.success) return { environments: [], suggestions: [] };
  const tool = await deps.loadTool(p.data.toolId);
  if (!tool) return { environments: [], suggestions: [] };
  const all = await deps.listEnvironments(tool.id);
  // Groups are read only when some environment is limited to an audience.
  const groups: Groups = all.some((e) => e.audienceGroup) ? await deps.readGroups(ctx.accountId) : { ok: false };
  const environments = all.filter((e) => canPick(e, groups).ok).map((e) => ({ id: e.id, name: e.name }));
  const catalog = await deps.loadCatalog(tool);
  const suggestions = [...catalog.keys.values()]
    .filter((k) => k.kind === 'capability' && !k.requiresValue)
    .slice(0, 3)
    .map((k) => `Can I ${lowerFirst(k.label)}?`);
  return { environments, suggestions };
}

export async function handleLoadDemo(
  ctx: ResolverContext,
  deps: { check: WriteCheck; seed(actor: string): Promise<SeedResult> },
): Promise<SeedResult> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok || !ctx.accountId) return { ok: false, reason: allowed.ok ? 'Not signed in' : allowed.reason };
  try {
    return await deps.seed(ctx.accountId);
  } catch (e) {
    // Every write is safe to repeat, so running it again finishes the job.
    console.error(`[loadDemo] failed: ${String(e).slice(0, 300)}`);
    return { ok: false, reason: `Loading stopped part way: ${String(e).slice(0, 200)}. Run it again; it is safe to repeat.` };
  }
}

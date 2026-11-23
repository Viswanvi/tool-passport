import { z } from 'zod';
import { stillTrue, type ChangeRecord, type ChangeRepo } from '../change/changes';
import type { Environment } from '../engine/model';
import { settleOpenQuestions, type AnswerWriter } from '../loop/questions';
import type { LoopDeps } from '../loop/requests';
import { mayWriteTool, type WriteCheck } from '../registry/authorise';
import type { RegistryRows } from './edit-handlers';
import type { ResolverContext } from './handlers';

/**
 * The Changes screen (spec section 15, F6): tool owners and Jira administrators only, checked on the server.
 * Identity from the Forge context only.
 */

export interface ChangeDeps {
  loop: LoopDeps;
  changes: ChangeRepo;
  writer: AnswerWriter;
  check: WriteCheck;
  listEnvironments(toolId: number): Promise<Environment[]>;
  loadRegistry(toolId: number): Promise<RegistryRows>;
}

type Refusal = { ok: false; reason: string };

export interface ChangeView {
  id: number;
  environment: string;
  from: string;
  to: string;
  found: 'Found in Assets record' | 'Recorded by owner';
  status: ChangeRecord['status'];
  createdAt: string;
  error: string | null;
  toRecheck: Array<{
    factId: number;
    key: string;
    label: string;
    scope: string;
    environmentId: number | null;
    audienceGroup: string | null;
    was: unknown;
    valueType: string;
    unit: string | null;
  }>;
  /** Facts in scope that don't depend on the version. */
  notListed: number;
  rulesUntouched: number;
  otherEnvironments: string[];
}

const ToolRef = z.object({ toolId: z.number().int().positive() });
const StillTrue = z.object({ changeId: z.number().int().positive(), factId: z.number().int().positive() });

export async function handleChanges(payload: unknown, ctx: ResolverContext, deps: ChangeDeps): Promise<{ ok: true; changes: ChangeView[] } | Refusal> {
  const p = ToolRef.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a tool' };
  const tool = await deps.loop.loadTool(p.data.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  if (!allowed.ok) return allowed;
  const [catalog, environments, registry, changes] = await Promise.all([
    deps.loop.loadCatalog(tool),
    deps.listEnvironments(tool.id),
    deps.loadRegistry(tool.id),
    deps.changes.changesFor(tool.id, 10),
  ]);
  const envName = (id: number | null) => (id === null ? 'all environments' : (environments.find((e) => e.id === id)?.name ?? `environment ${id}`));
  const views: ChangeView[] = [];
  for (const c of changes) {
    const open = await deps.changes.openRecheckFacts(c.id);
    const inScope = registry.facts.filter((f) => f.status === 'active' && (f.environmentId === null || f.environmentId === c.environmentId));
    views.push({
      id: c.id,
      environment: envName(c.environmentId),
      from: c.fromVersion,
      to: c.toVersion,
      found: c.origin === 'recorded' ? 'Recorded by owner' : 'Found in Assets record',
      status: c.status,
      createdAt: c.createdAt,
      error: c.status === 'failed' ? c.error : null,
      toRecheck: registry.facts
        .filter((f) => open.includes(f.id))
        .map((f) => {
          const k = catalog.keys.get(f.factKey);
          const active = f.versions.filter((v) => v.status === 'active');
          const was = active.find((v) => v.version === c.fromVersion) ?? active.at(-1);
          return {
            factId: f.id,
            key: f.factKey,
            label: k?.label ?? f.factKey,
            scope: `${envName(f.environmentId)}${f.audienceGroup ? ` · ${f.audienceGroup}` : ''}`,
            environmentId: f.environmentId,
            audienceGroup: f.audienceGroup,
            was: was?.value ?? null,
            valueType: k?.valueType ?? 'boolean',
            unit: k?.unit ?? null,
          };
        }),
      notListed: inScope.filter((f) => !f.versionSensitive).length,
      rulesUntouched: registry.rules.filter((r) => r.status === 'active').length,
      otherEnvironments: environments.filter((e) => e.id !== c.environmentId).map((e) => `${e.name} (${e.lastSeenVersion ?? 'version not seen yet'})`),
    });
  }
  return { ok: true, changes: views };
}

export interface RecentAsk {
  askId: number;
  /** Null after 30 days: the text is deleted (spec section 14). */
  question: string | null;
  tool: string;
  environment: string;
  verdict: string | null;
  mayHaveChanged: boolean;
  createdAt: string;
}

export interface RecentDeps {
  recentAsksFor(
    asker: string,
    limit: number,
  ): Promise<Array<{ askId: number; toolId: number; environmentId: number | null; question: string | null; verdict: string | null; mayHaveChanged: boolean; createdAt: string }>>;
  loadTool(id: number): Promise<{ name: string } | null>;
  loadEnvironment(id: number): Promise<{ name: string } | null>;
}

/** The caller's own recent questions, with "May have changed" where a version change touched their evidence. */
export async function handleRecentAsks(ctx: ResolverContext, deps: RecentDeps): Promise<{ asks: RecentAsk[] }> {
  if (!ctx.accountId) return { asks: [] };
  const rows = await deps.recentAsksFor(ctx.accountId, 10);
  const names = new Map<string, string>();
  const name = async (kind: 'tool' | 'env', id: number) => {
    const k = `${kind}:${id}`;
    if (!names.has(k)) names.set(k, (kind === 'tool' ? await deps.loadTool(id) : await deps.loadEnvironment(id))?.name ?? '');
    return names.get(k)!;
  };
  const asks: RecentAsk[] = [];
  for (const r of rows) {
    asks.push({
      askId: r.askId,
      question: r.question,
      tool: await name('tool', r.toolId),
      environment: r.environmentId === null ? 'Any environment' : await name('env', r.environmentId),
      verdict: r.verdict,
      mayHaveChanged: r.mayHaveChanged,
      createdAt: r.createdAt,
    });
  }
  return { asks };
}

export async function handleStillTrue(payload: unknown, ctx: ResolverContext, deps: ChangeDeps): Promise<{ ok: true; settled: string[] } | Refusal> {
  const p = StillTrue.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a fact on a change' };
  const change = await deps.changes.changeById(p.data.changeId);
  if (!change) return { ok: false, reason: 'That change no longer exists' };
  const tool = await deps.loop.loadTool(change.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  if (!allowed.ok) return allowed;
  const registry = await deps.loadRegistry(tool.id);
  const r = await stillTrue(p.data, tool, ctx.accountId!, { changes: deps.changes, writer: deps.writer, facts: registry.facts });
  if (!r.ok) return r;
  // A new verification may decide open questions, as any fact does.
  const { settled } = await settleOpenQuestions(tool.id, deps.loop);
  return { ok: true, settled };
}

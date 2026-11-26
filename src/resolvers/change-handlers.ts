import { z } from 'zod';
import { affectedFacts, buildRecheckList, detectVersions, RECENT_DAYS, staleVerifications, stillTrue, type ChangeRecord, type ChangeRepo } from '../change/changes';
import { normaliseVersion } from '../engine/version';
import { labelReleaseNotes, MAX_NOTES_CHARS, type LabelKind, type LabelStore } from '../change/release-notes';
import type { Environment, Tool } from '../engine/model';
import type { ChatFn } from '../engine/translate';
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
  /** Release-note labels (F9, P1); without them the screen just shows no suggestions. */
  labels?: LabelStore;
  /** A fresh chat function per paste of release notes. */
  labelChat?(): ChatFn;
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
    /** What the pasted release notes say about it (F9): a suggestion only, with the quote that shows it. */
    suggestion: { label: LabelKind; quote: string | null } | null;
  }>;
  /** Facts in scope that don't depend on the version. */
  notListed: number;
  rulesUntouched: number;
  otherEnvironments: string[];
}

const ToolRef = z.object({ toolId: z.number().int().positive() });
const StillTrue = z.object({ changeId: z.number().int().positive(), factId: z.number().int().positive() });
// A little over the labeller's own limit, so a long paste gets its plain message instead of "bad request".
const ReleaseNotes = z.object({ changeId: z.number().int().positive(), notes: z.string().max(MAX_NOTES_CHARS * 2) });

/**
 * What the sweep would do for this tool, done now for the owner looking: read each environment's record and note
 * its version (detectVersions), then build every list still waiting (buildRecheckList). Both are the sweep's own
 * steps and safe to repeat, so the screen is current without "wait up to 5 minutes". A read or a list that fails
 * here is left for the next look or the sweep; the screen still shows.
 */
async function catchUp(tool: Tool, deps: ChangeDeps): Promise<void> {
  try {
    if (deps.loop.noteVersion) await detectVersions([{ tool, environments: await deps.listEnvironments(tool.id) }], deps.loop.environments, deps.loop.noteVersion);
    for (const change of (await deps.changes.openChanges(OPEN_LIMIT)).filter((c) => c.toolId === tool.id)) await buildRecheckList(change, deps.changes);
  } catch (e) {
    console.error(`[changes] catch-up failed: ${String(e).slice(0, 300)}`);
  }
}

const OPEN_LIMIT = 20;

export async function handleChanges(
  payload: unknown,
  ctx: ResolverContext,
  deps: ChangeDeps,
): Promise<{ ok: true; changes: ChangeView[]; environments: Array<{ id: number; name: string; version: string | null }> } | Refusal> {
  const p = ToolRef.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a tool' };
  const tool = await deps.loop.loadTool(p.data.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  if (!allowed.ok) return allowed;
  await catchUp(tool, deps);
  const [catalog, environments, registry, changes] = await Promise.all([
    deps.loop.loadCatalog(tool),
    deps.listEnvironments(tool.id),
    deps.loadRegistry(tool.id),
    deps.changes.changesFor(tool.id, 10),
  ]);
  const envName = (id: number | null) => (id === null ? 'all environments' : (environments.find((e) => e.id === id)?.name ?? `environment ${id}`));
  // Suggestions are extra: if they can't be read, the screen still shows every change and its list.
  const labels = deps.labels ? await deps.labels.labelsFor(changes.map((c) => c.id)).catch(() => []) : [];
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
          const label = labels.find((l) => l.changeId === c.id && l.factId === f.id);
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
            suggestion: label ? { label: label.label, quote: label.quote } : null,
          };
        }),
      notListed: inScope.filter((f) => !f.versionSensitive).length,
      rulesUntouched: registry.rules.filter((r) => r.status === 'active').length,
      otherEnvironments: environments.filter((e) => e.id !== c.environmentId).map((e) => `${e.name} (${e.lastSeenVersion ?? 'version not seen yet'})`),
    });
  }
  return { ok: true, changes: views, environments: environments.map((e) => ({ id: e.id, name: e.name, version: e.lastSeenVersion })) };
}

// ---- "What if we upgrade?": the re-verify list before the version changes -----------------------------------

export type UpgradePreview =
  | {
      ok: true;
      environment: string;
      from: string | null;
      /** The version as the app will count it (the tool's granularity: 14.0.3 is 14.0 at minor). */
      to: string;
      /** The same version at that granularity: nothing would change. */
      same: boolean;
      toRecheck: Array<{ key: string; label: string; scope: string; was: unknown; unit: string | null }>;
      /** Version-dependent facts already verified on the new version. */
      alreadyVerified: number;
      notListed: number;
      /** Recent answers in this environment (30 days) that rely on a verification the new version wouldn't keep. */
      recentAnswers: number;
      rulesUntouched: number;
      otherEnvironments: string[];
    }
  | { ok: false; reason: string };

const Preview = z.object({ toolId: z.number().int().positive(), environmentId: z.number().int().positive(), toVersion: z.string().min(1).max(40) });

/**
 * The owner types the version an environment is about to move to and sees, before anything changes, what the
 * Changes screen would then list: the facts to re-verify, the recent answers that relied on them, and what stays
 * untouched. The same functions as a real change (affectedFacts, staleVerifications); it writes nothing.
 */
export async function handleUpgradePreview(payload: unknown, ctx: ResolverContext, deps: ChangeDeps): Promise<UpgradePreview> {
  const p = Preview.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick an environment and enter a version' };
  const tool = await deps.loop.loadTool(p.data.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  if (!allowed.ok) return allowed;
  const environments = await deps.listEnvironments(tool.id);
  const env = environments.find((e) => e.id === p.data.environmentId);
  if (!env) return { ok: false, reason: 'That environment is not one of this tool' };
  const to = normaliseVersion(p.data.toVersion, tool.versionGranularity);
  if (!to) return { ok: false, reason: 'Enter a version number, such as 14.0' };
  const from = env.lastSeenVersion;
  const [catalog, registry, inScope] = await Promise.all([deps.loop.loadCatalog(tool), deps.loadRegistry(tool.id), deps.changes.factsInScope(tool.id, env.id)]);
  const others = environments.filter((e) => e.id !== env.id).map((e) => `${e.name} (${e.lastSeenVersion ?? 'version not seen yet'})`);
  const common = { environment: env.name, from, to, notListed: inScope.filter((f) => !f.versionSensitive).length, rulesUntouched: registry.rules.filter((r) => r.status === 'active').length, otherEnvironments: others };
  if (from === to) return { ok: true, ...common, same: true, toRecheck: [], alreadyVerified: 0, recentAnswers: 0 };

  const envName = (id: number | null) => (id === null ? 'all environments' : (environments.find((e) => e.id === id)?.name ?? `environment ${id}`));
  const affected = affectedFacts(inScope, to);
  const stale = staleVerifications(inScope, to);
  const recent = (await deps.changes.recentAsks(env.id, RECENT_DAYS)).filter((a) => a.factVersionIds.some((id) => stale.has(id)));
  return {
    ok: true,
    ...common,
    same: false,
    toRecheck: affected.map((f) => {
      const k = catalog.keys.get(f.factKey);
      const active = f.versions.filter((v) => v.status === 'active');
      const was = (from ? active.find((v) => v.version === from) : undefined) ?? active.at(-1);
      return { key: f.factKey, label: k?.label ?? f.factKey, scope: `${envName(f.environmentId)}${f.audienceGroup ? ` · ${f.audienceGroup}` : ''}`, was: was?.value ?? null, unit: k?.unit ?? null };
    }),
    alreadyVerified: inScope.filter((f) => f.status === 'active' && f.versionSensitive).length - affected.length,
    recentAnswers: recent.length,
  };
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

/**
 * "Suggest labels" (spec F9): the owner pastes the notes for one change; one model call labels the facts still
 * open on that change's list. Owner or Jira administrator only, checked here. It saves suggestions and nothing
 * else: no verification is written, so the answers don't change until the owner clicks Still true or Changed.
 */
export async function handleReleaseNotes(
  payload: unknown,
  ctx: ResolverContext,
  deps: ChangeDeps,
): Promise<{ ok: true; labelled: number; grounded: number } | Refusal> {
  const p = ReleaseNotes.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Paste the release notes for one change' };
  if (!deps.labels || !deps.labelChat) return { ok: false, reason: 'Release-note labels are not available here' };
  const change = await deps.changes.changeById(p.data.changeId);
  if (!change) return { ok: false, reason: 'That change no longer exists' };
  const tool = await deps.loop.loadTool(change.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  if (!allowed.ok) return allowed;

  const [catalog, registry, open] = await Promise.all([deps.loop.loadCatalog(tool), deps.loadRegistry(tool.id), deps.changes.openRecheckFacts(change.id)]);
  const facts = registry.facts
    .filter((f) => open.includes(f.id))
    .map((f) => {
      const k = catalog.keys.get(f.factKey);
      const active = f.versions.filter((v) => v.status === 'active');
      const was = active.find((v) => v.version === change.fromVersion) ?? active.at(-1);
      return { factId: f.id, key: f.factKey, label: k?.label ?? f.factKey, was: was?.value ?? null, unit: k?.unit ?? null };
    });
  const r = await labelReleaseNotes({ changeId: change.id, toolName: tool.name, from: change.fromVersion, to: change.toVersion, notes: p.data.notes, facts }, deps.labelChat(), deps.labels);
  // One line per paste, for counting model calls (they cost money). No notes text.
  console.log(`[labels] change=${change.id} ${r.status === 'ok' ? `facts=${r.labels.length} grounded=${r.grounded} model=${r.modelId ?? '-'}` : `${r.status}=${r.reason}`}`);
  if (r.status === 'rejected') return { ok: false, reason: r.reason };
  if (r.status === 'failed') return { ok: false, reason: 'The notes could not be read this time. Try again.' };
  return { ok: true, labelled: r.labels.length, grounded: r.grounded };
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

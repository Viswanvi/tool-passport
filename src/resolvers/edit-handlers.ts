import { z } from 'zod';
import type { CatalogKey } from '../engine/catalog';
import type { AccessMappingRow, CapabilityLink, Environment, FactRow, FactVersionRow, ReadinessKeyRow, RuleRow } from '../engine/model';
import type { LoopDeps } from '../loop/requests';
import { mayAdminister, mayWriteTool, type WriteCheck } from '../registry/authorise';
import { applyEdit, EditPayload, type EditResult } from '../registry/edit';
import type { RegistryWriter } from '../registry/write';
import type { ResolverContext } from './handlers';

/**
 * Owner editing resolvers (spec F1, section 15 My tools). Every write checks, on the server, that the caller is
 * the tool's owner or a Jira administrator; a refusal writes an audit row too (F1). Adding a tool needs a Jira
 * administrator. Identity comes from the Forge context only (CLAUDE.md rules 3 and 4).
 */

export interface RegistryRows {
  facts: Array<FactRow & { versions: FactVersionRow[] }>;
  rules: RuleRow[];
  readinessKeys: ReadinessKeyRow[];
  accessMappings: AccessMappingRow[];
}

export interface EditDeps {
  writer: RegistryWriter;
  check: WriteCheck;
  loop: LoopDeps;
  listEnvironments(toolId: number): Promise<Environment[]>;
  listTools?(): Promise<Array<{ id: number; name: string }>>;
  loadRegistry(toolId: number): Promise<RegistryRows>;
  /** Version changes: a saved verification closes the matching re-verify items. */
  changes?: { closeFactRechecks(factId: number, version: string): Promise<void> };
}

type Refusal = { ok: false; reason: string };

function firstIssue(e: z.ZodError): string {
  const i = e.issues[0];
  return i ? `${i.path.join('.') || 'payload'}: ${i.message}` : 'The change could not be read';
}

export async function handleEdit(payload: unknown, ctx: ResolverContext, deps: EditDeps): Promise<EditResult> {
  const p = EditPayload.safeParse(payload);
  if (!p.success) return { ok: false, reason: firstIssue(p.error) };
  if (!ctx.accountId) return { ok: false, reason: 'Not signed in' };
  const tool = await deps.loop.loadTool(p.data.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  if (!allowed.ok) {
    try {
      await deps.writer.audit(ctx.accountId, 'edit.refused', p.data.entity, String(tool.id), { reason: allowed.reason });
    } catch (e) {
      console.error(`[edit] refusal audit failed: ${String(e).slice(0, 200)}`);
    }
    return { ok: false, reason: allowed.reason };
  }
  try {
    const r = await applyEdit(p.data, tool, ctx.accountId, {
      writer: deps.writer,
      loop: deps.loop,
      listEnvironments: deps.listEnvironments,
      closeFactRechecks: deps.changes ? (factId, version) => deps.changes!.closeFactRechecks(factId, version) : undefined,
      noteVersion: deps.loop.noteVersion,
    });
    console.log(`[edit] ${p.data.entity} ${r.ok ? 'saved' : 'refused'}`);
    return r;
  } catch (e) {
    console.error(`[edit] ${p.data.entity} failed: ${String(e).slice(0, 300)}`);
    return { ok: false, reason: 'Saving stopped part way. Save again: it is safe to repeat.' };
  }
}

const ToolPayload = z.object({
  name: z.string().trim().min(1).max(255),
  versionGranularity: z.enum(['major', 'minor', 'exact']),
  defaultPolicy: z.enum(['none', 'allow']),
});

/** A new tool, owned by the Jira administrator who adds it. An existing name is refused, not taken over. */
export async function handleCreateTool(payload: unknown, ctx: ResolverContext, deps: EditDeps): Promise<{ ok: true; toolId: number } | Refusal> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok || !ctx.accountId) return { ok: false, reason: allowed.ok ? 'Not signed in' : allowed.reason };
  const p = ToolPayload.safeParse(payload);
  if (!p.success) return { ok: false, reason: firstIssue(p.error) };
  const existing = deps.listTools ? await deps.listTools() : [];
  if (existing.some((t) => t.name.toLowerCase() === p.data.name.toLowerCase())) return { ok: false, reason: 'A tool with that name exists' };
  const input = { name: p.data.name, vendor: null, ownerAccountId: ctx.accountId, versionGranularity: p.data.versionGranularity, defaultPolicy: p.data.defaultPolicy };
  const toolId = await deps.writer.upsertTool(input);
  await deps.writer.audit(ctx.accountId, 'tool.saved', 'tool', String(toolId), input);
  return { ok: true, toolId };
}

export interface ToolDetails {
  ok: true;
  tool: { id: number; name: string; versionGranularity: string; defaultPolicy: string; ownerAccountId: string };
  environments: Array<Pick<Environment, 'id' | 'name' | 'provider' | 'providerRef' | 'audienceGroup' | 'lastSeenVersion' | 'ownerAccountId'> & { recordedValues: Record<string, string[]> | null }>;
  catalogKeys: CatalogKey[];
  links: CapabilityLink[];
  registry: RegistryRows;
}

const recordedValuesOf = (v: unknown): Record<string, string[]> | null => {
  const values = v && typeof v === 'object' ? (v as { values?: unknown }).values : null;
  return values && typeof values === 'object' ? (values as Record<string, string[]>) : null;
};

/** Everything the owner records for a tool (spec section 15, My tools). Owner or Jira administrator only. */
export async function handleToolDetails(payload: unknown, ctx: ResolverContext, deps: EditDeps): Promise<ToolDetails | Refusal> {
  const p = z.object({ toolId: z.number().int().positive() }).safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a tool' };
  const tool = await deps.loop.loadTool(p.data.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  if (!allowed.ok) return allowed;
  const [catalog, environments, registry] = await Promise.all([deps.loop.loadCatalog(tool), deps.listEnvironments(tool.id), deps.loadRegistry(tool.id)]);
  return {
    ok: true,
    tool: { id: tool.id, name: tool.name, versionGranularity: tool.versionGranularity, defaultPolicy: tool.defaultPolicy, ownerAccountId: tool.ownerAccountId },
    environments: environments.map((e) => ({
      id: e.id,
      name: e.name,
      provider: e.provider,
      providerRef: e.providerRef,
      audienceGroup: e.audienceGroup,
      lastSeenVersion: e.lastSeenVersion,
      ownerAccountId: e.ownerAccountId,
      recordedValues: recordedValuesOf(e.recordedValues),
    })),
    catalogKeys: [...catalog.keys.values()],
    links: [...catalog.links.values()],
    registry,
  };
}

import { z } from 'zod';
import type { Catalog, Environment, FactRow, FactVersionRow, Tool } from '../engine/model';
import type { ChatFn } from '../engine/translate';
import { mayWriteTool, type WriteCheck } from '../registry/authorise';
import { docCapabilities, draftFactsFromDocs, MAX_DOC_CHARS, type DocSuggestion } from '../registry/doc-facts';
import type { ResolverContext } from './handlers';

/**
 * "Fill in from your docs" (D58): the owner pastes documentation and gets drafted facts back, each with its quote.
 * Owner or Jira administrator only, checked here on the server (CLAUDE.md rule 4). It saves nothing: each draft the
 * owner accepts is published with publishAnswer, the same path as answering an open question. No Forge imports.
 */

export interface DocDeps {
  loadTool(id: number): Promise<Tool | null>;
  loadCatalog(tool: Tool): Promise<Catalog>;
  listEnvironments(toolId: number): Promise<Environment[]>;
  loadRegistry(toolId: number): Promise<{ facts: Array<FactRow & { versions: FactVersionRow[] }> }>;
  check: WriteCheck;
  /** A fresh chat function per paste. */
  chat(): ChatFn;
}

export type DocDraft = DocSuggestion & {
  /** What is already recorded for every environment, so the page can say New, Same or Different; null if nothing. */
  recorded: unknown;
};

export type DocReply = { ok: true; drafts: DocDraft[]; dropped: number; version: string | null } | { ok: false; reason: string };

// A little over the limit, so an over-long paste gets the clear "too long" message rather than "could not be read".
const DocPayload = z.object({ toolId: z.number().int().positive(), docs: z.string().max(MAX_DOC_CHARS + 2000) });

/** The latest active value recorded for every environment and every group, or null. */
function recordedValue(facts: Array<FactRow & { versions: FactVersionRow[] }>, key: string): unknown {
  const f = facts.find((x) => x.factKey === key && x.environmentId === null && x.audienceGroup === null && x.status === 'active');
  const v = f?.versions.filter((x) => x.status === 'active').at(-1);
  return v ? v.value : null;
}

export async function handleDocFacts(payload: unknown, ctx: ResolverContext, deps: DocDeps): Promise<DocReply> {
  const p = DocPayload.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Paste the documentation for one tool' };
  const tool = await deps.loadTool(p.data.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const allowed = await mayWriteTool(ctx.accountId, tool, deps.check);
  if (!allowed.ok) return allowed;

  try {
    const [catalog, environments, registry] = await Promise.all([deps.loadCatalog(tool), deps.listEnvironments(tool.id), deps.loadRegistry(tool.id)]);
    const r = await draftFactsFromDocs({ toolName: tool.name, capabilities: docCapabilities([...catalog.keys.values()]), docs: p.data.docs }, deps.chat());
    // One line per paste, for counting model calls (they cost money). No documentation text.
    console.log(`[docfacts] tool=${tool.id} ${r.status === 'ok' ? `drafts=${r.suggestions.length} dropped=${r.dropped} model=${r.modelId ?? '-'}` : `${r.status}=${r.reason}`}`);
    if (r.status === 'rejected') return { ok: false, reason: r.reason };
    if (r.status === 'failed') return { ok: false, reason: 'The documentation could not be read this time. Try again.' };
    // The version the drafts are verified on by default: the one the environments run now, if they agree.
    const seen = [...new Set(environments.map((e) => e.lastSeenVersion).filter((v): v is string => Boolean(v)))];
    return {
      ok: true,
      drafts: r.suggestions.map((s) => ({ ...s, recorded: recordedValue(registry.facts, s.key) })),
      dropped: r.dropped,
      version: seen.length === 1 ? seen[0]! : null,
    };
  } catch (e) {
    console.error(`[docfacts] failed: ${String(e).slice(0, 300)}`);
    return { ok: false, reason: 'The documentation could not be read this time. Try again.' };
  }
}

import type { SeedResult } from '../seed/demo';

/**
 * Reset demo (spec section 16, judge path step 7: "Setup → Reset demo starts over"). Only the demo tool,
 * Kestrel Studio (found by name): its app data is cleared (questions, request rows, approvals, version changes,
 * labels, facts, rules, mappings, catalog, cached translations, environments), its Assets records get the
 * section 16 values back in Assets mode, and Load demo data runs again in the same mode. Kept: the tool row, the
 * audit log, request and approval setup, the groups, and the Jira requests already raised (they stay in the
 * desk; a later resolution finds no row and is ignored). No transactions: every step is safe to repeat, so a
 * reset that stops part way is finished by running it again. No Forge imports.
 */

export interface ResetStore {
  /** The demo tool and the mode its environments use, or null if the demo was never loaded. */
  demoTool(): Promise<{ id: number; mode: 'assets' | 'registry' } | null>;
  /** Delete every row about this tool except the tool itself and the audit log; rows deleted per table. */
  clearTool(toolId: number): Promise<Record<string, number>>;
}

export interface ResetDeps {
  store: ResetStore;
  resetRecords(): Promise<{ ok: true } | { ok: false; reason: string }>;
  load(mode: 'assets' | 'registry'): Promise<SeedResult>;
}

const BY_HAND =
  'In Assets, set KS-DEV to Version 13.2, Build environments standard, Features enabled uploads and scheduling; and KS-PROD to Version 13.2, Build environments standard and frontend, Features enabled uploads, scheduling and single sign-on.';

export async function resetDemo(deps: ResetDeps): Promise<SeedResult> {
  const tool = await deps.store.demoTool();
  const mode = tool?.mode ?? 'assets';
  const cleared = tool ? Object.values(await deps.store.clearTool(tool.id)).reduce((a, b) => a + b, 0) : 0;

  const warnings: string[] = [];
  if (mode === 'assets') {
    const records = await deps.resetRecords();
    if (!records.ok) warnings.push(`The demo's Assets records could not be put back (${records.reason}). ${BY_HAND}`);
  }

  const loaded = await deps.load(mode);
  if (!loaded.ok) return { ok: false, reason: `The demo data was cleared but not loaded again (${loaded.reason}). Reset demo again to finish.` };
  const all = [...(loaded.warnings ?? []), ...warnings];
  return { ...loaded, counts: { ...loaded.counts, cleared }, ...(all.length ? { warnings: all } : {}) };
}

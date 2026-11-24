import type { SeedDeps, SeedResult } from '../seed/demo';
import type { RecordsResult } from './assets-records';

/**
 * "Load demo data" (spec section 16, judge path step 2): the Assets records first, then the app's own records
 * (`seedDemo`, through the owner write layer) linked to their keys. If the Assets records can't be made,
 * nothing else is written. No Forge imports.
 */

export const NO_ASSETS_REASON = 'This site has no Assets workspace. Load the demo data in registry mode instead: the environments are then recorded by the owner in Tool Passport.';

export async function loadDemoData(
  deps: {
    ensureRecords(): Promise<RecordsResult>;
    seed(d: Pick<SeedDeps, 'findObjectKey' | 'registry'>): Promise<SeedResult>;
    now?(): string;
  },
  mode: 'assets' | 'registry' = 'assets',
): Promise<SeedResult> {
  // Registry mode (a site without Assets): the seed records the environment values itself.
  if (mode === 'registry') return deps.seed({ findObjectKey: async () => null, registry: { now: deps.now ?? (() => new Date().toISOString()) } });
  const records = await deps.ensureRecords();
  if (!records.ok) {
    return { ok: false, reason: records.reason === 'no_assets' ? NO_ASSETS_REASON : `The demo's Assets records could not be made (${records.reason}). Nothing else was written.` };
  }
  const keys: Record<string, string> = records.keys;
  const seeded = await deps.seed({ findObjectKey: async (name) => keys[name] ?? null });
  if (!seeded.ok || records.created.length === 0) return seeded;
  return { ...seeded, counts: { ...seeded.counts, assetsRecordsCreated: records.created.length } };
}

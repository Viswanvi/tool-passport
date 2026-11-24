import type { SeedDeps, SeedResult } from '../seed/demo';
import type { RecordsResult } from './assets-records';
import type { GroupsResult } from './groups';

/**
 * "Load demo data" (spec section 16, judge path step 2): in Assets mode the Assets records first, then the
 * app's own records (`seedDemo`, through the owner write layer) linked to their keys; in registry mode the app's
 * records only. If the Assets records can't be made, nothing else is written. Then the two demo groups, in
 * either mode: if they can't be made, the load still stands and says exactly what to do by hand. No Forge
 * imports.
 */

export const NO_ASSETS_REASON = 'This site has no Assets workspace. Load the demo data in registry mode instead: the environments are then recorded by the owner in Tool Passport.';

export async function loadDemoData(
  deps: {
    ensureRecords(): Promise<RecordsResult>;
    seed(d: Pick<SeedDeps, 'findObjectKey' | 'registry'>): Promise<SeedResult>;
    ensureGroups?(): Promise<GroupsResult>;
    now?(): string;
  },
  mode: 'assets' | 'registry' = 'assets',
): Promise<SeedResult> {
  let seeded: SeedResult;
  if (mode === 'registry') {
    // A site without Assets: the seed records the environment values itself.
    seeded = await deps.seed({ findObjectKey: async () => null, registry: { now: deps.now ?? (() => new Date().toISOString()) } });
  } else {
    const records = await deps.ensureRecords();
    if (!records.ok) {
      return { ok: false, reason: records.reason === 'no_assets' ? NO_ASSETS_REASON : `The demo's Assets records could not be made (${records.reason}). Nothing else was written.` };
    }
    const keys: Record<string, string> = records.keys;
    seeded = await deps.seed({ findObjectKey: async (name) => keys[name] ?? null });
    if (seeded.ok && records.created.length) seeded = { ...seeded, counts: { ...seeded.counts, assetsRecordsCreated: records.created.length } };
  }
  if (!seeded.ok || !deps.ensureGroups) return seeded;

  const groups = await deps.ensureGroups();
  if (!groups.ok) {
    return {
      ...seeded,
      warnings: [
        `The demo groups could not be made (${groups.reason}). Create kestrel-dev-builders and kestrel-prod-deployers under Atlassian Administration → Directory → Groups, and add yourself to kestrel-dev-builders. Until then, access checks in the demo fail.`,
      ],
    };
  }
  const counts = { ...seeded.counts };
  if (groups.created.length) counts.groupsCreated = groups.created.length;
  if (groups.joined) counts.addedToGroup = 1;
  return { ...seeded, counts };
}

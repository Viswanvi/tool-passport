import { describe, expect, it, vi } from 'vitest';
import type { RecordsResult } from '../../src/setup/assets-records';
import { loadDemoData, NO_ASSETS_REASON } from '../../src/setup/load-demo';
import type { SeedDeps, SeedResult } from '../../src/seed/demo';

/**
 * "Load demo data" end to end (spec section 16, judge path step 2): first the Assets records, then the app's
 * own records linked to them. If the Assets records can't be made, nothing else is written.
 */

const OK_RECORDS: RecordsResult = { ok: true, keys: { 'KS-DEV': 'TPENV-1', 'KS-PROD': 'TPENV-2' }, created: ['schema', 'KS-DEV', 'KS-PROD'], as: 'app' };
const SEEDED: SeedResult = {
  ok: true,
  toolId: 1,
  environments: [
    { name: 'KS-DEV', providerRef: 'TPENV-1' },
    { name: 'KS-PROD', providerRef: 'TPENV-2' },
  ],
  counts: { tools: 1 },
};

describe('Load demo data', () => {
  it('makes the Assets records, then seeds the app linked to their keys, and reports what it created', async () => {
    const seed = vi.fn(async (d: Pick<SeedDeps, 'findObjectKey'>) => {
      expect(await d.findObjectKey('KS-DEV')).toBe('TPENV-1');
      expect(await d.findObjectKey('KS-PROD')).toBe('TPENV-2');
      expect(await d.findObjectKey('KS-TEST')).toBeNull();
      return SEEDED;
    });
    const r = await loadDemoData({ ensureRecords: async () => OK_RECORDS, seed });
    expect(seed).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ ok: true, counts: { tools: 1, assetsRecordsCreated: 3 } });
  });

  it('records that already exist add no count', async () => {
    const r = await loadDemoData({ ensureRecords: async () => ({ ...OK_RECORDS, created: [] }), seed: async () => SEEDED });
    expect(r).toEqual(SEEDED);
  });

  it('no Assets on the site: nothing is written, and the reason points to registry mode', async () => {
    const seed = vi.fn();
    expect(await loadDemoData({ ensureRecords: async () => ({ ok: false, reason: 'no_assets' }), seed })).toEqual({ ok: false, reason: NO_ASSETS_REASON });
    expect(NO_ASSETS_REASON).toContain('registry mode');
    expect(seed).not.toHaveBeenCalled();
  });

  it('registry mode never touches Assets: the seed records the values itself', async () => {
    const ensureRecords = vi.fn();
    const seed = vi.fn(async (d: Pick<SeedDeps, 'findObjectKey' | 'registry'>) => {
      expect(d.registry?.now()).toBe('2026-11-24T10:00:00.000Z');
      return SEEDED;
    });
    expect(await loadDemoData({ ensureRecords, seed, now: () => '2026-11-24T10:00:00.000Z' }, 'registry')).toEqual(SEEDED);
    expect(ensureRecords).not.toHaveBeenCalled();
  });

  it('then makes the demo groups, in either mode, and counts what it did', async () => {
    const ensureGroups = vi.fn(async () => ({ ok: true as const, created: ['kestrel-dev-builders', 'kestrel-prod-deployers'], joined: true, as: 'user' as const }));
    const assets = await loadDemoData({ ensureRecords: async () => ({ ...OK_RECORDS, created: [] }), seed: async () => SEEDED, ensureGroups });
    expect(assets).toMatchObject({ ok: true, counts: { tools: 1, groupsCreated: 2, addedToGroup: 1 } });
    const registry = await loadDemoData({ ensureRecords: vi.fn(), seed: async () => SEEDED, ensureGroups }, 'registry');
    expect(registry).toMatchObject({ ok: true, counts: { groupsCreated: 2 } });
    expect(ensureGroups).toHaveBeenCalledTimes(2);
  });

  it("groups that can't be made don't undo the load: it says exactly what to do by hand", async () => {
    const r = await loadDemoData({
      ensureRecords: async () => ({ ...OK_RECORDS, created: [] }),
      seed: async () => SEEDED,
      ensureGroups: async () => ({ ok: false as const, reason: 'create group kestrel-dev-builders: 401' }),
    });
    expect(r).toMatchObject({ ok: true, warnings: [expect.stringContaining('kestrel-dev-builders')] });
    if (r.ok) {
      expect(r.warnings![0]).toContain('401');
      expect(r.warnings![0]).toContain('add yourself to kestrel-dev-builders');
    }
  });

  it('no groups step runs when the load itself failed', async () => {
    const ensureGroups = vi.fn();
    await loadDemoData({ ensureRecords: async () => ({ ok: false, reason: 'no_assets' }), seed: vi.fn(), ensureGroups });
    expect(ensureGroups).not.toHaveBeenCalled();
  });

  it('Assets refused: nothing is written, and the reason says which step', async () => {
    const seed = vi.fn();
    const r = await loadDemoData({ ensureRecords: async () => ({ ok: false, reason: 'Assets create schema: 403' }), seed });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('create schema: 403') });
    expect(seed).not.toHaveBeenCalled();
  });
});

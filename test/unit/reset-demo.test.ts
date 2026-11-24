import { describe, expect, it, vi } from 'vitest';
import type { SeedResult } from '../../src/seed/demo';
import { resetDemo, type ResetStore } from '../../src/setup/reset-demo';

/**
 * Reset demo (spec section 16, judge path step 7: "Setup → Reset demo starts over"). Only the demo tool,
 * Kestrel Studio, found by name: its app data is cleared, its Assets records get the section 16 values back
 * (Assets mode), and Load demo data runs again in the same mode. Jira requests already raised stay in the desk.
 */

const LOADED: SeedResult = { ok: true, toolId: 1, environments: [{ name: 'KS-DEV', providerRef: 'TPENV-1' }], counts: { tools: 1 } };

function store(over: Partial<ResetStore> = {}) {
  const calls: string[] = [];
  const s: ResetStore = {
    demoTool: async () => {
      calls.push('find');
      return { id: 7, mode: 'assets' };
    },
    clearTool: async (toolId) => {
      calls.push(`clear ${toolId}`);
      return { asks: 5, requests: 3, changes: 4 };
    },
    ...over,
  };
  return { s, calls };
}

describe('Reset demo', () => {
  it("clears only the demo tool's data, puts the Assets records back, then loads the demo again in the same mode", async () => {
    const { s, calls } = store();
    const resetRecords = vi.fn(async () => ({ ok: true as const }));
    const load = vi.fn(async () => LOADED);
    const r = await resetDemo({ store: s, resetRecords, load });
    expect(calls).toEqual(['find', 'clear 7']);
    expect(resetRecords).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith('assets');
    expect(r).toMatchObject({ ok: true, counts: { tools: 1, cleared: 12 } });
  });

  it('a site with no demo yet just loads it', async () => {
    const { s, calls } = store({ demoTool: async () => null });
    const load = vi.fn(async () => LOADED);
    expect(await resetDemo({ store: s, resetRecords: async () => ({ ok: true as const }), load })).toMatchObject({ ok: true });
    expect(calls).toEqual([]);
    expect(load).toHaveBeenCalledWith('assets');
  });

  it('registry mode stays registry mode and never touches Assets', async () => {
    const { s } = store({ demoTool: async () => ({ id: 7, mode: 'registry' }) });
    const resetRecords = vi.fn();
    const load = vi.fn(async () => LOADED);
    await resetDemo({ store: s, resetRecords, load });
    expect(resetRecords).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledWith('registry');
  });

  it("Assets records that can't be put back don't stop the reset: it says what to set by hand", async () => {
    const { s } = store();
    const r = await resetDemo({ store: s, resetRecords: async () => ({ ok: false as const, reason: 'Assets update KS-DEV: 403' }), load: async () => LOADED });
    expect(r).toMatchObject({ ok: true, warnings: [expect.stringContaining('Version 13.2')] });
    if (r.ok) expect(r.warnings![0]).toContain('403');
  });

  it('a load that fails after clearing says so, and that running it again finishes the job', async () => {
    const { s } = store();
    const r = await resetDemo({ store: s, resetRecords: async () => ({ ok: true as const }), load: async () => ({ ok: false as const, reason: 'SQL timed out' }) });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('Reset demo again') });
  });
});

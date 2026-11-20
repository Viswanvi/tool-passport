import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/sql', () => ({ migrationRunner: {}, sql: {} }));

const { gapReport } = await import('../../src/experiments/e10');

describe('E10 gap report', () => {
  it('reports no gap for a single tick', () => {
    expect(gapReport(['2026-11-20 10:00:00.000'])).toMatchObject({ ticks: 1, maxGapMinutes: 0, gapsOver10: 0 });
  });

  it('measures the largest gap between consecutive ticks', () => {
    const r = gapReport(['2026-11-20 10:00:00.000', '2026-11-20 10:05:02.000', '2026-11-20 10:17:00.000']);
    expect(r.ticks).toBe(3);
    expect(r.maxGapMinutes).toBe(12);
    expect(r.gapsOver10).toBe(1);
  });

  it('accepts ISO timestamps too', () => {
    expect(gapReport(['2026-11-20T10:00:00Z', '2026-11-20T10:05:00Z']).maxGapMinutes).toBe(5);
  });
});

/**
 * E10: does the five-minute scheduled trigger run, and can it read Assets without a user?
 * The tick is recorded here; the Assets read without a user is E1's "sweep:app" and
 * "sweep:impersonate" runs. Pass bar: no gap over 10 minutes across two hours.
 */
import { recordRun, runTimes } from '../db/store';

export async function tick(): Promise<void> {
  const at = new Date().toISOString();
  await recordRun('E10', 'sweep', true, `tick ${at}`, null);
  console.log(`[E10] tick ${at}`);
}

export interface GapReport {
  ticks: number;
  first?: string;
  last?: string;
  maxGapMinutes: number;
  gapsOver10: number;
}

/** Gaps between consecutive ticks; pure, so it is unit-tested. */
export function gapReport(times: string[]): GapReport {
  const ms = times.map((t) => Date.parse(t.includes('T') || t.endsWith('Z') ? t : `${t.replace(' ', 'T')}Z`)).filter((n) => !Number.isNaN(n));
  let maxGap = 0;
  let over = 0;
  for (let i = 1; i < ms.length; i++) {
    const gap = ((ms[i] ?? 0) - (ms[i - 1] ?? 0)) / 60000;
    maxGap = Math.max(maxGap, gap);
    if (gap > 10) over++;
  }
  return { ticks: ms.length, first: times[0], last: times[times.length - 1], maxGapMinutes: Math.round(maxGap * 10) / 10, gapsOver10: over };
}

export async function report(): Promise<GapReport> {
  return gapReport(await runTimes('E10', 1000));
}

import { SAFETY_CASES, type SafetyCase } from './cases';

/**
 * Runs the false-Yes cases one after another and reports each, so Setup can show the same suite the build
 * runs (spec section 19). A failing case is reported with its reason and the run carries on. No Forge imports:
 * every case uses fixed data in memory and a scripted model.
 */

export interface SafetyFailure {
  id: string;
  group: string;
  title: string;
  reason: string;
}

export interface SafetyRun {
  total: number;
  passed: number;
  failed: SafetyFailure[];
  /** Per spec case, in the list's order. */
  groups: Array<{ group: string; total: number; passed: number }>;
}

export async function runSafetySuite(cases: readonly SafetyCase[] = SAFETY_CASES): Promise<SafetyRun> {
  const failed: SafetyFailure[] = [];
  const groups: SafetyRun['groups'] = [];
  for (const c of cases) {
    let passed = true;
    try {
      await c.run();
    } catch (e) {
      passed = false;
      failed.push({ id: c.id, group: c.group, title: c.title, reason: e instanceof Error ? e.message : String(e) });
    }
    let g = groups.find((x) => x.group === c.group);
    if (!g) {
      g = { group: c.group, total: 0, passed: 0 };
      groups.push(g);
    }
    g.total += 1;
    if (passed) g.passed += 1;
  }
  return { total: cases.length, passed: cases.length - failed.length, failed, groups };
}

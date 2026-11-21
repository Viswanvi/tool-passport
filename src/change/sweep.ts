/**
 * The five-minute sweep (spec section 11). Runs with no user; reads go through the app context (D25).
 * Today it only keeps the tables current. Phase 1 adds the open-request re-checks, Phase 3 the version
 * detection (`noteVersion` in ./detect.ts) and re-verify lists.
 */
import { runMigrations } from '../db/migrations';
import { clearPhase0Settings } from '../db/phase0-cleanup';

export async function sweep(): Promise<void> {
  try {
    const applied = await runMigrations();
    if (applied.length) console.log(`[sweep] migrations applied: ${applied.join(', ')}`);
    await clearPhase0Settings(applied, 'sweep');
  } catch (e) {
    console.error(`[sweep] migrations failed: ${String(e).slice(0, 300)}`);
  }
}

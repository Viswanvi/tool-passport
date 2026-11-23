/**
 * The five-minute sweep (spec section 11). Runs with no user; reads go through the app context (D25).
 * Today it only keeps the tables current. Phase 1 adds the open-request re-checks, Phase 3 the version
 * detection (`noteVersion` in ./detect.ts) and re-verify lists.
 */
import { purgeOldQuestions } from '../db/asks';
import { runMigrations } from '../db/migrations';
import { clearPhase0Settings } from '../db/phase0-cleanup';

export async function sweep(): Promise<void> {
  try {
    const applied = await runMigrations();
    if (applied.length) console.log(`[sweep] migrations applied: ${applied.join(', ')}`);
    await clearPhase0Settings(applied, 'sweep');
  } catch (e) {
    console.error(`[sweep] migrations failed: ${String(e).slice(0, 300)}`);
    return;
  }
  try {
    // Spec section 14: question text is kept 30 days.
    const purged = await purgeOldQuestions();
    if (purged) console.log(`[sweep] question text removed from ${purged} asks older than 30 days`);
  } catch (e) {
    console.error(`[sweep] question purge failed: ${String(e).slice(0, 300)}`);
  }
}

/**
 * The five-minute sweep (spec section 11). Runs with no user; reads go through the app context (D25).
 * It keeps the tables current, re-checks open requests, and deletes old question text. Phase 3 adds the
 * version detection (`noteVersion` in ./detect.ts) and re-verify lists.
 */
import { purgeOldQuestions } from '../db/asks';
import { runMigrations } from '../db/migrations';
import { clearPhase0Settings } from '../db/phase0-cleanup';
import { sweepRequests } from '../loop/events';
import { loopDeps } from '../loop/forge';

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
    // Requests whose resolution event never arrived, and re-checks that stopped part way (D22, E5).
    const r = await sweepRequests(loopDeps, 25);
    if (r.looked) console.log(`[sweep] requests looked=${r.looked} rechecked=${r.rechecked} failed=${r.failed}`);
  } catch (e) {
    console.error(`[sweep] request re-check failed: ${String(e).slice(0, 300)}`);
  }
  try {
    // Spec section 14: question text is kept 30 days.
    const purged = await purgeOldQuestions();
    if (purged) console.log(`[sweep] question text removed from ${purged} asks older than 30 days`);
  } catch (e) {
    console.error(`[sweep] question purge failed: ${String(e).slice(0, 300)}`);
  }
}

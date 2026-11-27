/**
 * The five-minute sweep (spec section 11). Runs with no user; reads go through the app context (D25).
 * It keeps the tables current, re-checks open requests, notes version changes and builds the owner's
 * re-verify lists, and deletes old question text.
 */
import { purgeOldQuestions } from '../db/asks';
import { sqlChangeRepo } from '../db/changes';
import { runMigrations } from '../db/migrations';
import { listEnvironments, listTools, loadTool } from '../db/repo';
import { sweepRequests } from '../loop/events';
import { loopDeps, noteEnvironmentVersion } from '../loop/forge';
import { refreshStoriesSafely, storiesAfterChange } from '../loop/stories';
import { detectVersions, sweepChanges } from './changes';

export async function sweep(): Promise<void> {
  try {
    const applied = await runMigrations();
    if (applied.length) console.log(`[sweep] migrations applied: ${applied.join(', ')}`);
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
    // Version changes without an ask (F6, E10), then the owner's re-verify lists (spec section 11).
    const tools = await Promise.all((await listTools()).map(async (t) => ({ tool: await loadTool(t.id), environments: await listEnvironments(t.id) })));
    const found = await detectVersions(
      tools.flatMap((t) => (t.tool ? [{ tool: t.tool, environments: t.environments }] : [])),
      loopDeps.environments,
      noteEnvironmentVersion,
    );
    // Once a change is listed, the stories in that environment hear about it (D55).
    const lists = await sweepChanges(sqlChangeRepo, 10, (c) => refreshStoriesSafely(storiesAfterChange(c), loopDeps));
    if (found || lists.listed || lists.failed) console.log(`[sweep] versions changed=${found} lists listed=${lists.listed} failed=${lists.failed}`);
  } catch (e) {
    console.error(`[sweep] version check failed: ${String(e).slice(0, 300)}`);
  }
  try {
    // Spec section 14: question text is kept 30 days.
    const purged = await purgeOldQuestions();
    if (purged) console.log(`[sweep] question text removed from ${purged} asks older than 30 days`);
  } catch (e) {
    console.error(`[sweep] question purge failed: ${String(e).slice(0, 300)}`);
  }
}

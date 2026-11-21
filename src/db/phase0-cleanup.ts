import { sql } from '@forge/sql';

export const DROP_EXPERIMENTS_MIGRATION = 'v020_drop_experiment_runs';

/**
 * Phase 0 left experiment state in app_settings (exp.*). Run once per installation: by whichever of the
 * lifecycle event or the sweep applies the migration that drops the experiment log. 4.6.0 was a minor
 * version (removing allowImpersonation needs no consent), so no upgrade event fires and the sweep does it.
 */
export async function clearPhase0Settings(applied: string[], where: string): Promise<void> {
  if (!applied.includes(DROP_EXPERIMENTS_MIGRATION)) return;
  try {
    await sql.prepare("DELETE FROM app_settings WHERE name LIKE 'exp.%'").execute();
    console.log(`[${where}] cleared Phase 0 experiment settings`);
  } catch (e) {
    console.error(`[${where}] clearing Phase 0 settings failed: ${String(e).slice(0, 300)}`);
  }
}

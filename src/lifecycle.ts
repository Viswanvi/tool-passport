import { runMigrations } from './db/migrations';

/**
 * avi:forge:installed:app and avi:forge:upgraded:app (major upgrades only). Creates the tables
 * as soon as the app is installed; the sweep re-runs the same idempotent migrations as a fallback.
 */
export async function onLifecycle(): Promise<void> {
  try {
    const applied = await runMigrations();
    console.log(`[lifecycle] migrations applied: ${applied.length ? applied.join(', ') : 'none'}`);
  } catch (e) {
    console.error(`[lifecycle] migrations failed (the sweep retries): ${String(e).slice(0, 300)}`);
  }
}

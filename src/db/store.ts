import { sql } from '@forge/sql';

/**
 * Forge SQL rejects a bound LIMIT parameter ("ERROR 1210: Incorrect arguments to LIMIT", seen
 * 2026-11-20), so LIMIT takes an inlined integer. Clamping to a whole number keeps it injection-safe.
 */
export const limitClause = (n: number): string => `LIMIT ${Math.max(1, Math.min(1000, Math.trunc(Number(n) || 1)))}`;

/**
 * JSON columns arrive already parsed as objects (seen 2026-11-20), although the Forge SQL docs say
 * they are returned as strings. Accept both so a platform change can't break reads.
 */
export function fromJsonColumn<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

/** App settings (service desk, request types, model choice, …). See DECISIONS D14. */
export async function getSetting<T>(name: string): Promise<T | null> {
  const res = await sql
    .prepare<{ value_json: unknown }>('SELECT value_json FROM app_settings WHERE name = ?')
    .bindParams(name)
    .execute();
  return fromJsonColumn<T>(res.rows[0]?.value_json);
}

export async function setSetting(name: string, value: unknown): Promise<void> {
  // Upsert: safe to repeat, so no transaction is needed.
  await sql
    .prepare(
      'INSERT INTO app_settings (name, value_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)',
    )
    .bindParams(name, JSON.stringify(value))
    .execute();
}

// ---- Phase 0 experiment log (table experiment_runs; dropped after Phase 0) ----

export interface RunRow {
  id: number;
  experiment: string;
  context: string;
  ok: boolean;
  summary: string;
  ran_at: string;
}

export async function recordRun(
  experiment: string,
  context: string,
  ok: boolean,
  summary: string,
  detail: unknown,
): Promise<void> {
  await sql
    .prepare('INSERT INTO experiment_runs (experiment, context, ok, summary, detail) VALUES (?, ?, ?, ?, ?)')
    .bindParams(experiment, context, ok ? 1 : 0, summary.slice(0, 500), JSON.stringify(detail ?? null))
    .execute();
}

export async function recentRuns(limit: number): Promise<RunRow[]> {
  const res = await sql
    // AUTO_INCREMENT ids are handed out in blocks (3 then 30001 seen 2026-11-20), so id order is not time order.
    .prepare<RunRow>(`SELECT id, experiment, context, ok, summary, ran_at FROM experiment_runs ORDER BY ran_at DESC ${limitClause(limit)}`)
    .execute();
  return res.rows.map((r) => ({ ...r, ok: Boolean(Number(r.ok)) }));
}

export async function runDetail(id: number): Promise<unknown> {
  const res = await sql
    .prepare<{ detail: unknown }>('SELECT detail FROM experiment_runs WHERE id = ?')
    .bindParams(id)
    .execute();
  return fromJsonColumn<unknown>(res.rows[0]?.detail);
}

export async function runTimes(experiment: string, limit: number): Promise<string[]> {
  const res = await sql
    .prepare<{ ran_at: string }>(`SELECT ran_at FROM experiment_runs WHERE experiment = ? ORDER BY ran_at DESC ${limitClause(limit)}`)
    .bindParams(experiment)
    .execute();
  return res.rows.map((r) => r.ran_at).reverse();
}

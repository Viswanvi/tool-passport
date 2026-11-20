import { sql } from '@forge/sql';

/** App settings (service desk, request types, model choice, …). See DECISIONS D14. */
export async function getSetting<T>(name: string): Promise<T | null> {
  const res = await sql
    .prepare<{ value_json: string }>('SELECT value_json FROM app_settings WHERE name = ?')
    .bindParams(name)
    .execute();
  const row = res.rows[0];
  return row ? (JSON.parse(row.value_json) as T) : null;
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
    .prepare<RunRow>(
      'SELECT id, experiment, context, ok, summary, ran_at FROM experiment_runs ORDER BY id DESC LIMIT ?',
    )
    .bindParams(limit)
    .execute();
  return res.rows.map((r) => ({ ...r, ok: Boolean(Number(r.ok)) }));
}

export async function runDetail(id: number): Promise<unknown> {
  const res = await sql
    .prepare<{ detail: string | null }>('SELECT detail FROM experiment_runs WHERE id = ?')
    .bindParams(id)
    .execute();
  const d = res.rows[0]?.detail;
  return d ? JSON.parse(d) : null;
}

export async function runTimes(experiment: string, limit: number): Promise<string[]> {
  const res = await sql
    .prepare<{ ran_at: string }>(
      'SELECT ran_at FROM experiment_runs WHERE experiment = ? ORDER BY id DESC LIMIT ?',
    )
    .bindParams(experiment, limit)
    .execute();
  return res.rows.map((r) => r.ran_at).reverse();
}

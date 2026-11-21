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

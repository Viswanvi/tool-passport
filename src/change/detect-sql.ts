import { sql, type UpdateQueryResponse } from '@forge/sql';
import type { ChangeRow, DetectRepo } from './detect';

/** Forge SQL implementation of the detection repository. Every statement is safe to repeat. */
export const sqlDetectRepo: DetectRepo = {
  async setBaseline(environmentId, version) {
    const res = await sql
      .prepare<UpdateQueryResponse>(
        'UPDATE environments SET last_seen_version = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ? AND last_seen_version IS NULL',
      )
      .bindParams(version, environmentId)
      .execute();
    return res.rows.affectedRows === 1;
  },

  async insertChangeIgnoreDuplicate(row: ChangeRow) {
    // ON DUPLICATE KEY UPDATE id = id, not INSERT IGNORE: IGNORE would also hide unrelated errors.
    // affectedRows is 1 for a new row and for a skipped duplicate alike (E7), so it isn't returned.
    await sql
      .prepare<UpdateQueryResponse>(
        `INSERT INTO changes (tool_id, environment_id, baseline_at, from_version, to_version, origin)
         VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
      )
      .bindParams(row.toolId, row.environmentId, row.baselineAt, row.fromVersion, row.toVersion, row.origin)
      .execute();
  },

  async compareAndSetVersion(environmentId, from, to) {
    const res = await sql
      .prepare<UpdateQueryResponse>(
        'UPDATE environments SET last_seen_version = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ? AND last_seen_version = ?',
      )
      .bindParams(to, environmentId, from)
      .execute();
    return res.rows.affectedRows === 1;
  },
};

import { sql, type UpdateQueryResponse } from '@forge/sql';
import type { ChangeRecord, ChangeRepo } from '../change/changes';
import { factsWithVersions, id, oneOf, text, textOrNull, time, utcIso } from './repo';
import { fromJsonColumn, limitClause } from './store';

/**
 * The `changes` and `recheck_items` tables (spec section 10) and the asks' "may have changed" flag. Every
 * statement is safe to repeat: items are unique per (change, kind, ref) and inserted ignoring duplicates;
 * status changes are single updates. A change listed for the owner sets `owner_notified_at` (the owner is told
 * on the Changes screen, D39). Lists sort by time, then id: Forge SQL hands out ids that are not in time order
 * (found live: id 2 was made after id 30005).
 */

type Row = Record<string, unknown>;

const COLS = 'id, tool_id, environment_id, from_version, to_version, origin, status, attempts, error, created_at';

export function changeRow(r: Row): ChangeRecord {
  const t = 'changes';
  return {
    id: id(r.id, t, 'id'),
    toolId: id(r.tool_id, t, 'tool_id'),
    environmentId: id(r.environment_id, t, 'environment_id'),
    fromVersion: text(r.from_version, t, 'from_version'),
    toVersion: text(r.to_version, t, 'to_version'),
    origin: oneOf(r.origin, ['detected', 'recorded'] as const, t, 'origin'),
    status: oneOf(r.status, ['open', 'listed', 'failed'] as const, t, 'status'),
    attempts: id(r.attempts ?? 0, t, 'attempts'),
    error: textOrNull(r.error, t, 'error'),
    createdAt: utcIso(time(r.created_at, t, 'created_at') ?? ''),
  };
}

export { utcIso };

async function select(query: string, ...params: unknown[]): Promise<Row[]> {
  const res = await sql.prepare<Row>(query).bindParams(...params).execute();
  return (res.rows ?? []) as Row[];
}

async function update(query: string, ...params: unknown[]): Promise<number> {
  const res = await sql.prepare<UpdateQueryResponse>(query).bindParams(...params).execute();
  return res.rows.affectedRows ?? 0;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export const sqlChangeRepo: ChangeRepo = {
  async openChanges(limit) {
    return (await select(`SELECT ${COLS} FROM changes WHERE status = 'open' ORDER BY created_at ASC, id ASC ${limitClause(limit)}`)).map(changeRow);
  },

  async changesFor(toolId, limit) {
    return (await select(`SELECT ${COLS} FROM changes WHERE tool_id = ? ORDER BY created_at DESC, id DESC ${limitClause(limit)}`, toolId)).map(changeRow);
  },

  async changeById(changeId) {
    const rows = await select(`SELECT ${COLS} FROM changes WHERE id = ?`, changeId);
    return rows[0] ? changeRow(rows[0]) : null;
  },

  factsInScope: (toolId, environmentId) => factsWithVersions(toolId, environmentId),

  async addRecheckItems(changeId, kind, refIds) {
    if (refIds.length === 0) return;
    await update(
      `INSERT INTO recheck_items (change_id, kind, ref_id) VALUES ${refIds.map(() => '(?, ?, ?)').join(', ')} ON DUPLICATE KEY UPDATE id = id`,
      ...refIds.flatMap((ref) => [changeId, kind, ref]),
    );
  },

  async openRecheckFacts(changeId) {
    const rows = await select("SELECT ref_id FROM recheck_items WHERE change_id = ? AND kind = 'fact' AND status = 'open' ORDER BY id", changeId);
    return rows.map((r) => id(r.ref_id, 'recheck_items', 'ref_id'));
  },

  async closeFactRechecks(factId, version) {
    await update(
      "UPDATE recheck_items SET status = 'done' WHERE kind = 'fact' AND ref_id = ? AND status = 'open' AND change_id IN (SELECT id FROM changes WHERE to_version = ?)",
      factId,
      version,
    );
  },

  async recentAsks(environmentId, days) {
    const rows = await select(
      `SELECT id, evidence_json FROM asks WHERE environment_id = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${Math.max(1, Math.trunc(days))} DAY) ORDER BY created_at DESC, id DESC ${limitClause(500)}`,
      environmentId,
    );
    return rows.map((r) => {
      const evidence = fromJsonColumn<{ factVersionIds?: unknown }>(r.evidence_json);
      const ids = Array.isArray(evidence?.factVersionIds) ? evidence.factVersionIds.filter((v): v is number => typeof v === 'number') : [];
      return { id: id(r.id, 'asks', 'id'), factVersionIds: ids };
    });
  },

  async markMayHaveChanged(askIds) {
    if (askIds.length === 0) return;
    await update(`UPDATE asks SET may_have_changed = TRUE WHERE id IN (${placeholders(askIds.length)})`, ...askIds);
  },

  async setStatus(changeId, status, error) {
    await update(
      status === 'listed'
        ? 'UPDATE changes SET status = ?, error = ?, owner_notified_at = COALESCE(owner_notified_at, CURRENT_TIMESTAMP) WHERE id = ?'
        : 'UPDATE changes SET status = ?, error = ? WHERE id = ?',
      status,
      error ?? null,
      changeId,
    );
  },

  async bumpAttempts(changeId, error) {
    await update('UPDATE changes SET attempts = attempts + 1, error = ? WHERE id = ?', error, changeId);
    const rows = await select('SELECT attempts FROM changes WHERE id = ?', changeId);
    return rows[0] ? id(rows[0].attempts, 'changes', 'attempts') : 0;
  },
};

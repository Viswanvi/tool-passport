import { sql, type UpdateQueryResponse } from '@forge/sql';
import { openKey, REQUEST_KINDS, REQUEST_STATUSES, type RequestRepo, type RequestRow } from '../loop/requests';
import { id, idOrNull, oneOf, text, textOrNull } from './repo';
import { limitClause } from './store';

/**
 * The `requests` table (spec section 10). No transactions in Forge SQL, so every change is one statement
 * guarded by the row's current status (compare-and-set), and "one open request per person, kind and target"
 * is the unique `open_key` column: set while a request is raising or open, NULL once it is resolved or its
 * raise failed (D32). `rechecked_at` on an open row is when the sweep last looked at it.
 */

type Row = Record<string, unknown>;

const COLS = 'id, kind, ask_id, tool_id, environment_id, asker_account_id, owner_account_id, request_key, portal_url, target, status';

/** A raise that stopped (the function died) can be taken over after this. */
const LEASE_MINUTES = 2;
/** A resolved row not closed after this is a re-check that stopped part way. */
const UNFINISHED_MINUTES = 5;

export function requestRow(r: Row): RequestRow {
  const t = 'requests';
  return {
    id: id(r.id, t, 'id'),
    kind: oneOf(r.kind, REQUEST_KINDS, t, 'kind'),
    askId: id(r.ask_id, t, 'ask_id'),
    toolId: id(r.tool_id, t, 'tool_id'),
    environmentId: idOrNull(r.environment_id, t, 'environment_id'),
    askerAccountId: text(r.asker_account_id, t, 'asker_account_id'),
    ownerAccountId: text(r.owner_account_id, t, 'owner_account_id'),
    requestKey: textOrNull(r.request_key, t, 'request_key'),
    portalUrl: textOrNull(r.portal_url, t, 'portal_url'),
    target: text(r.target, t, 'target'),
    status: oneOf(r.status, REQUEST_STATUSES, t, 'status'),
  };
}

async function rows(query: string, ...params: unknown[]): Promise<RequestRow[]> {
  const res = await sql.prepare<Row>(query).bindParams(...params).execute();
  return ((res.rows ?? []) as Row[]).map(requestRow);
}

async function first(query: string, ...params: unknown[]): Promise<RequestRow | null> {
  return (await rows(query, ...params))[0] ?? null;
}

async function update(query: string, ...params: unknown[]): Promise<number> {
  const res = await sql.prepare<UpdateQueryResponse>(query).bindParams(...params).execute();
  return res.rows.affectedRows ?? 0;
}

export function isDuplicateKey(e: unknown): boolean {
  const s = e instanceof Error ? `${e.message} ${String((e as { code?: unknown }).code ?? '')}` : String(e);
  return /duplicate entry|ER_DUP_ENTRY|\b1062\b/i.test(s);
}

export const sqlRequestRepo: RequestRepo = {
  async claim(n) {
    let inserted = false;
    try {
      await sql
        .prepare<UpdateQueryResponse>(
          `INSERT INTO requests (kind, ask_id, tool_id, environment_id, asker_account_id, owner_account_id, target, requirement_hash, status, open_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'raising', ?)`,
        )
        .bindParams(n.kind, n.askId, n.toolId, n.environmentId, n.askerAccountId, n.ownerAccountId, n.target, n.requirementHash, n.openKey)
        .execute();
      inserted = true;
    } catch (e) {
      // The open key is taken: someone else holds this request. Anything else is a real failure.
      if (!isDuplicateKey(e)) throw e;
    }
    const row = await first(`SELECT ${COLS} FROM requests WHERE open_key = ?`, n.openKey);
    if (!row) throw new Error('The open request could not be read back; try again');
    return { row, mine: inserted };
  },

  async takeOver(requestId) {
    return (
      (await update(
        `UPDATE requests SET created_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'raising' AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${LEASE_MINUTES} MINUTE)`,
        requestId,
      )) === 1
    );
  },

  async markRaised(requestId, requestKey, portalUrl) {
    await update("UPDATE requests SET request_key = ?, portal_url = ?, status = 'open' WHERE id = ? AND status = 'raising'", requestKey, portalUrl, requestId);
  },

  async release(requestId, error) {
    await update(
      "UPDATE requests SET status = 'failed', open_key = NULL, result = ? WHERE id = ? AND status = 'raising'",
      JSON.stringify({ error: error.slice(0, 300) }),
      requestId,
    );
  },

  async openFor(asker, kind, environmentId, targets) {
    if (targets.length === 0) return [];
    const keys = targets.map((t) => openKey(kind, environmentId, t, asker));
    return rows(`SELECT ${COLS} FROM requests WHERE open_key IN (${keys.map(() => '?').join(', ')})`, ...keys);
  },

  async openByKind(toolId, kind, limit) {
    return rows(
      `SELECT ${COLS} FROM requests WHERE tool_id = ? AND kind = ? AND status = 'open' AND request_key IS NOT NULL ORDER BY id ASC ${limitClause(limit)}`,
      toolId,
      kind,
    );
  },

  async byKey(requestKey) {
    return first(`SELECT ${COLS} FROM requests WHERE request_key = ?`, requestKey);
  },

  async markResolved(requestId) {
    return (await update("UPDATE requests SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, open_key = NULL WHERE id = ? AND status = 'open'", requestId)) === 1;
  },

  async markRechecked(requestId, result) {
    await update("UPDATE requests SET status = 'closed', rechecked_at = CURRENT_TIMESTAMP, result = ? WHERE id = ? AND status = 'resolved'", JSON.stringify(result), requestId);
  },

  async listOpen(limit) {
    return rows(`SELECT ${COLS} FROM requests WHERE status = 'open' AND request_key IS NOT NULL ORDER BY COALESCE(rechecked_at, created_at) ASC, id ASC ${limitClause(limit)}`);
  },

  async listUnfinished(limit) {
    return rows(
      `SELECT ${COLS} FROM requests WHERE status = 'resolved' AND resolved_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${UNFINISHED_MINUTES} MINUTE)
       ORDER BY resolved_at ASC, id ASC ${limitClause(limit)}`,
    );
  },

  async touch(requestId) {
    await update("UPDATE requests SET rechecked_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'", requestId);
  },

  // An open approval request resolved without a decision that counts: resolved_at marks "the asker was told".
  // The row stays open (and keeps its open key), so a later decision is still processed (D34).
  async markUndecided(requestId) {
    return (await update("UPDATE requests SET resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open' AND resolved_at IS NULL", requestId)) === 1;
  },
};

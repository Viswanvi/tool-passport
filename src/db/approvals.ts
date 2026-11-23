import { sql, type UpdateQueryResponse } from '@forge/sql';
import type { ApprovalStore } from '../loop/requests';

/**
 * The `approval_grants` table (spec section 10), one row per approval request (unique `request_key`). Both
 * writes are single upserts, safe to repeat. A decision is recorded once: an approved or declined grant is
 * never changed again by this code.
 */
export const sqlApprovalStore: ApprovalStore = {
  async addPending(g) {
    await sql
      .prepare<UpdateQueryResponse>(
        `INSERT INTO approval_grants (asker_account_id, tool_id, environment_id, action_key, request_key, status)
         VALUES (?, ?, ?, ?, ?, 'pending')
         ON DUPLICATE KEY UPDATE id = id`,
      )
      .bindParams(g.askerAccountId, g.toolId, g.environmentId, g.actionKey, g.requestKey)
      .execute();
  },

  async decide(g) {
    // decided_at is assigned before status: MySQL applies the assignments left to right, so both test the
    // old status.
    await sql
      .prepare<UpdateQueryResponse>(
        `INSERT INTO approval_grants (asker_account_id, tool_id, environment_id, action_key, request_key, status, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           decided_at = IF(status = 'pending', VALUES(decided_at), decided_at),
           status = IF(status = 'pending', VALUES(status), status)`,
      )
      .bindParams(g.askerAccountId, g.toolId, g.environmentId, g.actionKey, g.requestKey, g.status)
      .execute();
  },
};

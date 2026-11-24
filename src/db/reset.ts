import { sql, type UpdateQueryResponse } from '@forge/sql';
import { DEMO_TOOL_NAME } from '../seed/demo-catalog';
import type { ResetStore } from '../setup/reset-demo';
import { id } from './repo';

/**
 * Reset demo's SQL (spec section 16). Only the demo tool, found by its exact name; every statement is scoped to
 * that tool id, directly or through its changes and facts, and deletes children before parents. Each DELETE is
 * safe to repeat (no transactions in Forge SQL, D32). Never touched: `tools`, `audit_log`, `app_settings`.
 */

type Row = Record<string, unknown>;

// Order matters only for readability of a half-done reset: children first, so nothing points at a deleted row.
const CLEAR: Array<[table: string, query: string]> = [
  ['release_labels', 'DELETE FROM release_labels WHERE change_id IN (SELECT id FROM changes WHERE tool_id = ?)'],
  ['recheck_items', 'DELETE FROM recheck_items WHERE change_id IN (SELECT id FROM changes WHERE tool_id = ?)'],
  ['changes', 'DELETE FROM changes WHERE tool_id = ?'],
  ['approval_grants', 'DELETE FROM approval_grants WHERE tool_id = ?'],
  ['requests', 'DELETE FROM requests WHERE tool_id = ?'],
  ['asks', 'DELETE FROM asks WHERE tool_id = ?'],
  ['fact_versions', 'DELETE FROM fact_versions WHERE fact_id IN (SELECT id FROM facts WHERE tool_id = ?)'],
  ['facts', 'DELETE FROM facts WHERE tool_id = ?'],
  ['rules', 'DELETE FROM rules WHERE tool_id = ?'],
  ['readiness_keys', 'DELETE FROM readiness_keys WHERE tool_id = ?'],
  ['access_mappings', 'DELETE FROM access_mappings WHERE tool_id = ?'],
  ['capability_links', 'DELETE FROM capability_links WHERE tool_id = ?'],
  ['catalog_keys', 'DELETE FROM catalog_keys WHERE tool_id = ?'],
  ['translations', 'DELETE FROM translations WHERE tool_id = ?'],
  ['environments', 'DELETE FROM environments WHERE tool_id = ?'],
];

export const sqlResetStore: ResetStore = {
  async demoTool() {
    const tools = await sql.prepare<Row>('SELECT id FROM tools WHERE name = ? LIMIT 1').bindParams(DEMO_TOOL_NAME).execute();
    const row = (tools.rows ?? [])[0] as Row | undefined;
    if (!row) return null;
    const toolId = id(row.id, 'tools', 'id');
    const envs = await sql.prepare<Row>('SELECT provider FROM environments WHERE tool_id = ? LIMIT 1').bindParams(toolId).execute();
    const provider = ((envs.rows ?? [])[0] as Row | undefined)?.provider;
    return { id: toolId, mode: provider === 'registry' ? 'registry' : 'assets' };
  },

  async clearTool(toolId) {
    const deleted: Record<string, number> = {};
    for (const [table, query] of CLEAR) {
      const res = await sql.prepare<UpdateQueryResponse>(query).bindParams(toolId).execute();
      deleted[table] = res.rows.affectedRows ?? 0;
    }
    return deleted;
  },
};

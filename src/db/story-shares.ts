import { sql, type UpdateQueryResponse } from '@forge/sql';
import { sameRequirement, type StoryShareStore } from '../loop/stories';
import { requirementOf } from './asks';
import { id, text } from './repo';
import { limitClause } from './store';

/**
 * The `story_shares` table (v026, D53): which story an ask's answer was posted on, and the verdict it was last told.
 * Holds a work item key and a verdict word, no text from the story. Who asked what comes from the ask the row points
 * to (asks are kept; only their question text is removed after 30 days). Every statement is safe to repeat; the verdict
 * moves by compare-and-set (the old value is in the WHERE clause, which is sound in Forge SQL even though it reports
 * found rows, not changed ones: E7).
 */

type Row = Record<string, unknown>;

export const sqlStoryShares: StoryShareStore = {
  async save(s) {
    await sql
      .prepare<UpdateQueryResponse>(
        `INSERT INTO story_shares (ask_id, tool_id, issue_key, verdict) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE verdict = VALUES(verdict)`,
      )
      .bindParams(s.askId, s.toolId, s.issueKey, s.verdict)
      .execute();
  },

  async related(ask) {
    // The same person, tool and environment in SQL; the same catalog keys in code (JSON is compared by meaning there).
    const where = ask.environmentId === null ? 'a.environment_id IS NULL' : 'a.environment_id = ?';
    const res = await sql
      .prepare<Row>(
        `SELECT s.id, s.issue_key, s.verdict, a.requirement_json FROM story_shares s JOIN asks a ON a.id = s.ask_id
         WHERE a.asker_account_id = ? AND a.tool_id = ? AND ${where} ORDER BY s.id ${limitClause(50)}`,
      )
      .bindParams(...(ask.environmentId === null ? [ask.askerAccountId, ask.toolId] : [ask.askerAccountId, ask.toolId, ask.environmentId]))
      .execute();
    return ((res.rows ?? []) as Row[])
      .filter((r) => sameRequirement(requirementOf(r.requirement_json), ask.requirement))
      .map((r) => ({
        id: id(r.id, 'story_shares', 'id'),
        issueKey: text(r.issue_key, 'story_shares', 'issue_key'),
        verdict: text(r.verdict, 'story_shares', 'verdict'),
      }));
  },

  async askIdsFor(toolId, environmentId, limit) {
    const where = environmentId === null ? '' : ' AND a.environment_id = ?';
    const res = await sql
      .prepare<Row>(
        `SELECT DISTINCT s.ask_id FROM story_shares s JOIN asks a ON a.id = s.ask_id
         WHERE s.tool_id = ?${where} ORDER BY s.ask_id DESC ${limitClause(limit)}`,
      )
      .bindParams(...(environmentId === null ? [toolId] : [toolId, environmentId]))
      .execute();
    return ((res.rows ?? []) as Row[]).map((r) => id(r.ask_id, 'story_shares', 'ask_id'));
  },

  async moveVerdict(shareId, from, to) {
    const res = await sql
      .prepare<UpdateQueryResponse>('UPDATE story_shares SET verdict = ? WHERE id = ? AND verdict = ?')
      .bindParams(to, shareId, from)
      .execute();
    return (res.rows.affectedRows ?? 0) > 0;
  },
};

import { sql, type UpdateQueryResponse } from '@forge/sql';
import type { StoryShareStore } from '../loop/stories';
import { id, text } from './repo';
import { limitClause } from './store';

/**
 * The `story_shares` table (v026, D53): which story an ask's answer was posted on, and the verdict it was last told.
 * Holds a work item key and a verdict word, no text from the story. Every statement is safe to repeat; the verdict
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

  async forAsk(askId) {
    const res = await sql
      .prepare<Row>(`SELECT id, issue_key, verdict FROM story_shares WHERE ask_id = ? ORDER BY id ${limitClause(20)}`)
      .bindParams(askId)
      .execute();
    return ((res.rows ?? []) as Row[]).map((r) => ({
      id: id(r.id, 'story_shares', 'id'),
      issueKey: text(r.issue_key, 'story_shares', 'issue_key'),
      verdict: text(r.verdict, 'story_shares', 'verdict'),
    }));
  },

  async moveVerdict(shareId, from, to) {
    const res = await sql
      .prepare<UpdateQueryResponse>('UPDATE story_shares SET verdict = ? WHERE id = ? AND verdict = ?')
      .bindParams(to, shareId, from)
      .execute();
    return (res.rows.affectedRows ?? 0) > 0;
  },
};

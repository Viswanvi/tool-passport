import { sql, type UpdateQueryResponse } from '@forge/sql';
import type { CatalogChoice } from '../engine/catalog';

/**
 * The `asks` table (spec section 10). Stored about people: account ids, the question (deleted after 30 days,
 * spec section 14), the keys it mapped to, the verdict and the fact versions used. Not stored: the model's
 * own wording, display names or emails.
 */

export interface SavedAsk {
  askerAccountId: string;
  toolId: number;
  environmentId: number | null;
  questionText: string;
  requirement: CatalogChoice[] | null;
  verdict: string;
  factVersionIds: number[];
  modelId: string | null;
}

export async function saveAsk(a: SavedAsk): Promise<number | null> {
  const res = await sql
    .prepare<UpdateQueryResponse>(
      `INSERT INTO asks (asker_account_id, tool_id, environment_id, question_text, requirement_json, verdict, evidence_json, model_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bindParams(
      a.askerAccountId,
      a.toolId,
      a.environmentId,
      a.questionText,
      a.requirement ? JSON.stringify({ requirement: a.requirement }) : null,
      a.verdict,
      JSON.stringify({ factVersionIds: a.factVersionIds }),
      a.modelId,
    )
    .execute();
  const id = res.rows.insertId;
  return typeof id === 'number' && id > 0 ? id : null;
}

/** Spec section 14: question text is deleted after 30 days. Safe to repeat; the sweep runs it. */
export async function purgeOldQuestions(): Promise<number> {
  const res = await sql
    .prepare<UpdateQueryResponse>(
      'UPDATE asks SET question_text = NULL WHERE question_text IS NOT NULL AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)',
    )
    .execute();
  return res.rows.affectedRows ?? 0;
}

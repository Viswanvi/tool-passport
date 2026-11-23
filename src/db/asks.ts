import { sql, type UpdateQueryResponse } from '@forge/sql';
import { z } from 'zod';
import type { CatalogChoice } from '../engine/catalog';
import type { StoredAsk } from '../loop/requests';
import { id, idOrNull, text } from './repo';
import { fromJsonColumn } from './store';

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

const StoredRequirement = z.object({
  requirement: z.array(z.object({ key: z.string().min(1).max(128), value: z.union([z.string(), z.number(), z.boolean()]).optional() })).min(1).max(8),
});

/**
 * An ask for the request loop and Re-check: who asked, where, and the keys. Not the question text. A stored
 * requirement that doesn't read cleanly comes back as null, which re-checks as Don't know yet.
 */
export async function loadAsk(askId: number): Promise<StoredAsk | null> {
  const res = await sql
    .prepare<Record<string, unknown>>('SELECT id, asker_account_id, tool_id, environment_id, requirement_json FROM asks WHERE id = ?')
    .bindParams(askId)
    .execute();
  const r = (res.rows ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const parsed = StoredRequirement.safeParse(fromJsonColumn(r.requirement_json));
  return {
    id: id(r.id, 'asks', 'id'),
    askerAccountId: text(r.asker_account_id, 'asks', 'asker_account_id'),
    toolId: id(r.tool_id, 'asks', 'tool_id'),
    environmentId: idOrNull(r.environment_id, 'asks', 'environment_id'),
    requirement: parsed.success ? parsed.data.requirement : null,
  };
}

/** The newest verdict and evidence after a re-check; the question text is untouched. */
export async function saveAskResult(askId: number, verdict: string, factVersionIds: number[]): Promise<void> {
  await sql
    .prepare<UpdateQueryResponse>('UPDATE asks SET verdict = ?, evidence_json = ? WHERE id = ?')
    .bindParams(verdict, JSON.stringify({ factVersionIds }), askId)
    .execute();
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

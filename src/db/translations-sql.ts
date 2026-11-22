import { sql } from '@forge/sql';
import type { TranslationStore } from '../engine/translate';
import { fromJsonColumn } from './store';

/**
 * Forge SQL store for the translation cache (`translations`, unique on tool, catalog revision and question
 * hash). Rows hold keys, values and the model id only: no question text (spec sections 10 and 14). The
 * insert is safe to repeat; the first translation for a question at a revision is kept.
 */
export const sqlTranslationStore: TranslationStore = {
  async get(k) {
    const res = await sql
      .prepare<{ requirement_json: unknown }>(
        'SELECT requirement_json FROM translations WHERE tool_id = ? AND catalog_revision = ? AND question_hash = ?',
      )
      .bindParams(k.toolId, k.catalogRevision, k.questionHash)
      .execute();
    // Returned unvalidated on purpose: translate() re-checks every cached row against today's catalog.
    return fromJsonColumn<unknown>(res.rows[0]?.requirement_json);
  },

  async put(k, requirement, modelId) {
    await sql
      .prepare(
        `INSERT INTO translations (tool_id, catalog_revision, question_hash, requirement_json, model_id)
         VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
      )
      .bindParams(k.toolId, k.catalogRevision, k.questionHash, JSON.stringify(requirement), modelId)
      .execute();
  },
};

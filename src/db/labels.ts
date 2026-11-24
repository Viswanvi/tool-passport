import { sql, type UpdateQueryResponse } from '@forge/sql';
import type { LabelStore, SavedLabel } from '../change/release-notes';
import { id, oneOf, textOrNull } from './repo';

/**
 * The `release_labels` table (spec section 10, P1; migration v015): one suggestion per (change, fact), unique
 * on that pair. Saving inserts or replaces in one statement, so a new paste of the notes replaces the last
 * labels and a repeat changes nothing. Rows are read strictly: an unknown label is an error, never shown.
 */

type Row = Record<string, unknown>;

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export const sqlLabelStore: LabelStore = {
  async saveLabels(rows) {
    if (rows.length === 0) return;
    await sql
      .prepare<UpdateQueryResponse>(
        `INSERT INTO release_labels (change_id, fact_id, label, quote, model_id) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')} ON DUPLICATE KEY UPDATE label = VALUES(label), quote = VALUES(quote), model_id = VALUES(model_id)`,
      )
      .bindParams(...rows.flatMap((r) => [r.changeId, r.factId, r.label, r.quote, r.modelId]))
      .execute();
  },

  async labelsFor(changeIds) {
    if (changeIds.length === 0) return [];
    const res = await sql
      .prepare<Row>(`SELECT change_id, fact_id, label, quote, model_id FROM release_labels WHERE change_id IN (${placeholders(changeIds.length)})`)
      .bindParams(...changeIds)
      .execute();
    const t = 'release_labels';
    return ((res.rows ?? []) as Row[]).map(
      (r): SavedLabel => ({
        changeId: id(r.change_id, t, 'change_id'),
        factId: id(r.fact_id, t, 'fact_id'),
        label: oneOf(r.label, ['still_true', 'changed', 'removed', 'cant_tell'] as const, t, 'label'),
        quote: textOrNull(r.quote, t, 'quote'),
        modelId: textOrNull(r.model_id, t, 'model_id'),
      }),
    );
  },
};

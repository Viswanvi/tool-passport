/**
 * Catalog types (spec section 10, `catalog_keys`). The catalog is the only vocabulary the model may use;
 * comparisons live here, never in the model's reply. Capability links and the assembled `Catalog` are in
 * `model.ts`.
 *
 * Comparison meaning (evaluate.ts `compare`): `has` needs a stored true; `gte` needs the owner's recorded
 * limit to be at least the asked value; `lte` the reverse; `eq` compares like with like.
 */

export interface CatalogKey {
  key: string;
  kind: 'capability' | 'action' | 'readiness';
  label: string;
  valueType: 'boolean' | 'number' | 'text';
  comparison: 'has' | 'eq' | 'gte' | 'lte';
  requiresValue: boolean;
  /** For keys that need a value: what the number means, shown to the model. */
  unit?: string;
  synonyms: string[];
}

/** A key the model picked, with a value only for keys that need one. */
export interface CatalogChoice {
  key: string;
  value?: number | string | boolean;
}

/** A worked example for the translation prompt (spec section 13, rule 6). */
export interface WorkedExample {
  question: string;
  reply: { capabilities: CatalogChoice[]; unsupported: string | null; restated: string };
}

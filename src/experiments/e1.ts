/**
 * E1 (+ E3): which Assets read path works from Forge, and can the card show where a value came from?
 * Phase 0 only; deleted after the experiments are written up (docs/experiments.md).
 *
 * setup(): creates the fictional "Tool Passport Environments" schema with KS-DEV and KS-PROD
 *          (spec section 16 values). Doubles as the cut-rule-1 check: do Assets writes work?
 * read():  what the Assets provider will do: AQL for the passport objects, map attribute ids to
 *          names, then E3's record time and history for KS-DEV.
 */
import { route } from '@forge/api';
import {
  assets,
  call,
  field,
  keysOf,
  list,
  text,
  workspaceId,
  type Requester,
  type Step,
} from '../providers/assets-api';

export const SCHEMA_NAME = 'Tool Passport Environments';
const SCHEMA_KEY = 'TPENV';
const TYPE_NAME = 'Tool Environment';

// defaultTypeId 0 = Text, 10 = Select (seen in the docs' responses). The Select request fields
// `options` and `maximumCardinality` are not confirmed by the docs; the step result records it.
const ATTRIBUTES: { name: string; body: Record<string, unknown> }[] = [
  { name: 'Tool', body: { name: 'Tool', type: 0, defaultTypeId: 0 } },
  { name: 'Version', body: { name: 'Version', type: 0, defaultTypeId: 0 } },
  {
    name: 'Build environments',
    body: { name: 'Build environments', type: 0, defaultTypeId: 10, options: 'standard,frontend', minimumCardinality: 0, maximumCardinality: -1 },
  },
  {
    name: 'Features enabled',
    body: { name: 'Features enabled', type: 0, defaultTypeId: 10, options: 'uploads,scheduling,single sign-on', minimumCardinality: 0, maximumCardinality: -1 },
  },
];

// Spec section 16, fictional names only.
const OBJECTS: Record<string, string[]>[] = [
  { Name: ['KS-DEV'], Tool: ['Kestrel Studio'], Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': ['uploads', 'scheduling'] },
  { Name: ['KS-PROD'], Tool: ['Kestrel Studio'], Version: ['13.2'], 'Build environments': ['standard', 'frontend'], 'Features enabled': ['uploads', 'scheduling', 'single sign-on'] },
];

export interface SetupResult {
  mode: string;
  ok: boolean;
  steps: Step[];
  ids: { workspaceId?: string; schemaId?: string; typeId?: string };
}

export async function setup(r: Requester): Promise<SetupResult> {
  const steps: Step[] = [];
  const ids: SetupResult['ids'] = {};
  const done = (ok: boolean): SetupResult => ({ mode: r.mode, ok, steps, ids });

  const w = await workspaceId(r, steps);
  if (!w) return done(false);
  ids.workspaceId = w;

  // Schema: reuse if it exists, so setup is safe to repeat.
  const schemas = await call(r, 'list schemas', assets.schemaList(w));
  steps.push(schemas.step);
  if (!schemas.step.ok) return done(false);
  let schemaId = text(field(list(schemas.body, 'values').find((s) => field(s, 'name') === SCHEMA_NAME), 'id'));
  if (!schemaId) {
    const created = await call(r, 'create schema', assets.schemaCreate(w), 'POST', {
      name: SCHEMA_NAME,
      objectSchemaKey: SCHEMA_KEY,
      description: 'Tool Passport environment records (fictional demo data)',
    });
    steps.push(created.step);
    schemaId = text(field(created.body, 'id'));
    if (!schemaId) return done(false);
  } else steps.push({ step: 'schema exists', status: null, ok: true });
  ids.schemaId = schemaId;

  // Object type
  const types = await call(r, 'list object types', assets.typesFlat(w, schemaId));
  steps.push(types.step);
  let typeId = text(field(list(types.body, 'values').find((t) => field(t, 'name') === TYPE_NAME), 'id'));
  if (!typeId) {
    const icons = await call(r, 'list global icons', assets.iconsGlobal(w));
    steps.push(icons.step);
    const iconId = text(field(list(icons.body, 'Icons', 'icons', 'values')[0], 'id'));
    if (!iconId) return done(false);
    const created = await call(r, 'create object type', assets.typeCreate(w), 'POST', {
      name: TYPE_NAME,
      iconId,
      objectSchemaId: schemaId,
      description: 'One environment of a company tool',
    });
    steps.push(created.step);
    typeId = text(field(created.body, 'id'));
    if (!typeId) return done(false);
  } else steps.push({ step: 'object type exists', status: null, ok: true });
  ids.typeId = typeId;

  // Attributes
  let attrs = await attributeIds(r, w, typeId, steps);
  for (const a of ATTRIBUTES) {
    if (attrs.has(a.name)) continue;
    const created = await call(r, `create attribute ${a.name}`, assets.attributeCreate(w, typeId), 'POST', a.body);
    steps.push(created.step);
  }
  attrs = await attributeIds(r, w, typeId, steps);
  const missingAttrs = ['Name', ...ATTRIBUTES.map((a) => a.name)].filter((n) => !attrs.has(n));
  if (missingAttrs.length) {
    steps.push({ step: 'attributes present', status: null, ok: false, note: `missing: ${missingAttrs.join(', ')}` });
    return done(false);
  }

  // Objects: create only the ones not already there.
  const existing = await call(r, 'find existing objects', assets.aql(w), 'POST', {
    qlQuery: `objectSchemaId = ${schemaId} AND objectType = "${TYPE_NAME}"`,
  });
  steps.push(existing.step);
  const labels = new Set(list(existing.body, 'values').map((o) => text(field(o, 'label'))));
  for (const o of OBJECTS) {
    const name = o.Name?.[0] ?? '';
    if (labels.has(name)) {
      steps.push({ step: `object ${name} exists`, status: null, ok: true });
      continue;
    }
    const created = await call(r, `create object ${name}`, assets.objectCreate(w), 'POST', {
      objectTypeId: typeId,
      attributes: Object.entries(o).map(([attr, values]) => ({
        objectTypeAttributeId: attrs.get(attr),
        objectAttributeValues: values.map((value) => ({ value })),
      })),
    });
    steps.push(created.step);
  }
  return done(steps.every((s) => s.ok));
}

async function attributeIds(r: Requester, w: string, typeId: string, steps: Step[]): Promise<Map<string, string>> {
  const res = await call(r, 'list attributes', assets.typeAttributes(w, typeId));
  steps.push(res.step);
  const out = new Map<string, string>();
  for (const a of list(res.body, 'values')) {
    const name = text(field(a, 'name'));
    const id = text(field(a, 'id'));
    if (name && id) out.set(name, id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

export interface EnvironmentSummary {
  label: string;
  objectId: string;
  /** Attribute name -> values, for every attribute the AQL reply included. */
  returned: Record<string, string[]>;
  /** Defined on the object type but absent from the reply: the provider must report these as empty, not absent. */
  definedButNotReturned: string[];
}

export interface ReadResult {
  mode: string;
  ok: boolean;
  steps: Step[];
  environments: EnvironmentSummary[];
  /** Top-level keys of the AQL reply, recorded because the POST /object/aql shape is unconfirmed. */
  aqlReplyKeys: string[];
  /** E3: record provenance for KS-DEV. No names or emails are kept, only which fields exist. */
  provenance?: { created?: string; updated?: string; historyEntries: number; historyEntryKeys: string[]; historyHasActor: boolean };
}

export async function read(r: Requester): Promise<ReadResult> {
  const steps: Step[] = [];
  const result: ReadResult = { mode: r.mode, ok: false, steps, environments: [], aqlReplyKeys: [] };

  const w = await workspaceId(r, steps);
  if (!w) return result;

  // What the provider will run: no schema listing (an ordinary employee may not be allowed it).
  const aql = await call(r, 'AQL passport objects', assets.aql(w), 'POST', {
    qlQuery: `objectSchema = "${SCHEMA_NAME}" AND objectType = "${TYPE_NAME}"`,
  });
  steps.push(aql.step);
  result.aqlReplyKeys = keysOf(aql.body);
  if (!aql.step.ok) return result;
  const objects = list(aql.body, 'values', 'objectEntries');
  if (objects.length === 0) {
    steps.push({ step: 'objects found', status: null, ok: false, note: 'AQL returned no passport objects' });
    return result;
  }

  // Attribute id -> name: from the reply if it carries them, else from the object type.
  const names = new Map<string, string>();
  for (const a of list(aql.body, 'objectTypeAttributes')) {
    const id = text(field(a, 'id'));
    const name = text(field(a, 'name'));
    if (id && name) names.set(id, name);
  }
  const typeId = text(field(field(objects[0], 'objectType'), 'id'));
  if (names.size === 0 && typeId) {
    const attrs = await call(r, 'list attributes', assets.typeAttributes(w, typeId));
    steps.push(attrs.step);
    for (const a of list(attrs.body, 'values')) {
      const id = text(field(a, 'id'));
      const name = text(field(a, 'name'));
      if (id && name) names.set(id, name);
    }
  }

  for (const o of objects) {
    const returned: Record<string, string[]> = {};
    for (const a of list(field(o, 'attributes'))) {
      const name = names.get(text(field(a, 'objectTypeAttributeId')) ?? '') ?? `#${text(field(a, 'objectTypeAttributeId'))}`;
      returned[name] = list(field(a, 'objectAttributeValues')).map((v) => text(field(v, 'value')) ?? text(field(v, 'displayValue')) ?? '');
    }
    result.environments.push({
      label: text(field(o, 'label')) ?? '?',
      objectId: text(field(o, 'id')) ?? '?',
      returned,
      definedButNotReturned: [...names.values()].filter((n) => !(n in returned)),
    });
  }

  // E3: record time and history for KS-DEV.
  const dev = result.environments.find((e) => e.label === 'KS-DEV');
  if (dev) {
    const obj = await call(r, 'get KS-DEV object', assets.object(w, dev.objectId));
    steps.push(obj.step);
    const hist = await call(r, 'get KS-DEV history', assets.objectHistory(w, dev.objectId));
    steps.push(hist.step);
    const entries = list(hist.body, 'values');
    result.provenance = {
      created: text(field(obj.body, 'created')),
      updated: text(field(obj.body, 'updated')),
      historyEntries: entries.length,
      historyEntryKeys: keysOf(entries[0]),
      historyHasActor: entries.some((e) => field(e, 'actor') !== undefined),
    };
  }

  result.ok = steps.every((s) => s.ok) && result.environments.length > 0;
  return result;
}

/** One-line summary for the run log and `forge logs`. */
export function summarise(kind: 'setup' | 'read', res: SetupResult | ReadResult): string {
  const failed = res.steps.find((s) => !s.ok);
  if (res.ok) {
    if (kind === 'read') {
      const r = res as ReadResult;
      return `ok: ${r.environments.map((e) => `${e.label} v${e.returned['Version']?.[0] ?? '?'}`).join(', ')}`;
    }
    return 'ok: schema, type, attributes and objects in place';
  }
  return failed ? `failed at "${failed.step}" (${failed.status ?? 'no status'}) ${failed.note ?? ''}`.trim() : 'failed';
}

/** Is the caller a Jira administrator? Used to gate Assets writes (spec section 14). */
export async function callerIsJiraAdmin(r: Requester): Promise<boolean> {
  const res = await call(r, 'my permissions', route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  return field(field(field(res.body, 'permissions'), 'ADMINISTER'), 'havePermission') === true;
}

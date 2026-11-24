/**
 * The demo's Assets records (spec section 16, judge path step 2: "Load demo data … creates … the Assets schema
 * and objects"). Finds or creates, in order: the "Tool Passport Environments" schema, the "Tool Environment"
 * type, its attributes, and the KS-DEV and KS-PROD objects with the section 16 values. Only what is missing is
 * created, so it is safe to repeat. Reads go as the app (D25). Writes go as the app first (a fresh developer
 * site allowed it, E2) and as the signed-in admin only when the app is refused (the demo site refused it, E1).
 * A consent request from the admin's side is passed up so Forge can show its consent screen.
 *
 * Calls and bodies are the ones E1/E2 ran (201 for every step on the fresh site). Assets writes live only here
 * and in seed/ (spec section 14). No Forge imports: the clients are passed in.
 */

export interface Reply {
  status: number | null;
  body: unknown;
  note?: string;
}

export interface AssetsSetupClient {
  workspace(): Promise<Reply>;
  listSchemas(w: string): Promise<Reply>;
  createSchema(w: string, body: unknown): Promise<Reply>;
  listTypes(w: string, schemaId: string): Promise<Reply>;
  globalIcons(w: string): Promise<Reply>;
  createType(w: string, body: unknown): Promise<Reply>;
  typeAttributes(w: string, typeId: string): Promise<Reply>;
  createAttribute(w: string, typeId: string, body: unknown): Promise<Reply>;
  findObjects(w: string, qlQuery: string): Promise<Reply>;
  createObject(w: string, body: unknown): Promise<Reply>;
  /** PUT /object/{id}: Reset demo puts the section 16 values back. */
  updateObject(w: string, id: string, body: unknown): Promise<Reply>;
}

export type EnvName = 'KS-DEV' | 'KS-PROD';

export type RecordsResult =
  | { ok: true; keys: Record<EnvName, string>; created: string[]; as: 'app' | 'user' }
  | { ok: false; reason: string };

export const SCHEMA_NAME = 'Tool Passport Environments';
const SCHEMA_KEY = 'TPENV';
export const TYPE_NAME = 'Tool Environment';

// defaultTypeId 0 = Text, 10 = Select; the Select fields as E1 sent them (accepted, 201).
const ATTRIBUTES: Array<{ name: string; body: Record<string, unknown> }> = [
  { name: 'Tool', body: { name: 'Tool', type: 0, defaultTypeId: 0 } },
  { name: 'Version', body: { name: 'Version', type: 0, defaultTypeId: 0 } },
  { name: 'Build environments', body: { name: 'Build environments', type: 0, defaultTypeId: 10, options: 'standard,frontend', minimumCardinality: 0, maximumCardinality: -1 } },
  {
    name: 'Features enabled',
    body: { name: 'Features enabled', type: 0, defaultTypeId: 10, options: 'uploads,scheduling,single sign-on', minimumCardinality: 0, maximumCardinality: -1 },
  },
];

/** Spec section 16, fictional names only. */
export const DEMO_RECORDS: Array<Record<string, string[]> & { Name: [EnvName] }> = [
  { Name: ['KS-DEV'], Tool: ['Kestrel Studio'], Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': ['uploads', 'scheduling'] },
  { Name: ['KS-PROD'], Tool: ['Kestrel Studio'], Version: ['13.2'], 'Build environments': ['standard', 'frontend'], 'Features enabled': ['uploads', 'scheduling', 'single sign-on'] },
];

const field = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);
const list = (o: unknown, ...keys: string[]): unknown[] => {
  if (Array.isArray(o)) return o;
  for (const k of keys) {
    const v = field(o, k);
    if (Array.isArray(v)) return v;
  }
  return [];
};
const ok = (r: Reply) => r.status !== null && r.status >= 200 && r.status < 300;
const refused = (r: Reply) => r.status === 401 || r.status === 403;

class SetupStop extends Error {}

export async function ensureDemoRecords(app: AssetsSetupClient, user?: AssetsSetupClient): Promise<RecordsResult> {
  const r = await withRecords(app, user, async () => undefined);
  return r.ok ? { ok: true, keys: r.keys, created: r.created, as: r.as } : r;
}

/**
 * Reset demo: make sure the records exist, then put the section 16 values back on both (one update each, safe
 * to repeat), so a demo that moved KS-DEV to 14.0 starts from 13.2 again.
 */
export async function resetDemoRecords(app: AssetsSetupClient, user?: AssetsSetupClient): Promise<RecordsResult> {
  const r = await withRecords(app, user, async ({ w, typeId, attrs, objectIds, write }) => {
    for (const record of DEMO_RECORDS) {
      const name = record.Name[0];
      await write(`update ${name}`, `values of ${name}`, (c) =>
        c.updateObject(w, objectIds[name], {
          objectTypeId: typeId,
          attributes: Object.entries(record).map(([attr, values]) => ({ objectTypeAttributeId: attrs.get(attr), objectAttributeValues: values.map((value) => ({ value })) })),
        }),
      );
    }
  });
  return r.ok ? { ok: true, keys: r.keys, created: r.created.filter((c) => !c.startsWith('values of ')), as: r.as } : r;
}

type Write = (step: string, label: string, f: (c: AssetsSetupClient) => Promise<Reply>) => Promise<Reply>;
interface Found {
  w: string;
  typeId: string;
  attrs: Map<string, string>;
  objectIds: Record<EnvName, string>;
  write: Write;
}

async function withRecords(
  app: AssetsSetupClient,
  user: AssetsSetupClient | undefined,
  then: (found: Found) => Promise<void>,
): Promise<{ ok: true; keys: Record<EnvName, string>; created: string[]; as: 'app' | 'user' } | { ok: false; reason: string }> {
  const created: string[] = [];
  let as: 'app' | 'user' = 'app';
  const stop = (step: string, r: Reply): never => {
    throw new SetupStop(`Assets ${step}: ${r.status ?? 'no reply'} ${r.note ?? ''}`.trim());
  };
  const read = async (step: string, f: (c: AssetsSetupClient) => Promise<Reply>) => {
    const r = await f(app);
    return ok(r) ? r : stop(step, r);
  };
  // As the app; once the app has been refused, the admin does the rest of the writes.
  const write: Write = async (step, label, f) => {
    let r = as === 'app' ? await f(app) : await f(user!);
    if (as === 'app' && refused(r) && user) {
      r = await f(user);
      if (ok(r)) as = 'user';
    }
    if (!ok(r)) stop(step, r);
    created.push(label);
    return r;
  };

  try {
    const ws = await app.workspace();
    const w = ok(ws) ? text(field(list(ws.body, 'values')[0], 'workspaceId')) : undefined;
    if (!w) return { ok: false, reason: 'no_assets' };

    const schemas = await read('list schemas', (c) => c.listSchemas(w));
    let schemaId = text(field(list(schemas.body, 'values').find((s) => field(s, 'name') === SCHEMA_NAME), 'id'));
    if (!schemaId) {
      const r = await write('create schema', 'schema', (c) => c.createSchema(w, { name: SCHEMA_NAME, objectSchemaKey: SCHEMA_KEY, description: 'Tool Passport environment records (fictional demo data)' }));
      schemaId = text(field(r.body, 'id'));
      if (!schemaId) stop('create schema', { status: null, body: null, note: 'the reply had no id' });
    }

    const types = await read('list object types', (c) => c.listTypes(w, schemaId!));
    let typeId = text(field(list(types.body, 'values').find((t) => field(t, 'name') === TYPE_NAME), 'id'));
    if (!typeId) {
      const icons = await read('list icons', (c) => c.globalIcons(w));
      const iconId = text(field(list(icons.body, 'Icons', 'icons', 'values')[0], 'id'));
      if (!iconId) stop('list icons', { status: null, body: null, note: 'no icon to use' });
      const r = await write('create object type', 'object type', (c) => c.createType(w, { name: TYPE_NAME, iconId, objectSchemaId: schemaId, description: 'One environment of a company tool' }));
      typeId = text(field(r.body, 'id'));
      if (!typeId) stop('create object type', { status: null, body: null, note: 'the reply had no id' });
    }

    const attributeIds = async () => {
      const r = await read('list attributes', (c) => c.typeAttributes(w, typeId!));
      const out = new Map<string, string>();
      for (const a of list(r.body, 'values')) {
        const name = text(field(a, 'name'));
        const id = text(field(a, 'id'));
        if (name && id) out.set(name, id);
      }
      return out;
    };
    let attrs = await attributeIds();
    for (const a of ATTRIBUTES) {
      if (!attrs.has(a.name)) await write(`create attribute ${a.name}`, a.name, (c) => c.createAttribute(w, typeId!, a.body));
    }
    attrs = await attributeIds();
    const missing = ['Name', ...ATTRIBUTES.map((a) => a.name)].filter((n) => !attrs.has(n));
    if (missing.length) stop('attributes', { status: null, body: null, note: `missing: ${missing.join(', ')}` });

    const query = `objectSchemaId = ${schemaId} AND objectType = "${TYPE_NAME}"`;
    const objects = async () => list((await read('find objects', (c) => c.findObjects(w, query))).body, 'values');
    const labels = new Set((await objects()).map((o) => text(field(o, 'label'))));
    for (const record of DEMO_RECORDS) {
      const name = record.Name[0];
      if (labels.has(name)) continue;
      await write(`create object ${name}`, name, (c) =>
        c.createObject(w, {
          objectTypeId: typeId,
          attributes: Object.entries(record).map(([attr, values]) => ({ objectTypeAttributeId: attrs.get(attr), objectAttributeValues: values.map((value) => ({ value })) })),
        }),
      );
    }

    // The keys as Assets has them now: exactly one object per name, or the demo can't link to it.
    const now = await objects();
    const keys = {} as Record<EnvName, string>;
    const objectIds = {} as Record<EnvName, string>;
    for (const record of DEMO_RECORDS) {
      const name = record.Name[0];
      const found = now.filter((o) => text(field(o, 'label')) === name);
      const key = found.length === 1 ? text(field(found[0], 'objectKey')) : undefined;
      if (!key) return { ok: false, reason: `Assets has ${found.length} objects named ${name} in ${SCHEMA_NAME}; it needs exactly one` };
      keys[name] = key;
      objectIds[name] = text(field(found[0], 'id')) ?? key;
    }
    await then({ w, typeId: typeId!, attrs, objectIds, write });
    return { ok: true, keys, created, as };
  } catch (e) {
    if (e instanceof SetupStop) return { ok: false, reason: e.message };
    throw e; // a consent request (or anything unexpected) goes up to Forge
  }
}

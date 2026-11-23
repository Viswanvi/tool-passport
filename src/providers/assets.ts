import type { Environment, EnvRead } from '../engine/model';

/**
 * The Assets provider (spec sections 10, 11 and 14; D25: read as the app). Reads one object of the passport
 * schema by its key with AQL and returns only the mapped attributes (those named in `readiness_keys`) plus
 * Version, because the app context ignores the asker's own Assets permissions.
 *
 * Provider contract: `values` holds every requested attribute the object type defines, with an empty list
 * when the object has no value, and leaves out attributes the type doesn't define. Whether an attribute is
 * defined comes from the type's attribute list, never from which values happen to come back, so the answer
 * doesn't depend on whether AQL omits empty attributes (still unconfirmed, docs/experiments.md E1).
 *
 * No Forge imports: the HTTP calls are passed in (`providers/forge.ts` wires them as the app).
 */

export interface HttpReply {
  status: number;
  body: unknown;
}

export interface AssetsClient {
  /** The site's Assets workspace id, or null when the site has none. Throws when it can't be looked up. */
  workspace(): Promise<string | null>;
  /** POST …/object/aql?includeAttributes=true with this query. Throws on a network failure. */
  aql(workspaceId: string, qlQuery: string): Promise<HttpReply>;
  /** GET …/objecttype/{id}/attributes. */
  typeAttributes(workspaceId: string, objectTypeId: string): Promise<HttpReply>;
}

export interface AssetsDeps {
  client: AssetsClient;
  /** Attribute names the tool's readiness keys use. */
  mappedAttributes(toolId: number): Promise<string[]>;
  schemaName: string;
  typeName: string;
  now(): string;
}

export const VERSION_ATTRIBUTE = 'Version';

/** Object keys look like TPENV-4679; anything else never reaches the query. */
const OBJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}-\d{1,12}$/;

/** An AQL string literal, quotes and backslashes escaped. */
export const aqlString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const quote = aqlString;

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function failure(reason: 'unreachable' | 'not_found' | 'forbidden', detail: string): EnvRead {
  return { ok: false, reason, detail: detail.slice(0, 200) };
}

function fromStatus(step: string, status: number): EnvRead {
  if (status === 401 || status === 403) return failure('forbidden', `${step}: ${status}`);
  if (status === 400 || status === 404) return failure('not_found', `${step}: ${status}`);
  return failure('unreachable', `${step}: ${status}`);
}

/** id → name from a list of attribute definitions ({ id, name }). */
function definitions(list: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of arr(list)) {
    const id = str(obj(d)?.id);
    const name = str(obj(d)?.name);
    if (id && name) out.set(id, name);
  }
  return out;
}

/** An object's values by attribute id. Blank values are no value. */
function valuesById(object: Record<string, unknown>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of arr(object.attributes)) {
    const id = str(obj(a)?.objectTypeAttributeId);
    if (!id) continue;
    const values = arr(obj(a)?.objectAttributeValues)
      .map((v) => str(obj(v)?.value) ?? str(obj(v)?.displayValue) ?? '')
      .map((v) => v.trim())
      .filter((v) => v !== '');
    out.set(id, values);
  }
  return out;
}

const findName = (defs: Map<string, string>, wanted: string): string | undefined => {
  for (const [id, name] of defs) if (name === wanted) return id;
  const lower = wanted.trim().toLowerCase();
  for (const [id, name] of defs) if (name.trim().toLowerCase() === lower) return id;
  return undefined;
};

export async function readAssets(environment: Environment, deps: AssetsDeps): Promise<EnvRead> {
  const key = environment.providerRef?.trim() ?? '';
  if (!OBJECT_KEY.test(key)) return failure('not_found', 'The environment has no Assets object key');

  let workspace: string | null;
  try {
    workspace = await deps.client.workspace();
  } catch (e) {
    return failure('unreachable', `workspace lookup: ${String(e)}`);
  }
  if (!workspace) return failure('not_found', 'This site has no Assets workspace');

  const qlQuery = `objectSchema = ${quote(deps.schemaName)} AND objectType = ${quote(deps.typeName)} AND Key = ${quote(key)}`;
  let reply: HttpReply;
  try {
    reply = await deps.client.aql(workspace, qlQuery);
  } catch (e) {
    return failure('unreachable', `AQL: ${String(e)}`);
  }
  if (reply.status !== 200) return fromStatus('AQL', reply.status);
  const body = obj(reply.body);
  if (!body) return failure('unreachable', 'AQL reply was not an object');
  const objects = arr(body.values);
  // Key is unique, so anything but exactly one object of this key is not this environment's record.
  const object = objects.length === 1 ? obj(objects[0]) : null;
  if (!object || str(object.objectKey) !== key) return failure('not_found', `No single passport object with key ${key}`);

  const wanted = [VERSION_ATTRIBUTE, ...(await deps.mappedAttributes(environment.toolId)).filter((a) => a !== VERSION_ATTRIBUTE)];
  let defs = definitions(body.objectTypeAttributes);
  const typeId = str(obj(object.objectType)?.id);
  if (typeId && wanted.some((w) => findName(defs, w) === undefined)) {
    // The reply's list may not name every attribute of the type; ask the type itself before calling one absent.
    try {
      const res = await deps.client.typeAttributes(workspace, typeId);
      if (res.status === 200) {
        const listed = Array.isArray(res.body) ? res.body : arr(obj(res.body)?.values);
        defs = new Map([...defs, ...definitions(listed)]);
      }
    } catch {
      // Can't tell: the attribute stays absent, which is Not verified, never "empty".
    }
  }

  const byId = valuesById(object);
  const values: Record<string, string[]> = {};
  for (const name of wanted) {
    const id = findName(defs, name);
    if (id !== undefined) values[name] = byId.get(id) ?? [];
  }

  const updatedAttr = findName(defs, 'Updated');
  const recordUpdatedAt = str(object.updated) ?? (updatedAttr ? byId.get(updatedAttr)?.[0] ?? null : null);
  return {
    ok: true,
    source: 'assets',
    values,
    version: values[VERSION_ATTRIBUTE]?.[0] ?? null,
    readAt: deps.now(),
    recordUpdatedAt,
  };
}

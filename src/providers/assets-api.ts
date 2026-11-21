import api, { route, type APIResponse, type Route } from '@forge/api';

/**
 * Thin Assets REST client for the Assets provider (Phase 1) and the setup wizard / demo seed (Phase 4).
 *   app  - api.asApp(): every read (DECISIONS D25: works for employees with no Assets role, in resolvers,
 *          triggers and the sweep; E1, E2, E10)
 *   user - api.asUser(): the signed-in admin, for setup writes where the app account is refused (the demo
 *          site returned 403 to the app on schema create; a fresh site didn't, E2)
 * Impersonation was tested in E1 and dropped: it carries the user's own Assets permissions (403 for Sam).
 */
export type Mode = 'app' | 'user';

interface Init {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export interface Requester {
  mode: Mode;
  request: (path: Route, init?: Init) => Promise<APIResponse>;
}

export function requester(mode: Mode): Requester {
  if (mode === 'app') return { mode, request: (p, i) => api.asApp().requestJira(p, i) };
  return { mode, request: (p, i) => api.asUser().requestJira(p, i) };
}

export interface Step {
  step: string;
  status: number | null;
  ok: boolean;
  note?: string;
}

export interface CallResult {
  step: Step;
  body: unknown;
}

/**
 * One HTTP call, never throwing: a failure becomes a recorded step. Known issue for Phase 1 (E6): in user
 * context, NEEDS_AUTHENTICATION_ERR must propagate so Forge shows the consent screen; don't use this there.
 */
export async function call(r: Requester, step: string, path: Route, method = 'GET', payload?: unknown): Promise<CallResult> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const res = await r.request(path, {
      method,
      headers,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { step: { step, status: res.status, ok: res.ok, note: res.ok ? undefined : errorNote(body) }, body };
  } catch (e) {
    return { step: { step, status: null, ok: false, note: `threw: ${String(e).slice(0, 200)}` }, body: null };
  }
}

function errorNote(body: unknown): string {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return (raw ?? '').slice(0, 300);
}

// ---- helpers for response shapes (real shapes recorded in docs/experiments.md E1 and E3) ----

export const field = (o: unknown, k: string): unknown =>
  o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;

export function list(o: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(o)) return o;
  for (const k of keys) {
    const v = field(o, k);
    if (Array.isArray(v)) return v;
  }
  return [];
}

export const text = (v: unknown): string | undefined =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;

export const keysOf = (o: unknown): string[] => (o !== null && typeof o === 'object' ? Object.keys(o) : []);

// ---- endpoints (paths from developer.atlassian.com/cloud/assets and the JSM workspace API) ----

export async function workspaceId(r: Requester, steps: Step[]): Promise<string | null> {
  const res = await call(r, 'workspace lookup', route`/rest/servicedeskapi/assets/workspace`);
  steps.push(res.step);
  return text(field(list(res.body, 'values')[0], 'workspaceId')) ?? null;
}

export const assets = {
  schemaList: (w: string) => route`/jsm/assets/workspace/${w}/v1/objectschema/list?maxResults=200`,
  schemaCreate: (w: string) => route`/jsm/assets/workspace/${w}/v1/objectschema/create`,
  typesFlat: (w: string, schemaId: string) => route`/jsm/assets/workspace/${w}/v1/objectschema/${schemaId}/objecttypes/flat`,
  iconsGlobal: (w: string) => route`/jsm/assets/workspace/${w}/v1/icon/global`,
  typeCreate: (w: string) => route`/jsm/assets/workspace/${w}/v1/objecttype/create`,
  typeAttributes: (w: string, typeId: string) => route`/jsm/assets/workspace/${w}/v1/objecttype/${typeId}/attributes`,
  attributeCreate: (w: string, typeId: string) => route`/jsm/assets/workspace/${w}/v1/objecttypeattribute/${typeId}`,
  objectCreate: (w: string) => route`/jsm/assets/workspace/${w}/v1/object/create`,
  object: (w: string, id: string) => route`/jsm/assets/workspace/${w}/v1/object/${id}`,
  objectHistory: (w: string, id: string) => route`/jsm/assets/workspace/${w}/v1/object/${id}/history`,
  aql: (w: string) => route`/jsm/assets/workspace/${w}/v1/object/aql?includeAttributes=true&maxResults=25`,
};

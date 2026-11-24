import { route, type Route } from '@forge/api';
import { assets, requester, type Mode } from '../providers/assets-api';
import type { AssetsSetupClient, Reply } from './assets-records';

/**
 * Forge wiring for the setup writes (spec section 14: Assets writes only in setup/ and seed/, behind the
 * administrator check in the resolver). Unlike providers/assets-api `call`, a consent request from a
 * user-context call is thrown, not recorded, so Forge can show the admin its consent screen (E1 lesson).
 */

const needsConsent = (e: unknown) =>
  e !== null && typeof e === 'object' && [(e as { name?: unknown }).name, (e as { message?: unknown }).message].some((v) => typeof v === 'string' && v.includes('NEEDS_AUTHENTICATION_ERR'));

async function send(mode: Mode, path: Route, method = 'GET', payload?: unknown): Promise<Reply> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const res = await requester(mode).request(path, { method, headers, body: payload !== undefined ? JSON.stringify(payload) : undefined });
    const raw = await res.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    return { status: res.status, body, note: res.ok ? undefined : raw.slice(0, 300) };
  } catch (e) {
    if (needsConsent(e)) throw e;
    return { status: null, body: null, note: `threw: ${String(e).slice(0, 200)}` };
  }
}

export function forgeSetupClient(mode: Mode): AssetsSetupClient {
  return {
    workspace: () => send(mode, route`/rest/servicedeskapi/assets/workspace`),
    listSchemas: (w) => send(mode, assets.schemaList(w)),
    createSchema: (w, body) => send(mode, assets.schemaCreate(w), 'POST', body),
    listTypes: (w, schemaId) => send(mode, assets.typesFlat(w, schemaId)),
    globalIcons: (w) => send(mode, assets.iconsGlobal(w)),
    createType: (w, body) => send(mode, assets.typeCreate(w), 'POST', body),
    typeAttributes: (w, typeId) => send(mode, assets.typeAttributes(w, typeId)),
    createAttribute: (w, typeId, body) => send(mode, assets.attributeCreate(w, typeId), 'POST', body),
    findObjects: (w, qlQuery) => send(mode, assets.aql(w), 'POST', { qlQuery }),
    createObject: (w, body) => send(mode, assets.objectCreate(w), 'POST', body),
  };
}

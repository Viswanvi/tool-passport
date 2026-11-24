import { route } from '@forge/api';
import { mappedAttributes } from '../db/repo';
import { getSetting, setSetting } from '../db/store';
import type { EnvironmentReader, Groups } from '../engine/model';
import { readAssets, type AssetsClient, type HttpReply } from './assets';
import { assets, call, field, list, requester, text } from './assets-api';
import { parseGroups } from './groups';
import { environmentReader } from './index';
import { readRegistry } from './registry';

/**
 * Forge wiring for the providers. Every read is as the app (D25): it works for employees with no Assets
 * role, in resolvers, triggers and the sweep (E1, E2, E6, E10). Read-only: no Assets write here (spec
 * section 14: writes only in setup/ and seed/).
 */

const app = requester('app');

/** Spec section 10 names; the setup wizard (Phase 4) may store others. */
export const DEFAULT_SCHEMA = { schemaName: 'Tool Passport Environments', typeName: 'Tool Environment' };
const WORKSPACE_SETTING = 'assets.workspaceId';
const SCHEMA_SETTING = 'assets.schema';

async function http(step: string, path: Parameters<typeof call>[2], method = 'GET', payload?: unknown): Promise<HttpReply> {
  const res = await call(app, step, path, method, payload);
  // call() never throws; a null status means the request itself failed, which the provider reads as unreachable.
  if (res.step.status === null) throw new Error(res.step.note ?? `${step} failed`);
  return { status: res.step.status, body: res.body };
}

export const forgeAssetsClient: AssetsClient = {
  async workspace() {
    // Stored as { id } (an object, see store.ts); a bare string from 4.9.0 is read too.
    const stored = await getSetting<unknown>(WORKSPACE_SETTING);
    const known = typeof stored === 'string' ? stored : text(field(stored, 'id'));
    if (known) return known;
    const res = await http('workspace lookup', route`/rest/servicedeskapi/assets/workspace`);
    if (res.status === 401 || res.status === 403 || res.status === 404) return null;
    if (res.status !== 200) throw new Error(`workspace lookup: ${res.status}`);
    const id = text(field(list(res.body, 'values')[0], 'workspaceId')) ?? null;
    if (id) await setSetting(WORKSPACE_SETTING, { id }); // the workspace id doesn't change; save a call per read
    return id;
  },
  aql: (workspaceId, qlQuery) => http('AQL', assets.aql(workspaceId), 'POST', { qlQuery }),
  typeAttributes: (workspaceId, typeId) => http('type attributes', assets.typeAttributes(workspaceId, typeId)),
};

async function schemaNames(): Promise<{ schemaName: string; typeName: string }> {
  const s = await getSetting<{ schemaName?: unknown; typeName?: unknown }>(SCHEMA_SETTING);
  return {
    schemaName: typeof s?.schemaName === 'string' && s.schemaName ? s.schemaName : DEFAULT_SCHEMA.schemaName,
    typeName: typeof s?.typeName === 'string' && s.typeName ? s.typeName : DEFAULT_SCHEMA.typeName,
  };
}

const now = () => new Date().toISOString();

export function forgeEnvironmentReader(): EnvironmentReader {
  return environmentReader({
    assets: async (e) => readAssets(e, { client: forgeAssetsClient, mappedAttributes, ...(await schemaNames()), now }),
    registry: (e) => readRegistry(e, { mappedAttributes, now }),
  });
}

/** The account id comes from the Forge context or a stored ask, never from a request payload (CLAUDE.md rule 3). */
export async function readGroups(accountId: string): Promise<Groups> {
  try {
    const res = await http('groups', route`/rest/api/3/user/groups?accountId=${accountId}`);
    return parseGroups(res.status, res.body);
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 200) };
  }
}

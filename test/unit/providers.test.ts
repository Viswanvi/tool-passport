import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '../../src/engine/model';
import { readAssets, type AssetsClient, type HttpReply } from '../../src/providers/assets';
import { parseGroups } from '../../src/providers/groups';
import { environmentReader } from '../../src/providers/index';
import { readRegistry } from '../../src/providers/registry';

/**
 * Providers (spec section 11 provider contract; section 14 "reads return only mapped attributes of objects
 * in the passport schema"). Reply shapes follow what E1, E3 and E6 recorded from the real APIs.
 */

const NOW = '2026-11-24T14:02:00.000Z';
const env = (over: Partial<Environment> = {}): Environment => ({
  id: 11,
  toolId: 1,
  name: 'KS-DEV',
  provider: 'assets',
  providerRef: 'TPENV-4679',
  ownerAccountId: 'acct-marco',
  audienceGroup: null,
  lastSeenVersion: '13.2',
  lastSeenAt: null,
  recordedValues: null,
  ...over,
});

// The type's attributes, as the AQL reply's `objectTypeAttributes` lists them (E1: id → name map).
const TYPE_ATTRS = [
  { id: '1', name: 'Key' },
  { id: '2', name: 'Name' },
  { id: '3', name: 'Tool' },
  { id: '4', name: 'Version' },
  { id: '5', name: 'Build environments' },
  { id: '6', name: 'Features enabled' },
  { id: '7', name: 'Owner' },
  { id: '8', name: 'Updated' },
];
const attr = (id: string, ...values: string[]) => ({ objectTypeAttributeId: id, objectAttributeValues: values.map((value) => ({ value, displayValue: value })) });
function aqlReply(attributes = [attr('1', 'TPENV-4679'), attr('2', 'KS-DEV'), attr('3', 'Kestrel Studio'), attr('4', '13.2'), attr('5', 'standard'), attr('6', 'uploads', 'scheduling'), attr('7', 'acct-marco')], typeAttrs = TYPE_ATTRS) {
  return {
    values: [{ id: '4679', objectKey: 'TPENV-4679', label: 'KS-DEV', objectType: { id: '147', name: 'Tool Environment' }, updated: '2026-11-03T10:00:00.000Z', attributes }],
    objectTypeAttributes: typeAttrs,
    total: 1,
  };
}

function client(aql: HttpReply | (() => never), over: Partial<AssetsClient> = {}): AssetsClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    workspace: async () => 'ws-1',
    aql: async (_w, q) => {
      queries.push(q);
      if (typeof aql === 'function') return aql();
      return aql;
    },
    typeAttributes: async () => ({ status: 200, body: TYPE_ATTRS }),
    ...over,
  };
}

const MAPPED = ['Build environments', 'Features enabled'];
const read = (c: AssetsClient, e = env(), mapped = MAPPED) =>
  readAssets(e, { client: c, mappedAttributes: async () => mapped, schemaName: 'Tool Passport Environments', typeName: 'Tool Environment', now: () => NOW });

describe('Assets provider', () => {
  it('reads one object of the passport schema by key, as the AQL query says', async () => {
    const c = client({ status: 200, body: aqlReply() });
    const r = await read(c);
    expect(c.queries).toEqual(['objectSchema = "Tool Passport Environments" AND objectType = "Tool Environment" AND Key = "TPENV-4679"']);
    expect(r).toEqual({
      ok: true,
      source: 'assets',
      version: '13.2',
      readAt: NOW,
      recordUpdatedAt: '2026-11-03T10:00:00.000Z',
      values: { Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': ['uploads', 'scheduling'] },
    });
  });

  it('returns only mapped attributes plus Version, never the rest of the record', async () => {
    const r = await read(client({ status: 200, body: aqlReply() }));
    expect(r.ok && Object.keys(r.values).sort()).toEqual(['Build environments', 'Features enabled', 'Version']);
    expect(JSON.stringify(r)).not.toContain('acct-marco');
    expect(JSON.stringify(r)).not.toContain('Kestrel Studio');
  });

  it('absent vs empty: defined with no value is an empty list; not defined is left out', async () => {
    // "Build environments" has no value on the object; "Region" is not an attribute of the type.
    const r = await read(client({ status: 200, body: aqlReply([attr('4', '13.2'), attr('6', 'uploads')]) }), env(), [...MAPPED, 'Region']);
    expect(r).toMatchObject({ ok: true, values: { Version: ['13.2'], 'Build environments': [], 'Features enabled': ['uploads'] } });
    expect(r.ok && Object.hasOwn(r.values, 'Region')).toBe(false);
  });

  it('when the reply does not list an attribute, asks the type for its definitions before calling it absent', async () => {
    const typeAttributes = vi.fn(async () => ({ status: 200, body: [...TYPE_ATTRS, { id: '9', name: 'Region' }] }));
    const c = client({ status: 200, body: aqlReply(undefined, TYPE_ATTRS) }, { typeAttributes });
    const r = await read(c, env(), [...MAPPED, 'Region']);
    expect(typeAttributes).toHaveBeenCalledWith('ws-1', '147');
    expect(r).toMatchObject({ ok: true, values: { Region: [] } });
  });

  it('if the definitions cannot be read, an unlisted attribute stays absent (Not verified, never empty)', async () => {
    const c = client({ status: 200, body: aqlReply() }, { typeAttributes: async () => ({ status: 500, body: null }) });
    const r = await read(c, env(), [...MAPPED, 'Region']);
    expect(r.ok && Object.hasOwn(r.values, 'Region')).toBe(false);
  });

  it('a blank text value counts as no value; an empty Version means no version', async () => {
    const r = await read(client({ status: 200, body: aqlReply([attr('4', '  '), attr('5', ''), attr('6', 'uploads')]) }));
    expect(r).toMatchObject({ ok: true, version: null, values: { Version: [], 'Build environments': [] } });
  });

  it('falls back to the Updated attribute for the record time', async () => {
    const body = aqlReply([attr('4', '13.2'), attr('8', '2026-11-05T09:00:00.000Z')]);
    delete (body.values[0] as Record<string, unknown>).updated;
    expect(await read(client({ status: 200, body }))).toMatchObject({ ok: true, recordUpdatedAt: '2026-11-05T09:00:00.000Z' });
  });

  it('maps failures to Not verified reasons', async () => {
    const cases: Array<[AssetsClient, string]> = [
      [client({ status: 403, body: { error: 'Forbidden' } }), 'forbidden'],
      [client({ status: 401, body: null }), 'forbidden'],
      [client({ status: 400, body: { errorMessages: ['objectSchema not found'] } }), 'not_found'],
      [client({ status: 200, body: { values: [], objectTypeAttributes: TYPE_ATTRS } }), 'not_found'],
      [client({ status: 200, body: { values: [aqlReply().values[0], aqlReply().values[0]] } }), 'not_found'],
      [client({ status: 503, body: null }), 'unreachable'],
      [client({ status: 429, body: null }), 'unreachable'],
      [client(() => { throw new Error('timeout'); }), 'unreachable'],
      [client({ status: 200, body: 'not json' }), 'unreachable'],
      [client({ status: 200, body: aqlReply() }, { workspace: async () => null }), 'not_found'],
      [client({ status: 200, body: aqlReply() }, { workspace: async () => { throw new Error('x'); } }), 'unreachable'],
    ];
    for (const [c, reason] of cases) expect((await read(c)) as unknown, reason).toMatchObject({ ok: false, reason });
  });

  it('refuses an object of another key, and never puts an odd reference into the query', async () => {
    const other = aqlReply();
    other.values[0]!.objectKey = 'TPENV-1';
    expect(await read(client({ status: 200, body: other }))).toMatchObject({ ok: false, reason: 'not_found' });
    for (const ref of ['TPENV-1" OR objectSchema != "x', 'x', '', null]) {
      const c = client({ status: 200, body: aqlReply() });
      expect(await read(c, env({ providerRef: ref }))).toMatchObject({ ok: false, reason: 'not_found' });
      expect(c.queries).toHaveLength(0);
    }
  });

  it('escapes the schema and type names it puts in the query', async () => {
    const c = client({ status: 200, body: aqlReply() });
    await readAssets(env(), { client: c, mappedAttributes: async () => [], schemaName: 'A "quoted" \\ name', typeName: 'T', now: () => NOW });
    expect(c.queries[0]).toBe('objectSchema = "A \\"quoted\\" \\\\ name" AND objectType = "T" AND Key = "TPENV-4679"');
  });
});

describe('registry provider', () => {
  const recorded = { values: { Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': [], Secret: ['x'] }, recordedAt: '2026-11-03T10:00:00.000Z', recordedBy: 'acct-marco' };

  it('returns the owner\'s recorded values, labelled as registry, mapped attributes only', async () => {
    const r = await readRegistry(env({ provider: 'registry', recordedValues: recorded }), { mappedAttributes: async () => MAPPED, now: () => NOW });
    expect(r).toEqual({
      ok: true,
      source: 'registry',
      version: '13.2',
      readAt: NOW,
      recordUpdatedAt: '2026-11-03T10:00:00.000Z',
      values: { Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': [] },
    });
  });

  it('accepts the JSON column as a string too, and treats nothing recorded or bad data as not found', async () => {
    const deps = { mappedAttributes: async () => MAPPED, now: () => NOW };
    expect(await readRegistry(env({ provider: 'registry', recordedValues: JSON.stringify(recorded) }), deps)).toMatchObject({ ok: true });
    for (const bad of [null, '{oops', { values: { Version: '13.2' } }, { values: [] }, 42]) {
      expect(await readRegistry(env({ provider: 'registry', recordedValues: bad }), deps)).toMatchObject({ ok: false, reason: 'not_found' });
    }
  });
});

describe('environmentReader', () => {
  it('sends each environment to its own provider, and refuses an unknown one', async () => {
    const assets = vi.fn(async () => ({ ok: false as const, reason: 'unreachable' as const }));
    const registry = vi.fn(async () => ({ ok: false as const, reason: 'not_found' as const }));
    const reader = environmentReader({ assets, registry });
    await reader.read(env());
    await reader.read(env({ provider: 'registry' }));
    expect(assets).toHaveBeenCalledTimes(1);
    expect(registry).toHaveBeenCalledTimes(1);
    expect(await reader.read(env({ provider: 'http' as Environment['provider'] }))).toMatchObject({ ok: false, reason: 'not_found' });
  });
});

describe('group reader', () => {
  it('reads names from the app-context reply (E6: an array of { name, groupId })', () => {
    expect(parseGroups(200, [{ name: 'kestrel-dev-builders', groupId: 'g1' }, { name: 'jira-users', groupId: 'g2' }])).toEqual({
      ok: true,
      names: ['kestrel-dev-builders', 'jira-users'],
    });
  });

  it('any failure or odd reply is { ok: false }, never an empty list of groups', () => {
    for (const [status, body] of [
      [403, null],
      [500, []],
      [200, { groups: [] }],
      [200, [{ name: 'a' }, { id: 'no-name' }]],
      [200, 'x'],
    ] as Array<[number, unknown]>) {
      expect(parseGroups(status, body).ok, JSON.stringify(body)).toBe(false);
    }
    // An empty array is passed on as read; the engine treats it as unknown (D28).
    expect(parseGroups(200, [])).toEqual({ ok: true, names: [] });
  });
});

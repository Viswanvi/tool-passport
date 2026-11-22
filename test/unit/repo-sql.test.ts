import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Forge SQL repository with `@forge/sql` faked: statements, parameters, and strict row reading (a value
 * the code doesn't know throws, so the engine says Not verified instead of guessing).
 */

const statements: Array<{ query: string; params: unknown[] }> = [];
const replies: unknown[][] = [];
vi.mock('@forge/sql', () => ({
  sql: {
    prepare: (query: string) => ({
      bindParams: (...params: unknown[]) => ({
        execute: async () => {
          statements.push({ query, params });
          return { rows: replies.shift() ?? [] };
        },
      }),
    }),
  },
}));

const { sqlEngineRepo, loadCatalog, loadEnvironment, loadTool, factValue, mappedAttributes } = await import('../../src/db/repo');
const { evaluate } = await import('../../src/engine/evaluate');

beforeEach(() => {
  statements.length = 0;
  replies.length = 0;
});

const FACT = { id: 100, tool_id: 1, environment_id: null, audience_group: null, fact_key: 'web_frontend', version_sensitive: 1, status: 'active' };
const RULE = { id: 200, tool_id: 1, environment_id: '11', audience_group: null, action_key: 'custom_ui', effect: 'approval', approval_route: 'design-review', reason: 'Needs design review', revision: 1, status: 'active' };

describe('row reading', () => {
  it('reads facts with TINYINT booleans and string ids', async () => {
    replies.push([FACT, { ...FACT, id: '101', version_sensitive: 0, environment_id: '11' }]);
    const facts = await sqlEngineRepo.facts(1, 'web_frontend');
    expect(facts).toEqual([
      { id: 100, toolId: 1, environmentId: null, audienceGroup: null, factKey: 'web_frontend', versionSensitive: true, status: 'active' },
      { id: 101, toolId: 1, environmentId: 11, audienceGroup: null, factKey: 'web_frontend', versionSensitive: false, status: 'active' },
    ]);
    expect(statements[0]).toMatchObject({ params: [1, 'web_frontend'] });
  });

  it('throws on a status, effect or flag it does not know, instead of guessing', async () => {
    for (const bad of [{ status: 'Active' }, { status: null }, { version_sensitive: 'yes' }, { id: 'x' }, { fact_key: 7 }]) {
      replies.push([{ ...FACT, ...bad }]);
      await expect(sqlEngineRepo.facts(1, 'web_frontend'), JSON.stringify(bad)).rejects.toThrow(/Unreadable/);
    }
    for (const bad of [{ effect: 'maybe' }, { effect: 'DENY' }, { status: 'deleted' }]) {
      replies.push([{ ...RULE, ...bad }]);
      await expect(sqlEngineRepo.rules(1, 'custom_ui')).rejects.toThrow(/Unreadable/);
    }
  });

  it('fact values are wrapped as { value }, from a parsed or a text JSON column', () => {
    expect(factValue({ value: 2 })).toBe(2);
    expect(factValue('{"value":true}')).toBe(true);
    expect(factValue('{"value":"2 GB"}')).toBe('2 GB');
    for (const bad of [2, '2', 'true', null, [], { v: 2 }, '{oops']) expect(() => factValue(bad), JSON.stringify(bad)).toThrow();
  });

  it('reads the newest active verification with an inlined LIMIT', async () => {
    replies.push([{ id: 1000, fact_id: 100, version: '13.2', value_json: { value: true }, quote: null, verified_by: 'acct-marco', verified_at: new Date('2026-11-03T10:00:00Z'), status: 'active' }]);
    expect(await sqlEngineRepo.latestVersion(100)).toMatchObject({ id: 1000, value: true, verifiedAt: '2026-11-03T10:00:00.000Z' });
    expect(statements[0]!.query).toMatch(/status = 'active' ORDER BY verified_at DESC, id DESC LIMIT 1$/);
  });

  it('a bad row inside evaluate() becomes Not verified with Re-check, never a pass', async () => {
    replies.push([{ ...FACT, status: '???' }]);
    const keys = new Map([['web_frontend', { key: 'web_frontend', kind: 'capability' as const, label: 'Web', valueType: 'boolean' as const, comparison: 'has' as const, requiresValue: false, synonyms: [] }]]);
    const out = await evaluate(
      [{ dimension: 'capability', key: 'web_frontend' }],
      {
        tool: { id: 1, name: 'Kestrel Studio', ownerAccountId: 'acct-marco', versionGranularity: 'minor', defaultPolicy: 'none', catalogRevision: 1 },
        environment: null,
        asker: 'acct-priya',
        groups: { ok: true, names: ['g'] },
        catalog: { revision: 1, keys, links: new Map(), examples: [] },
      },
      { repo: sqlEngineRepo, environments: { read: async () => ({ ok: false, reason: 'unreachable' }) } },
    );
    expect(out.verdict).toBe('dont_know');
    expect(out.results[0]).toMatchObject({ status: 'unknown', settle: 'recheck' });
  });
});

describe('loaders', () => {
  it('loads a tool and an environment', async () => {
    replies.push([{ id: 1, name: 'Kestrel Studio', owner_account_id: 'acct-marco', version_granularity: 'minor', default_policy: 'none', catalog_revision: 3 }]);
    expect(await loadTool(1)).toEqual({ id: 1, name: 'Kestrel Studio', ownerAccountId: 'acct-marco', versionGranularity: 'minor', defaultPolicy: 'none', catalogRevision: 3 });
    replies.push([{ id: 11, tool_id: 1, name: 'KS-DEV', provider: 'assets', provider_ref: 'TPENV-4679', owner_account_id: 'acct-marco', audience_group: null, last_seen_version: '13.2', last_seen_at: '2026-11-20 18:36:00', recorded_values: null }]);
    expect(await loadEnvironment(11)).toMatchObject({ id: 11, provider: 'assets', providerRef: 'TPENV-4679', lastSeenAt: '2026-11-20 18:36:00' });
    replies.push([]);
    expect(await loadTool(99)).toBeNull();
  });

  it('loads the catalog: keys with units, links with null meaning not recorded', async () => {
    replies.push([
      { key_name: 'web_frontend', kind: 'capability', label: 'Build a custom web front end', value_type: null, comparison: 'has', requires_value: 0, synonyms: ['dashboard'], unit: null },
      { key_name: 'max_upload_gb', kind: 'capability', label: 'Upload a file of a given size', value_type: 'number', comparison: 'gte', requires_value: 1, synonyms: '["upload limit"]', unit: 'file size in gigabytes (GB)' },
    ]);
    replies.push([
      { capability_key: 'web_frontend', actions: ['custom_ui'], readiness_keys: ['frontend_build'] },
      { capability_key: 'max_upload_gb', actions: [], readiness_keys: null },
      { capability_key: 'gpu_compute', actions: 'not a list', readiness_keys: [] },
    ]);
    const tool = { id: 1, name: 'Kestrel Studio', ownerAccountId: 'acct-marco', versionGranularity: 'minor' as const, defaultPolicy: 'none' as const, catalogRevision: 3 };
    const c = await loadCatalog(tool);
    expect(c.revision).toBe(3);
    expect(c.keys.get('max_upload_gb')).toMatchObject({ valueType: 'number', comparison: 'gte', requiresValue: true, unit: 'file size in gigabytes (GB)', synonyms: ['upload limit'] });
    expect(c.keys.get('web_frontend')).toMatchObject({ valueType: 'boolean', requiresValue: false });
    expect(c.links.get('max_upload_gb')).toEqual({ capabilityKey: 'max_upload_gb', actions: [], readinessKeys: null });
    expect(c.links.get('gpu_compute')).toEqual({ capabilityKey: 'gpu_compute', actions: null, readinessKeys: [] });
    expect(c.examples.length).toBe(8);
  });

  it('lists the mapped attributes of a tool', async () => {
    replies.push([{ provider_attribute: 'Build environments' }, { provider_attribute: 'Features enabled' }]);
    expect(await mappedAttributes(1)).toEqual(['Build environments', 'Features enabled']);
    expect(statements[0]!.query).toMatch(/SELECT DISTINCT provider_attribute FROM readiness_keys WHERE tool_id = \?/);
  });
});

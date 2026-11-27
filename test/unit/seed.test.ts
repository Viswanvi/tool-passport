import { describe, expect, it } from 'vitest';
import { answerQuestion } from '../../src/engine/answer';
import type { CatalogKey } from '../../src/engine/catalog';
import type { AccessMappingRow, CapabilityLink, EngineRepo, Environment, FactRow, FactVersionRow, ReadinessKeyRow, RuleRow, Tool } from '../../src/engine/model';
import type { RegistryWriter } from '../../src/registry/write';
import { readRegistry } from '../../src/providers/registry';
import { seedDemo } from '../../src/seed/demo';
import { DEMO_EXAMPLES } from '../../src/seed/demo-catalog';
import { modelReplying, picks, WEB } from '../support/demo-world';

/** "Load demo data" through an in-memory writer with the same unique keys as the SQL tables. */
function memoryRegistry() {
  const db = {
    tools: [] as Tool[],
    environments: [] as Environment[],
    keys: new Map<string, CatalogKey>(),
    links: new Map<string, CapabilityLink>(),
    facts: [] as Array<FactRow & { scope: string }>,
    versions: [] as FactVersionRow[],
    rules: new Map<string, RuleRow>(),
    readiness: new Map<string, ReadinessKeyRow>(),
    access: new Map<string, AccessMappingRow>(),
    revisions: 0,
    audits: [] as unknown[],
    calls: 0,
  };
  let seq = 1;
  const writer: RegistryWriter = {
    async upsertTool(t) {
      db.calls++;
      let tool = db.tools.find((x) => x.name === t.name);
      if (!tool) db.tools.push((tool = { id: seq++, name: t.name, ownerAccountId: t.ownerAccountId, versionGranularity: t.versionGranularity, defaultPolicy: t.defaultPolicy, catalogRevision: 0 }));
      return tool.id;
    },
    async upsertEnvironment(e) {
      db.calls++;
      let env = db.environments.find((x) => x.toolId === e.toolId && x.name === e.name);
      if (!env) db.environments.push((env = { id: seq++, toolId: e.toolId, name: e.name, provider: e.provider, providerRef: e.providerRef, ownerAccountId: e.ownerAccountId, audienceGroup: e.audienceGroup, lastSeenVersion: null, lastSeenAt: null, recordedValues: e.recordedValues }));
      return env.id;
    },
    async upsertCatalogKey(_t, k) {
      db.calls++;
      db.keys.set(k.key, k);
    },
    async upsertLink(_t, l) {
      db.calls++;
      db.links.set(l.capabilityKey, l);
    },
    async upsertFact(f) {
      db.calls++;
      const scope = `${f.toolId}|${f.environmentId ?? '*'}|${f.audienceGroup ?? '*'}|${f.factKey}`;
      let fact = db.facts.find((x) => x.scope === scope);
      if (!fact) db.facts.push((fact = { id: seq++, scope, toolId: f.toolId, environmentId: f.environmentId, audienceGroup: f.audienceGroup, factKey: f.factKey, versionSensitive: f.versionSensitive, status: 'active' }));
      return fact.id;
    },
    async upsertFactVersion(v) {
      db.calls++;
      db.versions = db.versions.filter((x) => !(x.factId === v.factId && x.version === v.version));
      db.versions.push({ id: seq++, factId: v.factId, version: v.version, value: v.value, quote: v.quote, verifiedBy: v.verifiedBy, verifiedAt: '2026-11-23T00:00:00.000Z', status: 'active' });
    },
    async upsertRule(r) {
      db.calls++;
      const scope = `${r.toolId}|${r.environmentId ?? '*'}|${r.audienceGroup ?? '*'}|${r.actionKey}`;
      db.rules.set(scope, { id: db.rules.get(scope)?.id ?? seq++, toolId: r.toolId, environmentId: r.environmentId, audienceGroup: r.audienceGroup, actionKey: r.actionKey, effect: r.effect, approvalRoute: r.approvalRoute, reason: r.reason, revision: 1, status: 'active', approvalDays: r.approvalDays });
    },
    async upsertReadinessKey(rk) {
      db.calls++;
      db.readiness.set(rk.key, { id: seq++, ...rk });
    },
    async upsertAccessMapping(m) {
      db.calls++;
      db.access.set(`${m.environmentId}|${m.actionKey}`, { id: seq++, ...m, attestedAt: '2026-11-23T00:00:00.000Z' });
    },
    async bumpRevision() {
      db.revisions++;
    },
    async audit(...args) {
      db.audits.push(args);
    },
  };
  const repo: EngineRepo = {
    facts: async (_t, key) => db.facts.filter((f) => f.factKey === key),
    activeVersion: async (factId, version) => db.versions.find((v) => v.factId === factId && v.version === version) ?? null,
    latestVersion: async (factId) => db.versions.filter((v) => v.factId === factId).pop() ?? null,
    verifiedVersions: async (factId) => db.versions.filter((v) => v.factId === factId).map((v) => v.version),
    rules: async (_t, action) => [...db.rules.values()].filter((r) => r.actionKey === action),
    approvalGrant: async () => null,
    readinessKey: async (_t, key) => db.readiness.get(key) ?? null,
    accessMapping: async (_t, envId, action) => db.access.get(`${envId}|${action}`) ?? null,
  };
  return { db, writer, repo };
}

const OBJECTS: Record<string, string> = { 'KS-DEV': 'TPENV-4679', 'KS-PROD': 'TPENV-4680' };
const RECORDS: Record<string, Record<string, string[]>> = {
  'TPENV-4679': { Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': ['uploads', 'scheduling'] },
  'TPENV-4680': { Version: ['13.2'], 'Build environments': ['standard', 'frontend'], 'Features enabled': ['uploads', 'scheduling', 'single sign-on'] },
};

describe('Load demo data', () => {
  it('writes the spec section 16 data, links the Assets objects, bumps the revision once and audits', async () => {
    const m = memoryRegistry();
    const r = await seedDemo({ writer: m.writer, findObjectKey: async (n) => OBJECTS[n] ?? null, actor: 'acct-admin' });
    expect(r).toMatchObject({
      ok: true,
      environments: [{ name: 'KS-DEV', providerRef: 'TPENV-4679' }, { name: 'KS-PROD', providerRef: 'TPENV-4680' }],
      counts: { tools: 1, environments: 2, catalogKeys: 25, links: 18, facts: 15, rules: 14, readinessKeys: 4, accessMappings: 10 },
    });
    expect(m.db.revisions).toBe(1);
    expect(m.db.audits).toHaveLength(1);
    expect(m.db.tools[0]).toMatchObject({ name: 'Kestrel Studio', ownerAccountId: 'acct-admin', defaultPolicy: 'none', versionGranularity: 'minor' });
    // Linked but unverified: the judge guide's sample docs page fills these in (D62).
    for (const key of ['websockets', 'export_csv', 'email_notifications']) expect(m.db.facts.find((f) => f.factKey === key), key).toBeUndefined();
    // Every policy rule's action has an access mapping in both environments, so no demo cell is unknown for want of one.
    for (const rule of m.db.rules.values()) {
      if (['external_api_calls', 'external_sharing'].includes(rule.actionKey)) continue;
      expect(m.db.access.has(`${rule.environmentId}|${rule.actionKey}`), `${rule.actionKey} access`).toBe(true);
    }
    // Approvals under the demo's approval rules count for 30 days (D52); other rules have no limit.
    for (const rule of m.db.rules.values()) expect(rule.approvalDays, `${rule.actionKey} ${rule.effect}`).toBe(rule.effect === 'approval' ? 30 : null);
  });

  it('is safe to run twice: same rows, no duplicates', async () => {
    const m = memoryRegistry();
    const deps = { writer: m.writer, findObjectKey: async (n: string) => OBJECTS[n] ?? null, actor: 'acct-admin' };
    await seedDemo(deps);
    const once = JSON.stringify({ t: m.db.tools, e: m.db.environments, f: m.db.facts, r: [...m.db.rules.keys()], v: m.db.versions.length });
    await seedDemo(deps);
    expect(JSON.stringify({ t: m.db.tools, e: m.db.environments, f: m.db.facts, r: [...m.db.rules.keys()], v: m.db.versions.length })).toBe(once);
  });

  it('writes nothing when an Assets object is missing', async () => {
    const m = memoryRegistry();
    const r = await seedDemo({ writer: m.writer, findObjectKey: async (n) => (n === 'KS-DEV' ? 'TPENV-4679' : null), actor: 'acct-admin' });
    expect(r).toEqual({ ok: false, reason: 'No KS-PROD object in the Tool Passport Environments schema in Assets' });
    expect(m.db.calls).toBe(0);
  });

  it('the loaded data gives the spec moment 1 answers through the real engine', async () => {
    const m = memoryRegistry();
    await seedDemo({ writer: m.writer, findObjectKey: async (n) => OBJECTS[n] ?? null, actor: 'acct-admin' });
    const tool = m.db.tools[0]!;
    const catalog = { revision: 1, keys: m.db.keys, links: m.db.links, examples: DEMO_EXAMPLES };
    const env = (name: string) => m.db.environments.find((e) => e.name === name)!;
    const ask = (name: string | null, reply: unknown, groups = ['kestrel-dev-builders']) =>
      answerQuestion(
        { question: 'q', tool, environment: name ? env(name) : null, asker: 'acct-priya', groups: { ok: true, names: groups }, catalog },
        {
          chat: modelReplying(reply),
          repo: m.repo,
          environments: { read: async (e) => ({ ok: true, source: 'assets', values: RECORDS[e.providerRef!]!, version: '13.2', readAt: 'now', recordUpdatedAt: null }) },
        },
      );
    const verdict = async (name: string | null, reply: unknown) => {
      const a = await ask(name, reply);
      return a.state === 'checked' ? a.verdict : a.state;
    };
    expect(await verdict('KS-DEV', WEB)).toBe('not_ready');
    expect(await verdict('KS-PROD', WEB)).toBe('no');
    expect(await verdict('KS-DEV', picks({ key: 'max_upload_gb', value: 3 }))).toBe('no');
    expect(await verdict('KS-DEV', picks({ key: 'max_upload_gb', value: 1 }))).toBe('yes');
    expect(await verdict('KS-DEV', picks({ key: 'websockets' }))).toBe('dont_know');
    expect(await verdict('KS-PROD', picks({ key: 'community_app_framework' }))).toBe('no');
  });

  it('the demo Passport shows every kind of answer, each for a real reason (D62)', async () => {
    const m = memoryRegistry();
    await seedDemo({ writer: m.writer, findObjectKey: async (n) => OBJECTS[n] ?? null, actor: 'acct-admin' });
    const tool = m.db.tools[0]!;
    const catalog = { revision: 1, keys: m.db.keys, links: m.db.links, examples: DEMO_EXAMPLES };
    const env = (name: string) => m.db.environments.find((e) => e.name === name)!;
    const cell = async (key: string, name: string) => {
      const a = await answerQuestion(
        { question: 'q', tool, environment: env(name), asker: 'acct-priya', groups: { ok: true, names: ['kestrel-dev-builders'] }, catalog },
        {
          chat: modelReplying(picks({ key })),
          repo: m.repo,
          environments: { read: async (e) => ({ ok: true, source: 'assets', values: RECORDS[e.providerRef!]!, version: '13.2', readAt: 'now', recordUpdatedAt: null }) },
        },
      );
      return a.state === 'checked' ? a.verdict : a.state;
    };
    // [KS-DEV, KS-PROD] for a builder (kestrel-dev-builders), on a fresh demo.
    const expected: Record<string, [string, string]> = {
      web_frontend: ['not_ready', 'no'],
      database_connections: ['yes', 'yes_with_approval'],
      api_endpoints: ['yes', 'not_ready'],
      community_app_framework: ['no', 'no'],
      single_sign_on: ['not_ready', 'yes'],
      scheduled_jobs: ['yes', 'yes'],
      secrets_storage: ['yes', 'yes'],
      audit_logging: ['yes', 'yes'],
      gpu_compute: ['no', 'no'],
      custom_domains: ['no', 'no'],
      // Linked, not verified yet: the sample docs page fills these in.
      export_csv: ['dont_know', 'dont_know'],
      email_notifications: ['dont_know', 'dont_know'],
      websockets: ['dont_know', 'dont_know'],
    };
    const got: Record<string, [string, string]> = {};
    for (const key of Object.keys(expected)) got[key] = [await cell(key, 'KS-DEV'), await cell(key, 'KS-PROD')];
    expect(got).toEqual(expected);
  });
});

describe('Load demo data in registry mode (spec section 16, "Judge path without Assets")', () => {
  const NOW = '2026-11-24T10:00:00.000Z';

  it('looks nothing up in Assets; the environments carry the section 16 values, recorded by the person loading', async () => {
    const m = memoryRegistry();
    let lookups = 0;
    const r = await seedDemo({ writer: m.writer, findObjectKey: async () => (lookups++, null), registry: { now: () => NOW }, actor: 'acct-admin' });
    expect(lookups).toBe(0);
    expect(r).toMatchObject({ ok: true, environments: [{ name: 'KS-DEV', providerRef: 'Recorded by owner' }, { name: 'KS-PROD', providerRef: 'Recorded by owner' }] });
    expect(m.db.environments.map((e) => ({ name: e.name, provider: e.provider, providerRef: e.providerRef, recordedValues: e.recordedValues }))).toEqual([
      {
        name: 'KS-DEV',
        provider: 'registry',
        providerRef: null,
        recordedValues: { values: { Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': ['uploads', 'scheduling'] }, recordedAt: NOW, recordedBy: 'acct-admin' },
      },
      {
        name: 'KS-PROD',
        provider: 'registry',
        providerRef: null,
        recordedValues: { values: { Version: ['13.2'], 'Build environments': ['standard', 'frontend'], 'Features enabled': ['uploads', 'scheduling', 'single sign-on'] }, recordedAt: NOW, recordedBy: 'acct-admin' },
      },
    ]);
  });

  it('gives the same moment 1 answers through the real registry provider, labelled Recorded by owner', async () => {
    const m = memoryRegistry();
    await seedDemo({ writer: m.writer, findObjectKey: async () => null, registry: { now: () => NOW }, actor: 'acct-admin' });
    const tool = m.db.tools[0]!;
    const catalog = { revision: 1, keys: m.db.keys, links: m.db.links, examples: DEMO_EXAMPLES };
    const env = (name: string) => m.db.environments.find((e) => e.name === name)!;
    const mapped = async () => [...m.db.readiness.values()].map((k) => k.providerAttribute);
    const ask = async (name: string, reply: unknown) =>
      answerQuestion(
        { question: 'q', tool, environment: env(name), asker: 'acct-priya', groups: { ok: true, names: ['kestrel-dev-builders'] }, catalog },
        { chat: modelReplying(reply), repo: m.repo, environments: { read: (e) => readRegistry(e, { mappedAttributes: mapped, now: () => NOW }) } },
      );
    const dev = await ask('KS-DEV', WEB);
    expect(dev.state === 'checked' ? dev.verdict : dev.state).toBe('not_ready');
    if (dev.state === 'checked') expect(dev.outcome.results.find((x) => x.check.dimension === 'environment')!.label).toMatchObject({ kind: 'recorded_by_owner' });
    const prod = await ask('KS-PROD', WEB);
    expect(prod.state === 'checked' ? prod.verdict : prod.state).toBe('no');
  });

  it('switching a site from Assets to registry mode updates the same two environments', async () => {
    const m = memoryRegistry();
    await seedDemo({ writer: m.writer, findObjectKey: async (n) => OBJECTS[n] ?? null, actor: 'acct-admin' });
    await seedDemo({ writer: m.writer, findObjectKey: async () => null, registry: { now: () => NOW }, actor: 'acct-admin' });
    expect(m.db.environments).toHaveLength(2);
  });
});

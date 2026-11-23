import { describe, expect, it } from 'vitest';
import { raiseQuestion } from '../../src/loop/requests';
import type { RegistryWriter } from '../../src/registry/write';
import { handleCreateTool, handleEdit, handleToolDetails, type EditDeps } from '../../src/resolvers/edit-handlers';
import { DEV, MARCO, PRIYA, PROD, SAM } from '../support/demo-world';
import { loopWorld, memoryWriter } from '../support/fix-world';

/**
 * Owner editing (spec F1 / P0-1). Every write is checked on the server: the tool's owner or a Jira
 * administrator; anyone else gets a refusal and an audit row. Every write bumps the catalog revision and
 * writes an audit row. Account ids come from the Forge context only: an environment's owner and an access
 * mapping's attester are the person saving, never a payload field.
 */

type Call = [string, unknown];

function setup(admin = false) {
  const x = loopWorld();
  const calls: Call[] = [];
  const facts = memoryWriter(x.w); // facts go into the world so the engine (and open questions) see them
  const writer: RegistryWriter = {
    upsertTool: async (t) => {
      calls.push(['tool', t]);
      return 9;
    },
    upsertEnvironment: async (e) => {
      calls.push(['environment', e]);
      return 21;
    },
    upsertCatalogKey: async (_toolId, k) => void calls.push(['catalogKey', k]),
    upsertLink: async (_toolId, link, setBy) => void calls.push(['link', { ...link, setBy }]),
    upsertFact: async (f) => {
      calls.push(['fact', f]);
      return facts.upsertFact(f);
    },
    upsertFactVersion: async (v) => {
      calls.push(['factVersion', v]);
      await facts.upsertFactVersion(v);
    },
    upsertRule: async (r) => void calls.push(['rule', r]),
    upsertReadinessKey: async (rk) => void calls.push(['readinessKey', rk]),
    upsertAccessMapping: async (m) => void calls.push(['accessMapping', m]),
    bumpRevision: async (toolId) => void calls.push(['bump', toolId]),
    audit: async (actor, action, entity) => void calls.push(['audit', { actor, action, entity }]),
  };
  const deps: EditDeps = {
    writer,
    check: { isJiraAdmin: async () => admin },
    loop: x.deps,
    listEnvironments: async () => x.w.environments,
    loadRegistry: async () => ({ facts: [], rules: [], readinessKeys: [], accessMappings: [] }),
  };
  const kinds = () => calls.map(([k]) => k);
  const written = (kind: string) => calls.filter(([k]) => k === kind).map(([, v]) => v);
  return { x, calls, deps, kinds, written };
}

const VALID = {
  environment: { entity: 'environment', toolId: 1, name: 'KS-TEST', provider: 'assets', providerRef: 'TPENV-4700', audienceGroup: null, recordedValues: null },
  catalogKey: { entity: 'catalogKey', toolId: 1, key: 'notebooks', kind: 'capability', label: 'Run notebooks', valueType: 'boolean', comparison: 'has', unit: null, synonyms: ['notebook', 'jupyter-style'] },
  link: { entity: 'link', toolId: 1, capabilityKey: 'gpu_compute', actions: [], readinessKeys: [] },
  fact: { entity: 'fact', toolId: 1, key: 'websockets', environmentId: null, audienceGroup: null, value: true, version: '13.2', everyVersion: true, quote: null },
  rule: { entity: 'rule', toolId: 1, actionKey: 'external_api_calls', environmentId: DEV, audienceGroup: null, effect: 'approval', approvalRoute: null, reason: 'Needs security approval' },
  readinessKey: { entity: 'readinessKey', toolId: 1, key: 'gpus', providerAttribute: 'Features enabled', match: 'has', expected: 'gpu', label: 'GPU machines', fixRoute: 'environment_owner' },
  accessMapping: { entity: 'accessMapping', toolId: 1, environmentId: PROD, actionKey: 'custom_ui', noAccessNeeded: false, groupName: 'kestrel-prod-deployers', grants: 'Deployer role in Kestrel', source: 'idp_synced', grantRoute: 'tool_owner' },
} as const;

const WRITE_OF: Record<keyof typeof VALID, string> = {
  environment: 'environment',
  catalogKey: 'catalogKey',
  link: 'link',
  fact: 'fact',
  rule: 'rule',
  readinessKey: 'readinessKey',
  accessMapping: 'accessMapping',
};

describe('owner writes (spec F1)', () => {
  for (const [entity, payload] of Object.entries(VALID) as Array<[keyof typeof VALID, (typeof VALID)[keyof typeof VALID]]>) {
    it(`${entity}: the owner saves it; the revision moves on and an audit row is written`, async () => {
      const s = setup();
      expect(await handleEdit(payload, { accountId: MARCO }, s.deps)).toMatchObject({ ok: true });
      expect(s.kinds()).toContain(WRITE_OF[entity]);
      expect(s.written('bump')).toEqual([1]);
      expect(s.written('audit')).toContainEqual({ actor: MARCO, action: `${entity}.saved`, entity });
    });

    it(`${entity}: anyone else is refused, with an audit row and no write`, async () => {
      const s = setup();
      expect(await handleEdit(payload, { accountId: SAM }, s.deps)).toMatchObject({ ok: false });
      expect(s.calls).toEqual([['audit', { actor: SAM, action: 'edit.refused', entity }]]);
    });
  }

  it('a Jira administrator may edit any tool; nobody signed in may edit anything', async () => {
    const admin = setup(true);
    expect(await handleEdit(VALID.rule, { accountId: SAM }, admin.deps)).toMatchObject({ ok: true });
    const s = setup();
    expect(await handleEdit(VALID.rule, {}, s.deps)).toMatchObject({ ok: false });
    expect(s.kinds()).not.toContain('rule');
  });

  it('rejects a malformed payload or an unknown kind of write', async () => {
    const s = setup();
    for (const p of [null, {}, { entity: 'tool', toolId: 1 }, { ...VALID.rule, effect: 'maybe' }, { ...VALID.link, capabilityKey: 'Bad Key' }, { ...VALID.rule, toolId: 99 }]) {
      expect(await handleEdit(p, { accountId: MARCO }, s.deps), JSON.stringify(p)).toMatchObject({ ok: false });
    }
    expect(s.kinds().filter((k) => k !== 'audit')).toEqual([]);
  });
});

describe('account ids come from the Forge context only', () => {
  it("a new environment's owner is the person saving it; an existing one keeps its owner", async () => {
    const s = setup();
    await handleEdit({ ...VALID.environment, ownerAccountId: SAM }, { accountId: MARCO }, s.deps);
    expect(s.written('environment')[0]).toMatchObject({ name: 'KS-TEST', ownerAccountId: MARCO, providerRef: 'TPENV-4700' });
    s.x.w.environments[0]!.ownerAccountId = 'acct-env-owner';
    await handleEdit({ ...VALID.environment, name: 'KS-DEV', providerRef: 'TPENV-4679' }, { accountId: MARCO }, s.deps);
    expect(s.written('environment')[1]).toMatchObject({ name: 'KS-DEV', ownerAccountId: 'acct-env-owner' });
  });

  it("an access mapping is attested by the person saving it, whatever the payload says", async () => {
    const s = setup();
    await handleEdit({ ...VALID.accessMapping, attestedBy: SAM }, { accountId: MARCO }, s.deps);
    expect(s.written('accessMapping')[0]).toMatchObject({ attestedBy: MARCO, source: 'idp_synced', groupName: 'kestrel-prod-deployers' });
  });

  it('a capability link records who set it', async () => {
    const s = setup();
    await handleEdit(VALID.link, { accountId: MARCO }, s.deps);
    expect(s.written('link')[0]).toMatchObject({ setBy: MARCO });
  });
});

describe('what each write must say', () => {
  it('a capability link left blank stays "not recorded"; "none" must be chosen explicitly', async () => {
    const s = setup();
    await handleEdit({ ...VALID.link, actions: null, readinessKeys: null }, { accountId: MARCO }, s.deps);
    await handleEdit(VALID.link, { accountId: MARCO }, s.deps);
    expect(s.written('link')).toEqual([
      { capabilityKey: 'gpu_compute', actions: null, readinessKeys: null, setBy: MARCO },
      { capabilityKey: 'gpu_compute', actions: [], readinessKeys: [], setBy: MARCO },
    ]);
    // Leaving a field out is not "none": the payload must say null or a list.
    const partial: Record<string, unknown> = { ...VALID.link };
    delete partial.readinessKeys;
    expect(await handleEdit(partial, { accountId: MARCO }, s.deps)).toMatchObject({ ok: false });
    // Only capabilities have links.
    expect(await handleEdit({ ...VALID.link, capabilityKey: 'external_sharing' }, { accountId: MARCO }, s.deps)).toMatchObject({ ok: false });
  });

  it("a catalog key's comparison is fixed by its value type", async () => {
    const s = setup();
    for (const bad of [
      { valueType: 'boolean', comparison: 'gte' },
      { valueType: 'number', comparison: 'has' },
      { valueType: 'text', comparison: 'gte' },
      { valueType: 'boolean', comparison: 'has', unit: 'GB' },
      { kind: 'action', valueType: 'number', comparison: 'gte' },
    ]) {
      expect(await handleEdit({ ...VALID.catalogKey, ...bad }, { accountId: MARCO }, s.deps), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    await handleEdit({ ...VALID.catalogKey, key: 'max_gpus', valueType: 'number', comparison: 'gte', unit: 'number of GPUs' }, { accountId: MARCO }, s.deps);
    expect(s.written('catalogKey')).toEqual([
      { key: 'max_gpus', kind: 'capability', label: 'Run notebooks', valueType: 'number', comparison: 'gte', requiresValue: true, unit: 'number of GPUs', synonyms: ['notebook', 'jupyter-style'] },
    ]);
  });

  it('a fact follows the catalog: a capability key, a value of its type, a readable version, scoped to an environment or group', async () => {
    const s = setup();
    for (const bad of [{ key: 'external_sharing' }, { value: 'yes' }, { version: 'banana' }, { environmentId: 999 }]) {
      expect(await handleEdit({ ...VALID.fact, ...bad }, { accountId: MARCO }, s.deps), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    await handleEdit({ ...VALID.fact, environmentId: DEV, audienceGroup: 'kestrel-dev-builders', everyVersion: false, version: '13.2.4', quote: 'Release notes 13.2' }, { accountId: MARCO }, s.deps);
    expect(s.written('fact')[0]).toMatchObject({ factKey: 'websockets', environmentId: DEV, audienceGroup: 'kestrel-dev-builders', versionSensitive: true, source: 'owner' });
    expect(s.written('factVersion')[0]).toMatchObject({ version: '13.2', value: true, quote: 'Release notes 13.2', verifiedBy: MARCO });
  });

  it('a saved fact settles the open questions it decides, like a published answer', async () => {
    const s = setup();
    const askId = s.x.addAsk(DEV, PRIYA, [{ key: 'websockets' }]);
    expect(await raiseQuestion(askId, PRIYA, s.x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
    expect(await handleEdit(VALID.fact, { accountId: MARCO }, s.deps)).toMatchObject({ ok: true, settled: ['TPD-1'] });
    expect(s.x.jsm.comments[0]!.body).toContain('Answer now: Yes.');
  });

  it('a rule: an approval route only for approval (the tool owner by default), and an environment of the tool', async () => {
    const s = setup();
    await handleEdit(VALID.rule, { accountId: MARCO }, s.deps);
    await handleEdit({ ...VALID.rule, effect: 'deny', approvalRoute: 'environment_owner', reason: 'Not allowed' }, { accountId: MARCO }, s.deps);
    expect(s.written('rule')).toEqual([
      { toolId: 1, environmentId: DEV, audienceGroup: null, actionKey: 'external_api_calls', effect: 'approval', approvalRoute: 'tool_owner', reason: 'Needs security approval' },
      { toolId: 1, environmentId: DEV, audienceGroup: null, actionKey: 'external_api_calls', effect: 'deny', approvalRoute: null, reason: 'Not allowed' },
    ]);
    expect(await handleEdit({ ...VALID.rule, environmentId: 999 }, { accountId: MARCO }, s.deps)).toMatchObject({ ok: false });
  });

  it('an access mapping: "no access needed" is explicit, otherwise a group is required', async () => {
    const s = setup();
    await handleEdit({ ...VALID.accessMapping, noAccessNeeded: true }, { accountId: MARCO }, s.deps);
    expect(s.written('accessMapping')[0]).toMatchObject({ groupName: null, grants: null, grantRoute: null });
    expect(await handleEdit({ ...VALID.accessMapping, groupName: null }, { accountId: MARCO }, s.deps)).toMatchObject({ ok: false });
  });

  it('an environment: an Assets record needs an object key; a registry environment needs recorded values', async () => {
    const s = setup();
    expect(await handleEdit({ ...VALID.environment, providerRef: 'not a key' }, { accountId: MARCO }, s.deps)).toMatchObject({ ok: false });
    expect(await handleEdit({ ...VALID.environment, providerRef: null }, { accountId: MARCO }, s.deps)).toMatchObject({ ok: false });
    expect(await handleEdit({ ...VALID.environment, provider: 'registry', providerRef: null, recordedValues: null }, { accountId: MARCO }, s.deps)).toMatchObject({ ok: false });
    await handleEdit(
      { ...VALID.environment, provider: 'registry', providerRef: null, recordedValues: { Version: ['13.2'], 'Features enabled': ['uploads'] }, audienceGroup: 'kestrel-dev-builders' },
      { accountId: MARCO },
      s.deps,
    );
    expect(s.written('environment')[0]).toMatchObject({
      provider: 'registry',
      providerRef: null,
      audienceGroup: 'kestrel-dev-builders',
      recordedValues: { values: { Version: ['13.2'], 'Features enabled': ['uploads'] }, recordedBy: MARCO },
    });
  });
});

describe('a registry environment saved with a new Version', () => {
  it('notes the version for that environment (a change "Recorded by owner", spec section 11)', async () => {
    const s = setup();
    const noted: Array<{ env: string; observed: string | null }> = [];
    s.x.deps.noteVersion = async (_tool, e, observed) => void noted.push({ env: e.name, observed });
    await handleEdit({ ...VALID.environment, name: 'KS-DEV', provider: 'registry', providerRef: null, recordedValues: { Version: ['14.0'] } }, { accountId: MARCO }, s.deps);
    expect(noted).toEqual([{ env: 'KS-DEV', observed: '14.0' }]);
    // An Assets environment's version comes from its record, read when someone asks or by the sweep.
    await handleEdit(VALID.environment, { accountId: MARCO }, s.deps);
    expect(noted).toHaveLength(1);
  });
});

describe('tools', () => {
  it('only a Jira administrator adds a tool, and becomes its owner', async () => {
    const s = setup();
    const tool = { name: 'Kestrel Labs Notebooks', versionGranularity: 'minor', defaultPolicy: 'none', ownerAccountId: SAM };
    expect(await handleCreateTool(tool, { accountId: MARCO }, s.deps)).toMatchObject({ ok: false });
    expect(s.written('tool')).toEqual([]);
    const admin = setup(true);
    expect(await handleCreateTool(tool, { accountId: MARCO }, admin.deps)).toMatchObject({ ok: true, toolId: 9 });
    expect(admin.written('tool')[0]).toMatchObject({ name: 'Kestrel Labs Notebooks', ownerAccountId: MARCO, versionGranularity: 'minor', defaultPolicy: 'none' });
    expect(admin.written('audit')).toContainEqual({ actor: MARCO, action: 'tool.saved', entity: 'tool' });
  });

  it("the tool's details are for its owner or a Jira administrator only", async () => {
    const s = setup();
    expect(await handleToolDetails({ toolId: 1 }, { accountId: MARCO }, s.deps)).toMatchObject({
      ok: true,
      tool: { id: 1, name: 'Kestrel Studio', versionGranularity: 'minor', defaultPolicy: 'none' },
      environments: [{ name: 'KS-DEV' }, { name: 'KS-PROD' }],
      catalogKeys: expect.arrayContaining([expect.objectContaining({ key: 'web_frontend' })]),
      links: expect.arrayContaining([{ capabilityKey: 'web_frontend', actions: ['custom_ui'], readinessKeys: ['frontend_build'] }]),
    });
    expect(await handleToolDetails({ toolId: 1 }, { accountId: SAM }, s.deps)).toMatchObject({ ok: false });
  });
});

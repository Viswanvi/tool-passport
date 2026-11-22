import type { AskDeps, AskInput } from '../../src/engine/answer';
import type {
  AccessMappingRow,
  ApprovalGrantRow,
  CapabilityLink,
  Catalog,
  EngineRepo,
  Environment,
  EnvRead,
  FactRow,
  FactVersionRow,
  Groups,
  ReadinessKeyRow,
  RuleRow,
  Tool,
} from '../../src/engine/model';
import type { ChatFn, ChatMessage } from '../../src/engine/translate';
import { DEMO_CATALOG, DEMO_EXAMPLES, DEMO_TOOL_NAME } from '../../src/seed/demo-catalog';

/**
 * The spec's demo data (section 16) held in memory, with a repository and providers that read it. Tests
 * change the arrays directly to remove one input at a time. Fictional names only; account ids are made up.
 */

export const MARCO = 'acct-marco';
export const PRIYA = 'acct-priya';
export const SAM = 'acct-sam';
export const DEV = 11;
export const PROD = 12;

export interface World {
  tool: Tool;
  environments: Environment[];
  catalog: Catalog;
  facts: FactRow[];
  factVersions: FactVersionRow[];
  rules: RuleRow[];
  readiness: ReadinessKeyRow[];
  access: AccessMappingRow[];
  grants: ApprovalGrantRow[];
  /** What each environment's record holds: attribute → values. Absent attribute = not defined. */
  records: Map<number, Record<string, string[]>>;
  /** Make a provider read fail for an environment. */
  readFailures: Map<number, Extract<EnvRead, { ok: false }>['reason'] | 'throws'>;
  /** Group membership by account id. */
  groups: Map<string, Groups>;
  /** Every repository read, so a test can prove no check ran. */
  reads: string[];
}

const T0 = '2026-11-03T10:00:00.000Z';
const READ_AT = '2026-11-24T14:02:00.000Z';

export function demoWorld(): World {
  const tool: Tool = {
    id: 1,
    name: DEMO_TOOL_NAME,
    ownerAccountId: MARCO,
    versionGranularity: 'minor',
    defaultPolicy: 'none',
    catalogRevision: 1,
  };
  const env = (id: number, name: string): Environment => ({
    id,
    toolId: 1,
    name,
    provider: 'assets',
    providerRef: `TPE-${id}`,
    ownerAccountId: MARCO,
    audienceGroup: null,
    lastSeenVersion: '13.2',
    lastSeenAt: T0,
    recordedValues: null,
  });

  const link = (capabilityKey: string, actions: string[] | null, readinessKeys: string[] | null): CapabilityLink => ({
    capabilityKey,
    actions,
    readinessKeys,
  });
  const links = [
    link('web_frontend', ['custom_ui'], ['frontend_build']),
    link('runtime_3_9', [], []),
    link('community_app_framework', ['community_app_framework'], []),
    link('max_upload_gb', [], ['uploads']),
    link('scheduled_jobs', [], []),
    link('single_sign_on', [], []),
    link('websockets', [], []),
  ];

  const facts: FactRow[] = [];
  const factVersions: FactVersionRow[] = [];
  const addFact = (factKey: string, value: unknown, versionSensitive: boolean, quote: string | null = null) => {
    const id = 100 + facts.length;
    facts.push({ id, toolId: 1, environmentId: null, audienceGroup: null, status: 'active', factKey, versionSensitive });
    factVersions.push({
      id: 1000 + factVersions.length,
      factId: id,
      version: '13.2',
      value,
      quote,
      verifiedBy: MARCO,
      verifiedAt: T0,
      status: 'active',
    });
  };
  addFact('web_frontend', true, true, 'Through the build workflow');
  addFact('runtime_3_9', true, true);
  addFact('community_app_framework', true, true);
  addFact('max_upload_gb', 2, true);
  addFact('scheduled_jobs', true, false);
  addFact('single_sign_on', true, false);
  // websockets: no fact yet, the known unknown.

  const rules: RuleRow[] = [];
  const rule = (actionKey: string, environmentId: number, effect: RuleRow['effect'], reason: string, approvalRoute: string | null = null) =>
    rules.push({
      id: 200 + rules.length,
      toolId: 1,
      environmentId,
      audienceGroup: null,
      status: 'active',
      actionKey,
      effect,
      approvalRoute,
      reason,
      revision: 1,
    });
  rule('custom_ui', DEV, 'approval', 'Needs design review', `design-review:${MARCO}`);
  rule('custom_ui', PROD, 'deny', 'Not allowed in production');
  rule('community_app_framework', DEV, 'deny', 'Pending security review');
  rule('community_app_framework', PROD, 'deny', 'Pending security review');
  rule('external_api_calls', DEV, 'approval', 'Needs security approval', 'security');
  rule('external_api_calls', PROD, 'approval', 'Needs security approval', 'security');
  rule('external_sharing', DEV, 'deny', 'Not allowed');
  rule('external_sharing', PROD, 'deny', 'Not allowed');

  const readiness: ReadinessKeyRow[] = [
    { id: 300, toolId: 1, key: 'frontend_build', providerAttribute: 'Build environments', match: 'has', expected: 'frontend', label: 'Frontend build', fixRoute: `env-owner:${MARCO}` },
    { id: 301, toolId: 1, key: 'uploads', providerAttribute: 'Features enabled', match: 'has', expected: 'uploads', label: 'Uploads', fixRoute: `env-owner:${MARCO}` },
  ];

  const mapping = (id: number, environmentId: number, actionKey: string, groupName: string | null, grants: string | null): AccessMappingRow => ({
    id,
    toolId: 1,
    environmentId,
    actionKey,
    groupName,
    grants,
    source: 'idp_synced',
    attestedBy: MARCO,
    attestedAt: T0,
    grantRoute: groupName ? `group-owner:${MARCO}` : null,
  });
  const access = [
    mapping(400, DEV, 'custom_ui', 'kestrel-dev-builders', 'Developer role in Kestrel'),
    mapping(401, PROD, 'custom_ui', 'kestrel-prod-deployers', 'Deployer role in Kestrel'),
    mapping(402, DEV, 'community_app_framework', null, null),
    mapping(403, PROD, 'community_app_framework', null, null),
  ];

  const records = new Map<number, Record<string, string[]>>([
    [DEV, { Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': ['uploads', 'scheduling'] }],
    [PROD, { Version: ['13.2'], 'Build environments': ['standard', 'frontend'], 'Features enabled': ['uploads', 'scheduling', 'single sign-on'] }],
  ]);

  return {
    tool,
    environments: [env(DEV, 'KS-DEV'), env(PROD, 'KS-PROD')],
    catalog: {
      revision: 1,
      keys: new Map(DEMO_CATALOG.map((k) => [k.key, k])),
      links: new Map(links.map((l) => [l.capabilityKey, l])),
      examples: DEMO_EXAMPLES,
    },
    facts,
    factVersions,
    rules,
    readiness,
    access,
    grants: [],
    records,
    readFailures: new Map(),
    groups: new Map<string, Groups>([
      [PRIYA, { ok: true, names: ['kestrel-dev-builders'] }],
      [SAM, { ok: true, names: ['jira-users'] }],
      [MARCO, { ok: true, names: ['kestrel-dev-builders', 'kestrel-prod-deployers'] }],
    ]),
    reads: [],
  };
}

/**
 * The demo world after moment 2: KS-DEV has the frontend build and Priya's design review is approved, so
 * "Can I build a custom web dashboard?" in KS-DEV is Yes with all four checks passing. Each safety case
 * starts here and removes one input.
 */
export function yesWorld(): World {
  const w = demoWorld();
  w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
  w.grants.push({
    id: 500,
    askerAccountId: PRIYA,
    toolId: 1,
    environmentId: DEV,
    actionKey: 'custom_ui',
    requestKey: 'TPD-12',
    status: 'approved',
    decidedAt: '2026-11-24T15:00:00.000Z',
  });
  return w;
}

export function repoFor(w: World): EngineRepo {
  const log = (s: string) => w.reads.push(s);
  const active = (f: FactVersionRow) => f.status === 'active';
  return {
    async facts(toolId, key) {
      log(`facts:${key}`);
      return w.facts.filter((f) => f.toolId === toolId && f.factKey === key);
    },
    async activeVersion(factId, version) {
      log(`activeVersion:${factId}:${version}`);
      return w.factVersions.find((v) => v.factId === factId && v.version === version && active(v)) ?? null;
    },
    async latestVersion(factId) {
      log(`latestVersion:${factId}`);
      const vs = w.factVersions.filter((v) => v.factId === factId && active(v));
      return vs.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt) || b.id - a.id)[0] ?? null;
    },
    async verifiedVersions(factId) {
      return w.factVersions.filter((v) => v.factId === factId && active(v)).map((v) => v.version);
    },
    async rules(toolId, action) {
      log(`rules:${action}`);
      return w.rules.filter((r) => r.toolId === toolId && r.actionKey === action);
    },
    async approvalGrant(asker, toolId, environmentId, action) {
      log(`grant:${action}`);
      const gs = w.grants.filter((g) => g.askerAccountId === asker && g.toolId === toolId && g.environmentId === environmentId && g.actionKey === action);
      return gs.sort((a, b) => b.id - a.id)[0] ?? null;
    },
    async readinessKey(toolId, key) {
      log(`readiness:${key}`);
      return w.readiness.find((r) => r.toolId === toolId && r.key === key) ?? null;
    },
    async accessMapping(toolId, environmentId, action) {
      log(`access:${action}`);
      return w.access.find((m) => m.toolId === toolId && m.environmentId === environmentId && m.actionKey === action) ?? null;
    },
  };
}

export function depsFor(w: World, chat: ChatFn): AskDeps {
  return {
    chat,
    repo: repoFor(w),
    environments: {
      async read(environment) {
        w.reads.push(`env:${environment.name}`);
        const failure = w.readFailures.get(environment.id);
        if (failure === 'throws') throw new Error('Assets request timed out');
        if (failure) return { ok: false, reason: failure };
        const values = w.records.get(environment.id);
        if (!values) return { ok: false, reason: 'not_found' };
        return {
          ok: true,
          source: environment.provider,
          values: structuredClone(values),
          version: values.Version?.[0] ?? null,
          readAt: READ_AT,
          recordUpdatedAt: T0,
        };
      },
    },
  };
}

export function askInput(w: World, question: string, environmentId: number | null, asker = PRIYA): AskInput {
  return {
    question,
    tool: w.tool,
    environment: environmentId === null ? null : w.environments.find((e) => e.id === environmentId)!,
    asker,
    groups: w.groups.get(asker) ?? { ok: false },
    catalog: w.catalog,
  };
}

/** A fake model that always replies with this (an object is sent as JSON). Records what it was sent. */
export function modelReplying(reply: unknown): ChatFn & { sent: ChatMessage[][] } {
  const sent: ChatMessage[][] = [];
  const fn = (async (messages: ChatMessage[]) => {
    sent.push(messages);
    return { content: typeof reply === 'string' ? reply : JSON.stringify(reply) };
  }) as ChatFn & { sent: ChatMessage[][] };
  fn.sent = sent;
  return fn;
}

export function modelThrowing(): ChatFn & { calls: number } {
  const fn = Object.assign(
    async (): Promise<never> => {
      fn.calls += 1;
      throw new Error('LLM service unavailable');
    },
    { calls: 0 },
  ) as ChatFn & { calls: number };
  return fn;
}

/** The model's correct reply for one or more keys. */
export function picks(...capabilities: Array<{ key: string; value?: number | string | boolean }>) {
  return { capabilities, unsupported: null, restated: 'restated by the model' };
}

export const WEB = picks({ key: 'web_frontend' });
export const DASHBOARD = 'Can I build a custom web dashboard?';

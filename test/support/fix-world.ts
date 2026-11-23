import type { CatalogChoice } from '../../src/engine/catalog';
import type { Groups } from '../../src/engine/model';
import {
  JsmError,
  type JsmClient,
  type LoopDeps,
  type NewRequest,
  type RecheckNote,
  type RequestRepo,
  type RequestRow,
  type RequestSetup,
  type StoredAsk,
} from '../../src/loop/requests';
import { demoWorld, depsFor, modelThrowing, PRIYA, type World } from './demo-world';

/**
 * The request loop's world: the demo data plus an in-memory requests table (same rules as the SQL one: one
 * row per open key, compare-and-set status changes) and a fake service desk that records every call.
 */

export interface MemRow extends RequestRow {
  openKey: string | null;
  requirementHash: string;
  /** A 'raising' row whose lease ran out (a crashed attempt). */
  stale: boolean;
  /** Set when the sweep looked at it. */
  looked: number;
  result: RecheckNote | null;
  resolvedLongAgo: boolean;
}

export function memoryRequests(): RequestRepo & { rows: MemRow[] } {
  const rows: MemRow[] = [];
  const pub = (r: MemRow): RequestRow => ({
    id: r.id,
    kind: r.kind,
    askId: r.askId,
    toolId: r.toolId,
    environmentId: r.environmentId,
    askerAccountId: r.askerAccountId,
    ownerAccountId: r.ownerAccountId,
    requestKey: r.requestKey,
    portalUrl: r.portalUrl,
    target: r.target,
    status: r.status,
  });
  const find = (id: number) => rows.find((r) => r.id === id);
  return {
    rows,
    async claim(n: NewRequest) {
      const held = rows.find((r) => r.openKey === n.openKey);
      if (held) return { row: pub(held), mine: false };
      const row: MemRow = {
        id: rows.length + 1,
        kind: n.kind,
        askId: n.askId,
        toolId: n.toolId,
        environmentId: n.environmentId,
        askerAccountId: n.askerAccountId,
        ownerAccountId: n.ownerAccountId,
        requestKey: null,
        portalUrl: null,
        target: n.target,
        status: 'raising',
        openKey: n.openKey,
        requirementHash: n.requirementHash,
        stale: false,
        looked: 0,
        result: null,
        resolvedLongAgo: false,
      };
      rows.push(row);
      return { row: pub(row), mine: true };
    },
    async takeOver(id) {
      const r = find(id);
      if (!r || r.status !== 'raising' || !r.stale) return false;
      r.stale = false;
      return true;
    },
    async markRaised(id, requestKey, portalUrl) {
      const r = find(id);
      if (r && r.status === 'raising') Object.assign(r, { requestKey, portalUrl, status: 'open' });
    },
    async release(id) {
      const r = find(id);
      if (r && r.status === 'raising') Object.assign(r, { status: 'failed', openKey: null });
    },
    async openFor(asker, kind, environmentId, targets) {
      return rows
        .filter((r) => r.openKey && r.askerAccountId === asker && r.kind === kind && r.environmentId === environmentId && targets.includes(r.target))
        .map(pub);
    },
    async byKey(key) {
      const r = rows.find((x) => x.requestKey === key);
      return r ? pub(r) : null;
    },
    async markResolved(id) {
      const r = find(id);
      if (!r || r.status !== 'open') return false;
      Object.assign(r, { status: 'resolved', openKey: null });
      return true;
    },
    async markRechecked(id, result) {
      const r = find(id);
      if (r) Object.assign(r, { status: 'closed', result });
    },
    async listOpen(limit) {
      return rows.filter((r) => r.status === 'open' && r.requestKey).slice(0, limit).map(pub);
    },
    async listUnfinished(limit) {
      return rows.filter((r) => r.status === 'resolved' && r.resolvedLongAgo).slice(0, limit).map(pub);
    },
    async touch(id) {
      const r = find(id);
      if (r) r.looked += 1;
    },
  };
}

export interface FakeJsm extends JsmClient {
  created: Array<Parameters<JsmClient['createRequest']>[0] & { issueKey: string }>;
  assigned: Array<{ issueKey: string; accountId: string }>;
  comments: Array<{ issueKey: string; body: string }>;
  resolutionReads: string[];
  /** Resolution name by issue key, as a read-back would show it. */
  resolutions: Map<string, string | null>;
  failCreate: JsmError | null;
  failAssign: boolean;
  failComment: boolean;
}

export function fakeJsm(): FakeJsm {
  const jsm: FakeJsm = {
    created: [],
    assigned: [],
    comments: [],
    resolutionReads: [],
    resolutions: new Map(),
    failCreate: null,
    failAssign: false,
    failComment: false,
    async createRequest(r) {
      if (jsm.failCreate) throw jsm.failCreate;
      const issueKey = `TPD-${jsm.created.length + 1}`;
      jsm.created.push({ ...r, issueKey });
      return { issueKey, portalUrl: `https://example.test/servicedesk/customer/portal/14/${issueKey}` };
    },
    async assign(issueKey, accountId) {
      if (jsm.failAssign) return false;
      jsm.assigned.push({ issueKey, accountId });
      return true;
    },
    async comment(issueKey, body) {
      if (jsm.failComment) throw new Error('comment failed');
      jsm.comments.push({ issueKey, body });
    },
    async resolution(issueKey) {
      jsm.resolutionReads.push(issueKey);
      return { name: jsm.resolutions.get(issueKey) ?? null };
    },
  };
  return jsm;
}

export const SETUP: RequestSetup = { serviceDeskId: '14', requestTypeIds: { fix: '320' } };
export const WEB_REQUIREMENT: CatalogChoice[] = [{ key: 'web_frontend' }];

export function loopWorld(w: World = demoWorld()) {
  const asks = new Map<number, StoredAsk>();
  const requests = memoryRequests();
  const jsm = fakeJsm();
  const groupsRead: string[] = [];
  const logs: string[] = [];
  const saved: Array<{ askId: number; verdict: string }> = [];
  // The loop never translates: a model call here would throw.
  const base = depsFor(w, modelThrowing());
  let setup: RequestSetup | null = SETUP;
  const deps: LoopDeps = {
    loadTool: async (id) => (id === w.tool.id ? w.tool : null),
    loadEnvironment: async (id) => w.environments.find((e) => e.id === id) ?? null,
    loadCatalog: async () => w.catalog,
    readGroups: async (accountId): Promise<Groups> => {
      groupsRead.push(accountId);
      return w.groups.get(accountId) ?? { ok: false };
    },
    repo: base.repo,
    environments: base.environments,
    loadAsk: async (id) => asks.get(id) ?? null,
    saveResult: async (askId, verdict) => {
      saved.push({ askId, verdict });
    },
    requests,
    jsm,
    setup: async () => setup,
    log: (line) => logs.push(line),
  };
  const addAsk = (environmentId: number | null, asker = PRIYA, requirement: CatalogChoice[] | null = WEB_REQUIREMENT): number => {
    const id = 70 + asks.size;
    asks.set(id, { id, askerAccountId: asker, toolId: w.tool.id, environmentId, requirement });
    return id;
  };
  return {
    w,
    asks,
    requests,
    jsm,
    deps,
    groupsRead,
    logs,
    saved,
    addAsk,
    setSetup: (s: RequestSetup | null) => {
      setup = s;
    },
  };
}

export const customerRoleError = () => new JsmError('customer_role', '401 they need the customer role');

/** The shape of avi:jira:updated:issue as E5 recorded it (docs/experiments.md, run #60199). */
export function resolvedEvent(key: string, resolution: string | null = 'Done') {
  return {
    issue: { key, fields: { summary: 'x', status: { name: resolution ? 'Resolved' : 'In Progress' } } },
    changelog: {
      items: [
        { field: 'resolution', fieldId: 'resolution', from: null, fromString: null, to: resolution ? '10000' : null, toString: resolution },
        { field: 'status', fieldId: 'status', fromString: 'In Progress', toString: resolution ? 'Resolved' : 'In Progress' },
      ],
    },
    jiraEventTypeName: 'issue_generic',
  };
}

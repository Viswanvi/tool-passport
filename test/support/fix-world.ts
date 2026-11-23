import type { CatalogChoice } from '../../src/engine/catalog';
import type { Groups } from '../../src/engine/model';
import type { ResolutionMap } from '../../src/loop/resolution';
import {
  JsmError,
  type ApprovalStore,
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
  /** An approval request resolved without a decision that counts was commented once. */
  undecided: boolean;
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
        undecided: false,
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
    async markUndecided(id) {
      const r = find(id);
      if (!r || r.status !== 'open' || r.undecided) return false;
      r.undecided = true;
      return true;
    },
  };
}

/** Approval grants written straight into the world the engine reads, as the SQL store writes the table. */
export function memoryApprovals(w: World): ApprovalStore & { decided: Array<{ requestKey: string; status: string }> } {
  const decided: Array<{ requestKey: string; status: string }> = [];
  const store = {
    decided,
    async addPending(g: Parameters<ApprovalStore['addPending']>[0]) {
      if (w.grants.some((x) => x.requestKey === g.requestKey)) return;
      w.grants.push({ id: 600 + w.grants.length, ...g, status: 'pending', decidedAt: null });
    },
    async decide(g: Parameters<ApprovalStore['decide']>[0]) {
      decided.push({ requestKey: g.requestKey, status: g.status });
      const held = w.grants.find((x) => x.requestKey === g.requestKey);
      if (held) {
        if (held.status === 'pending') Object.assign(held, { status: g.status, decidedAt: '2026-11-24T15:00:00.000Z' });
        return;
      }
      w.grants.push({ id: 600 + w.grants.length, ...g, decidedAt: '2026-11-24T15:00:00.000Z' });
    },
  };
  return store;
}

export interface FakeJsm extends JsmClient {
  created: Array<Parameters<JsmClient['createRequest']>[0] & { issueKey: string }>;
  assigned: Array<{ issueKey: string; accountId: string }>;
  comments: Array<{ issueKey: string; body: string }>;
  resolutionReads: string[];
  /** Resolution name by issue key, as a read-back would show it. */
  resolutions: Map<string, string | null>;
  /** Who set the resolution, by issue key; defaults to the assignee. */
  resolvedBy: Map<string, string | null>;
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
    resolvedBy: new Map(),
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
      const assignee = [...jsm.assigned].reverse().find((a) => a.issueKey === issueKey)?.accountId ?? null;
      const name = jsm.resolutions.get(issueKey) ?? null;
      const resolvedBy = jsm.resolvedBy.has(issueKey) ? jsm.resolvedBy.get(issueKey)! : name ? assignee : null;
      return { name, resolvedBy, assignee };
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
  let resolutionMap: ResolutionMap | null = RESOLUTION_MAP;
  const approvals = memoryApprovals(w);
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
    approvals,
    resolutionMap: async () => resolutionMap,
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
    approvals,
    setResolutionMap: (m: ResolutionMap | null) => {
      resolutionMap = m;
    },
  };
}

/** The demo desk has no "Approved" resolution: setup maps Done to approved (D34). */
export const RESOLUTION_MAP: ResolutionMap = { Done: 'approved', Declined: 'declined' };

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

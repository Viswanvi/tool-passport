import { createHash } from 'node:crypto';
import { answerRequirement, type Answer } from '../engine/answer';
import { buildCard, type Card } from '../engine/card';
import type { CatalogChoice } from '../engine/catalog';
import type { Catalog, CheckResult, EngineRepo, Environment, EnvironmentReader, Groups, Tool } from '../engine/model';

/**
 * The request loop (spec section 11, F4), without Forge. Request the fix re-evaluates the stored ask for the
 * caller and raises one private request per missing piece, for the asker, built from that result: the
 * browser sends only the ask id (CLAUDE.md rule 3). Forge SQL has no transactions, so "one open request per
 * person, kind and target" is a unique open key claimed before the service desk is called (D32).
 */

export type RequestKind = 'fix' | 'approval' | 'question';
export const REQUEST_KINDS: readonly RequestKind[] = ['fix', 'approval', 'question'];

/** raising → open → resolved → closed; a failed raise frees the open key. */
export type RequestStatus = 'raising' | 'open' | 'resolved' | 'closed' | 'failed';
export const REQUEST_STATUSES: readonly RequestStatus[] = ['raising', 'open', 'resolved', 'closed', 'failed'];

export interface StoredAsk {
  id: number;
  askerAccountId: string;
  toolId: number;
  environmentId: number | null;
  /** The catalog keys the question mapped to; null when it was unsupported. */
  requirement: CatalogChoice[] | null;
}

export interface RequestRow {
  id: number;
  kind: RequestKind;
  askId: number;
  toolId: number;
  environmentId: number | null;
  askerAccountId: string;
  /** Who the request was routed to. */
  ownerAccountId: string;
  requestKey: string | null;
  portalUrl: string | null;
  /** The missing piece: "ready:frontend_build" or "access:custom_ui". */
  target: string;
  status: RequestStatus;
}

export interface NewRequest {
  kind: RequestKind;
  askId: number;
  toolId: number;
  environmentId: number | null;
  askerAccountId: string;
  ownerAccountId: string;
  target: string;
  requirementHash: string;
  openKey: string;
}

/** What the re-check after resolution found, kept on the request row. */
export interface RecheckNote {
  verdict: string | null;
  reason: string;
  at: string;
}

export interface RequestRepo {
  /** Insert a 'raising' row holding this open key; if a row already holds it, return that one (mine: false). */
  claim(r: NewRequest): Promise<{ row: RequestRow; mine: boolean }>;
  /** Take over a 'raising' row whose attempt stopped (its lease ran out). True if this call won. */
  takeOver(id: number): Promise<boolean>;
  markRaised(id: number, requestKey: string, portalUrl: string | null): Promise<void>;
  /** The raise failed: free the open key so it can be tried again. */
  release(id: number, error: string): Promise<void>;
  /** Rows holding an open key for these targets ('raising' or 'open'). */
  openFor(asker: string, kind: RequestKind, environmentId: number, targets: string[]): Promise<RequestRow[]>;
  byKey(requestKey: string): Promise<RequestRow | null>;
  /** open → resolved, freeing the open key. True if this call won (one re-check per resolution). */
  markResolved(id: number): Promise<boolean>;
  /** resolved → closed, with what the re-check found. */
  markRechecked(id: number, result: RecheckNote): Promise<void>;
  /** Open requests for the sweep, least recently looked at first. */
  listOpen(limit: number): Promise<RequestRow[]>;
  /** Resolved a while ago but never closed: a re-check that stopped part way. */
  listUnfinished(limit: number): Promise<RequestRow[]>;
  /** The sweep looked at it and nothing changed. */
  touch(id: number): Promise<void>;
}

export interface JsmClient {
  /** Raised as the app on behalf of the asker; visible to the asker and agents only. */
  createRequest(r: { serviceDeskId: string; requestTypeId: string; raiseOnBehalfOf: string; summary: string; description: string }): Promise<{ issueKey: string; portalUrl: string | null }>;
  /** False if Jira refused (the assignee must be an agent on the desk). */
  assign(issueKey: string, accountId: string): Promise<boolean>;
  /** A comment the asker can see. */
  comment(issueKey: string, body: string): Promise<void>;
  /** The resolution as the issue shows it now (D22: the event alone is not trusted). */
  resolution(issueKey: string): Promise<{ name: string | null }>;
}

export class JsmError extends Error {
  constructor(
    readonly code: 'customer_role' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'JsmError';
  }
}

/** Chosen in setup: the desk, and a request type per kind (only fix until Phase 2). */
export interface RequestSetup {
  serviceDeskId: string;
  requestTypeIds: Partial<Record<RequestKind, string>>;
}

export interface RecheckDeps {
  loadTool(id: number): Promise<Tool | null>;
  loadEnvironment(id: number): Promise<Environment | null>;
  loadCatalog(tool: Tool): Promise<Catalog>;
  readGroups(accountId: string): Promise<Groups>;
  repo: EngineRepo;
  environments: EnvironmentReader;
  noteVersion?(tool: Tool, environment: Environment, observed: string | null): Promise<unknown>;
}

export interface LoopDeps extends RecheckDeps {
  loadAsk(id: number): Promise<StoredAsk | null>;
  /** Keep the newest verdict and evidence on the ask. */
  saveResult?(askId: number, verdict: string, factVersionIds: number[]): Promise<void>;
  requests: RequestRepo;
  jsm: JsmClient;
  setup(): Promise<RequestSetup | null>;
  log?(line: string): void;
}

export interface Rechecked {
  ask: StoredAsk;
  answer: Answer;
  card: Card;
  tool: Tool;
  environment: Environment | null;
  catalog: Catalog;
}

/** The stored ask evaluated again, now, for its asker. Null if its tool or environment is gone. */
export async function recheckAsk(ask: StoredAsk, deps: RecheckDeps): Promise<Rechecked | null> {
  const tool = await deps.loadTool(ask.toolId);
  if (!tool) return null;
  const environment = ask.environmentId === null ? null : await deps.loadEnvironment(ask.environmentId);
  if (ask.environmentId !== null && !environment) return null;
  const [groups, catalog] = await Promise.all([deps.readGroups(ask.askerAccountId), deps.loadCatalog(tool)]);
  const answer = await answerRequirement(
    { requirement: ask.requirement ?? [], tool, environment, asker: ask.askerAccountId, groups, catalog },
    {
      repo: deps.repo,
      environments: deps.environments,
      noteVersion: deps.noteVersion ? (e, v) => deps.noteVersion!(tool, e, v) : undefined,
    },
  );
  return { ask, answer, card: buildCard(answer, { toolName: tool.name, environment, catalog }), tool, environment, catalog };
}

export async function saveResult(deps: Pick<LoopDeps, 'saveResult' | 'log'>, askId: number, answer: Answer): Promise<void> {
  if (!deps.saveResult) return;
  const verdict = answer.state === 'checked' ? answer.verdict : answer.state === 'unsupported' ? 'unsupported' : null;
  if (!verdict) return;
  const ids = answer.state === 'checked' ? answer.outcome.results.flatMap((r) => (r.factVersionId ? [r.factVersionId] : [])) : [];
  try {
    await deps.saveResult(askId, verdict, ids);
  } catch (e) {
    deps.log?.(`[request] could not save the re-check on ask ${askId}: ${String(e).slice(0, 200)}`);
  }
}

// ---- what is missing, and who fixes it ----------------------------------------------------------------

export interface FixTarget {
  target: string;
  result: CheckResult;
}

/** One target per missing piece of a Not ready answer: setup in the record, or mapped access. */
export function fixTargets(answer: Answer): FixTarget[] {
  if (answer.state !== 'checked' || answer.outcome.verdict !== 'not_ready') return [];
  return answer.outcome.fixes.flatMap((r): FixTarget[] => {
    if (r.status !== 'missing') return [];
    if (r.check.dimension === 'environment') return [{ target: `ready:${r.check.key}`, result: r }];
    if (r.check.dimension === 'access') return [{ target: `access:${r.check.action}`, result: r }];
    return [];
  });
}

/** One open request per person, kind and target (spec F4), as one string a unique key can hold. */
export const openKey = (kind: RequestKind, environmentId: number | null, target: string, asker: string): string =>
  `${kind}|${environmentId ?? '*'}|${target}|${asker}`;

export function requirementHash(requirement: CatalogChoice[]): string {
  const sorted = [...requirement].sort((a, b) => a.key.localeCompare(b.key));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Who a missing piece goes to. `environment_owner` and `tool_owner` are the routes the owner forms and the demo
 * seed write. An environment with no owner, or a route this code doesn't know, goes to the tool owner: the
 * request always reaches someone accountable.
 */
export function routeOwner(route: string | null | undefined, tool: Tool, environment: Environment | null): string {
  if (route === 'environment_owner' && environment?.ownerAccountId) return environment.ownerAccountId;
  return tool.ownerAccountId;
}

const utc = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

/** Plain words for a missing piece: "Frontend build", "Membership of kestrel-dev-builders". */
export function pieceName(r: CheckResult): string {
  if (r.check.dimension === 'access') return r.label.kind === 'mapped_access' ? `Membership of ${r.label.group}` : `Access for ${r.check.action}`;
  if (r.check.dimension === 'environment') return r.subject ?? r.check.key.replace(/_/g, ' ');
  return 'This requirement';
}

/**
 * The request's text, built by code from the stored answer and the owner's records. It holds no question text
 * (that is deleted after 30 days, and a request outlives it) and nothing the model wrote.
 */
export function fixRequestText(t: FixTarget, x: { tool: Tool; environment: Environment; restated: string }): { summary: string; description: string } {
  const r = t.result;
  const env = x.environment.name;
  let summary: string;
  let missing: string;
  let evidence = '';
  if (r.check.dimension === 'access') {
    const group = r.label.kind === 'mapped_access' ? r.label.group : r.check.action;
    summary = `Access needed in ${env}: ${group}`;
    missing = `Missing: ${r.needs ?? `membership of ${group}`}.`;
    if (r.label.kind === 'mapped_access') {
      evidence = `Evidence: access mapping recorded by the tool owner (${r.label.source === 'idp_synced' ? 'synced from the identity provider' : 'managed by hand'}).`;
    }
  } else {
    const subject = pieceName(r);
    summary = `Fix needed in ${env}: ${subject}`;
    missing = `Missing: ${subject}.${r.needs ? ` ${r.needs}.` : ''}`;
    if (r.label.kind === 'assets_record') evidence = `Evidence: Assets record ${x.environment.providerRef}, read ${utc(r.label.readAt)}.`;
    if (r.label.kind === 'recorded_by_owner') evidence = `Evidence: values recorded by the owner for ${env}, read ${utc(r.label.readAt)}.`;
  }
  const description = [
    `Tool Passport checked ${x.tool.name} in ${env} for the person this request was raised for, and found something missing.`,
    '',
    missing,
    evidence,
    `What they want to do: ${x.restated}.`,
    '',
    "When it's in place, resolve this request. Tool Passport will check again and add the new answer here as a comment.",
  ]
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n');
  return { summary: summary.slice(0, 250), description: description.slice(0, 4000) };
}

// ---- the card -----------------------------------------------------------------------------------------

/** Request the fix becomes "Fix requested" once every missing piece has an open request; nothing else changes. */
export function attachOpenRequests(card: Card, targets: string[], rows: RequestRow[]): Card {
  if (card.action?.kind !== 'request_fix' || targets.length === 0) return card;
  const byTarget = new Map(rows.filter((r) => r.status === 'raising' || r.status === 'open').map((r) => [r.target, r]));
  if (!targets.every((t) => byTarget.has(t))) return card;
  const requests = targets.map((t) => byTarget.get(t)!).map((r) => ({ key: r.requestKey, url: r.portalUrl, ownerAccountId: r.ownerAccountId }));
  return { ...card, action: { kind: 'fix_requested', label: 'Fix requested', requests } };
}

export async function cardWithRequests(now: Pick<Rechecked, 'answer' | 'card' | 'environment'>, asker: string, requests: Pick<RequestRepo, 'openFor'>): Promise<Card> {
  const targets = fixTargets(now.answer).map((t) => t.target);
  if (!targets.length || !now.environment || now.card.action?.kind !== 'request_fix') return now.card;
  return attachOpenRequests(now.card, targets, await requests.openFor(asker, 'fix', now.environment.id, targets));
}

// ---- Request the fix ----------------------------------------------------------------------------------

export type RaiseError = 'not_signed_in' | 'bad_request' | 'not_found' | 'not_set_up' | 'customer_role' | 'request_failed' | 'try_again';

export type RaiseReply = { ok: true; card: Card; raised: string[] } | { ok: false; error: RaiseError; message: string; card: Card | null };

export const RAISE_MESSAGES: Record<RaiseError, string> = {
  not_signed_in: 'Sign in to request a fix.',
  bad_request: 'That request could not be read. Ask the question again.',
  not_found: 'That answer is no longer available. Ask the question again.',
  not_set_up: "Requests aren't set up yet. A Jira administrator picks the service desk under Apps → Manage apps → Tool Passport setup.",
  // D23: raiseOnBehalfOf needs the org-level Jira Service Management Customer role (E5).
  customer_role:
    'Tool Passport can only raise requests for people with the Jira Service Management Customer role. Ask your organization admin to give you that role in Atlassian Administration, then try again.',
  request_failed: "The request couldn't be raised just now. Try again.",
  try_again: 'Something went wrong. Try again.',
};

export const raiseFailure = (error: RaiseError, card: Card | null = null): RaiseReply => ({ ok: false, error, message: RAISE_MESSAGES[error], card });

type RaiseOne = { ok: true; row: RequestRow; raised: boolean } | { ok: false; error: 'customer_role' | 'request_failed' };

export async function raiseFix(askId: number, asker: string, deps: LoopDeps): Promise<RaiseReply> {
  const ask = await deps.loadAsk(askId);
  if (!ask || ask.askerAccountId !== asker) return raiseFailure('not_found');
  const setup = await deps.setup();
  const requestTypeId = setup?.requestTypeIds.fix;
  if (!setup?.serviceDeskId || !requestTypeId) return raiseFailure('not_set_up');

  // What's missing now, not what the page showed: the fix may already be in place.
  const now = await recheckAsk(ask, deps);
  if (!now) return raiseFailure('not_found');
  const targets = fixTargets(now.answer);
  if (!targets.length || !now.environment) return { ok: true, card: now.card, raised: [] };

  const rows: RequestRow[] = [];
  const raised: string[] = [];
  const names = targets.map((t) => t.target);
  for (const t of targets) {
    const one = await raiseOne(t, now, setup.serviceDeskId, requestTypeId, deps);
    if (!one.ok) return raiseFailure(one.error, attachOpenRequests(now.card, names, rows));
    rows.push(one.row);
    if (one.raised && one.row.requestKey) raised.push(one.row.requestKey);
  }
  return { ok: true, card: attachOpenRequests(now.card, names, rows), raised };
}

async function raiseOne(t: FixTarget, now: Rechecked, serviceDeskId: string, requestTypeId: string, deps: LoopDeps): Promise<RaiseOne> {
  const environment = now.environment!;
  const asker = now.ask.askerAccountId;
  const claim = await deps.requests.claim({
    kind: 'fix',
    askId: now.ask.id,
    toolId: now.tool.id,
    environmentId: environment.id,
    askerAccountId: asker,
    ownerAccountId: routeOwner(t.result.route, now.tool, environment),
    target: t.target,
    requirementHash: requirementHash(now.ask.requirement ?? []),
    openKey: openKey('fix', environment.id, t.target, asker),
  });
  const row = claim.row;
  if (!claim.mine) {
    if (row.status !== 'raising') return { ok: true, row, raised: false };
    // Another click is raising it now, unless that attempt stopped: then this one takes over.
    if (!(await deps.requests.takeOver(row.id))) return { ok: true, row, raised: false };
  }

  const restated = now.answer.state === 'checked' ? now.answer.restated : '';
  let created: { issueKey: string; portalUrl: string | null };
  try {
    created = await deps.jsm.createRequest({ serviceDeskId, requestTypeId, raiseOnBehalfOf: asker, ...fixRequestText(t, { tool: now.tool, environment, restated }) });
  } catch (e) {
    await deps.requests.release(row.id, String(e).slice(0, 300));
    deps.log?.(`[request] raising a fix request failed: ${String(e).slice(0, 200)}`);
    const customerRole = e instanceof JsmError ? e.code === 'customer_role' : (e as { code?: unknown } | null)?.code === 'customer_role';
    return { ok: false, error: customerRole ? 'customer_role' : 'request_failed' };
  }
  await deps.requests.markRaised(row.id, created.issueKey, created.portalUrl);
  let assigned = false;
  try {
    assigned = await deps.jsm.assign(created.issueKey, row.ownerAccountId);
  } catch {
    assigned = false;
  }
  // The request stands either way: it is in the desk's queue, just not on the owner's list.
  if (!assigned) deps.log?.(`[request] ${created.issueKey} was raised but not assigned to the owner`);
  return { ok: true, row: { ...row, requestKey: created.issueKey, portalUrl: created.portalUrl, status: 'open' }, raised: true };
}

// ---- Re-check -----------------------------------------------------------------------------------------

export type RecheckReply = { ok: true; askId: number; card: Card } | { ok: false; error: 'not_signed_in' | 'bad_request' | 'not_found' | 'try_again' };

/** The Re-check button and the open card's polling: the stored keys, evaluated again for the caller. */
export async function recheckForAsker(askId: number, asker: string, deps: LoopDeps): Promise<RecheckReply> {
  const ask = await deps.loadAsk(askId);
  if (!ask || ask.askerAccountId !== asker) return { ok: false, error: 'not_found' };
  const now = await recheckAsk(ask, deps);
  if (!now) return { ok: false, error: 'not_found' };
  await saveResult(deps, ask.id, now.answer);
  return { ok: true, askId, card: await cardWithRequests(now, asker, deps.requests) };
}

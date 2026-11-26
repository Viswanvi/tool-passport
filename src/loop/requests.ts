import { createHash } from 'node:crypto';
import { answerRequirement, type Answer } from '../engine/answer';
import { buildCard, requestedStep, type Card } from '../engine/card';
import type { CatalogChoice } from '../engine/catalog';
import type { Catalog, CheckResult, EngineRepo, Environment, EnvironmentReader, Groups, Tool } from '../engine/model';
import { approvalOutcome, type ResolutionMap } from './resolution';

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
  /** Rows holding an open key for these targets ('raising' or 'open'). A null environment is "Any environment". */
  openFor(asker: string, kind: RequestKind, environmentId: number | null, targets: string[]): Promise<RequestRow[]>;
  /** Open requests of one kind for a tool: the owner's open questions. */
  openByKind(toolId: number, kind: RequestKind, limit: number): Promise<RequestRow[]>;
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
  /**
   * An approval request resolved without a decision that counts: note it once (the row stays open, so a later
   * decision still counts). True the first time, so the asker is told once.
   */
  markUndecided(id: number): Promise<boolean>;
}

/** The approval_grants table, written only by the request loop. */
export interface ApprovalStore {
  /** A pending grant for a raised approval request; safe to repeat. */
  addPending(g: GrantKey): Promise<void>;
  /** Record the decision once: a pending or missing grant becomes approved or declined; a decided one stays. */
  decide(g: GrantKey & { status: 'approved' | 'declined' }): Promise<void>;
}

export interface GrantKey {
  askerAccountId: string;
  toolId: number;
  environmentId: number;
  actionKey: string;
  requestKey: string;
}

/** What reading the request back shows: the resolution, who set it, and who it is assigned to now. */
export interface ResolutionRead {
  name: string | null;
  resolvedBy: string | null;
  assignee: string | null;
}

export interface JsmClient {
  /** Raised as the app on behalf of the asker; visible to the asker and agents only. */
  createRequest(r: { serviceDeskId: string; requestTypeId: string; raiseOnBehalfOf: string; summary: string; description: string }): Promise<{ issueKey: string; portalUrl: string | null }>;
  /** False if Jira refused (the assignee must be an agent on the desk). */
  assign(issueKey: string, accountId: string): Promise<boolean>;
  /** A comment the asker can see. */
  comment(issueKey: string, body: string): Promise<void>;
  /** The resolution as the issue shows it now (D22: the event alone is not trusted), with who set it. */
  resolution(issueKey: string): Promise<ResolutionRead>;
  /** Resolve a request the app settled (an answered question). False if no resolving transition was found. */
  resolve(issueKey: string): Promise<boolean>;
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
  approvals: ApprovalStore;
  /** Set in setup: which resolution names approve or decline. */
  resolutionMap(): Promise<ResolutionMap | null>;
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

/** One target per policy that needs approval, only once everything else is in place (Yes, with approval). */
export function approvalTargets(answer: Answer): FixTarget[] {
  if (answer.state !== 'checked' || answer.outcome.verdict !== 'yes_with_approval') return [];
  return answer.outcome.approvals.flatMap((r): FixTarget[] =>
    r.status === 'approval' && r.check.dimension === 'policy' ? [{ target: `approval:${r.check.action}`, result: r }] : [],
  );
}

export const APPROVAL_TARGET = 'approval:';

/**
 * Ask the owner (spec F5): one question per requirement, when the answer is Don't know yet and something the
 * owner can settle isn't verified. The target is the requirement's hash, so the owner sees questions about the
 * same thing together, while each asker still gets their own request.
 */
export function questionTargets(answer: Answer): FixTarget[] {
  if (answer.state !== 'checked' || answer.outcome.verdict !== 'dont_know') return [];
  const forOwner = answer.outcome.unknown.find((r) => r.settle === 'ask_owner');
  return forOwner ? [{ target: `question:${requirementHash(answer.requirement)}`, result: forOwner }] : [];
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

/** The resolution names setup mapped to each decision, in a stable order. */
export function decisionNames(map: ResolutionMap | null | undefined): { approved: string[]; declined: string[] } {
  const names = map && typeof map === 'object' ? Object.keys(map).sort() : [];
  return {
    approved: names.filter((n) => approvalOutcome(n, map) === 'approved'),
    declined: names.filter((n) => approvalOutcome(n, map) === 'declined'),
  };
}

const quoted = (names: string[]) => names.map((n) => `"${n}"`).join(' or ');

/**
 * How to decide, in the mapped names. Anything else leaves the approval pending. "Set" fits a resolution and a
 * done status alike (D41: on a site with no resolutions, setup maps statuses).
 */
export function howToDecide(map: ResolutionMap | null | undefined): string {
  const { approved, declined } = decisionNames(map);
  const decline = declined.length ? ` or ${quoted(declined)} to decline` : '';
  return `Set this request to ${quoted(approved)} to approve${decline}.`;
}

/** An approval request's text, built by code from the stored answer, the policy rule and setup's mapping. */
export function approvalRequestText(
  t: FixTarget,
  x: { tool: Tool; environment: Environment; restated: string; catalog: Catalog; map: ResolutionMap | null },
): { summary: string; description: string } {
  const r = t.result;
  const env = x.environment.name;
  const action = r.check.dimension === 'policy' ? r.check.action : '';
  const label = x.catalog.keys.get(action)?.label;
  const actionName = label ? label[0]!.toLowerCase() + label.slice(1) : action.replace(/_/g, ' ');
  const reason = r.label.kind === 'policy_rule' ? r.label.reason : null;
  const summary = `Approval needed in ${env}: ${actionName}${reason ? ` (${reason})` : ''}`;
  const description = [
    `Tool Passport checked ${x.tool.name} in ${env} for the person this request was raised for. Everything else is in place; the policy needs an approval.`,
    '',
    `Policy: ${actionName} in ${env} needs approval${reason ? `: ${reason}` : ''}.`,
    `What they want to do: ${x.restated}.`,
    '',
    `${howToDecide(x.map)} Any other outcome leaves the approval pending. Tool Passport records the decision and adds the new answer here as a comment.`,
  ].join('\n');
  return { summary: summary.slice(0, 250), description: description.slice(0, 4000) };
}

/**
 * A question's text: the tool, where, the restated requirement and what isn't verified, all from code and the
 * catalog. Never the asker's own words: the same requirement reads the same for every asker (spec F5).
 */
export function questionRequestText(now: Pick<Rechecked, 'tool' | 'environment' | 'card'>, restated: string): RequestText {
  const where = now.environment ? `in ${now.environment.name}` : 'in any environment';
  const unknown = now.card.checks.filter((c) => c.status === 'unknown').map((c) => `${c.subject}: ${c.chip.detail}`);
  const subjects = [...new Set(now.card.checks.filter((c) => c.dimension === 'capability' || c.dimension === 'unlinked').map((c) => c.subject))];
  const summary = `Question about ${now.tool.name}: ${subjects.join('; ') || restated}`;
  const description = [
    `Someone asked Tool Passport about ${now.tool.name} ${where}, and there is no verified answer yet.`,
    '',
    `What they want to do: ${restated}.`,
    ...unknown.map((u) => `Not verified yet: ${u}.`),
    '',
    'Answer it once in Tool Passport (My tools → Open questions). Publishing the answer settles every open question about the same thing, and each person who asked gets the answer on their own request.',
  ].join('\n');
  return { summary: summary.slice(0, 250), description: description.slice(0, 4000) };
}

// ---- the card -----------------------------------------------------------------------------------------

const REQUESTED = {
  request_fix: { kind: 'fix', becomes: 'fix_requested', label: 'Fix requested' },
  request_approval: { kind: 'approval', becomes: 'approval_requested', label: 'Approval requested' },
  ask_owner: { kind: 'question', becomes: 'owner_asked', label: 'Question sent' },
} as const;

type Requestable = keyof typeof REQUESTED;
const requestable = (k: string | undefined): k is Requestable => k === 'request_fix' || k === 'request_approval' || k === 'ask_owner';

function targetsFor(kind: Requestable, answer: Answer): FixTarget[] {
  if (kind === 'request_fix') return fixTargets(answer);
  if (kind === 'request_approval') return approvalTargets(answer);
  return questionTargets(answer);
}

/**
 * Request the fix (or Request approval) becomes "Fix requested" ("Approval requested") once every piece has an
 * open request of that kind; nothing else changes.
 */
export function attachOpenRequests(card: Card, targets: string[], rows: RequestRow[]): Card {
  const a = card.action;
  if (!a || !requestable(a.kind) || targets.length === 0) return card;
  const want = REQUESTED[a.kind];
  const byTarget = new Map(rows.filter((r) => r.kind === want.kind && (r.status === 'raising' || r.status === 'open')).map((r) => [r.target, r]));
  // Each step on the path shows its own open request, even while another piece still has none.
  const path = card.path.map((s) => (s.kind === want.kind && s.state === 'todo' && byTarget.has(s.id) ? requestedStep(s, byTarget.get(s.id)!.requestKey) : s));
  const marked = path.some((s, i) => s !== card.path[i]) ? { ...card, path } : card;
  if (!targets.every((t) => byTarget.has(t))) return marked;
  const requests = targets.map((t) => byTarget.get(t)!).map((r) => ({ key: r.requestKey, url: r.portalUrl, ownerAccountId: r.ownerAccountId }));
  return { ...marked, action: { kind: want.becomes, label: want.label, requests } };
}

export async function cardWithRequests(now: Pick<Rechecked, 'answer' | 'card' | 'environment'>, asker: string, requests: Pick<RequestRepo, 'openFor'>): Promise<Card> {
  const kind = now.card.action?.kind;
  if (!requestable(kind)) return now.card;
  // Fixes and approvals need an environment; a question can be about "Any environment".
  if (!now.environment && kind !== 'ask_owner') return now.card;
  const targets = targetsFor(kind, now.answer).map((t) => t.target);
  if (!targets.length) return now.card;
  return attachOpenRequests(now.card, targets, await requests.openFor(asker, REQUESTED[kind].kind, now.environment?.id ?? null, targets));
}

// ---- Request the fix ----------------------------------------------------------------------------------

export type RaiseError = 'not_signed_in' | 'bad_request' | 'not_found' | 'not_set_up' | 'approvals_not_set_up' | 'customer_role' | 'request_failed' | 'try_again';

export type RaiseReply = { ok: true; card: Card; raised: string[] } | { ok: false; error: RaiseError; message: string; card: Card | null };

export const RAISE_MESSAGES: Record<RaiseError, string> = {
  not_signed_in: 'Sign in to request a fix.',
  bad_request: 'That request could not be read. Ask the question again.',
  not_found: 'That answer is no longer available. Ask the question again.',
  not_set_up: "Requests aren't set up yet. A Jira administrator picks the service desk under Jira settings → Marketplace apps → Tool Passport setup.",
  approvals_not_set_up:
    "Approvals aren't set up yet. A Jira administrator chooses what means Approved under Jira settings → Marketplace apps → Tool Passport setup.",
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

  const restated = now.answer.state === 'checked' ? now.answer.restated : '';
  return raiseAll('fix', targets, now, { serviceDeskId: setup.serviceDeskId, requestTypeId }, deps, (t) =>
    fixRequestText(t, { tool: now.tool, environment: now.environment!, restated }),
  );
}

/**
 * Request approval (spec F4): one private request per policy that needs approval, raised for the asker and
 * routed by the rule's approval route, with a pending grant. Only offered once everything else is in place,
 * and only when setup maps at least one resolution to Approved: otherwise nothing could ever decide it.
 */
export async function raiseApproval(askId: number, asker: string, deps: LoopDeps): Promise<RaiseReply> {
  const ask = await deps.loadAsk(askId);
  if (!ask || ask.askerAccountId !== asker) return raiseFailure('not_found');
  const setup = await deps.setup();
  // One request type serves every kind until setup offers one per kind (D34).
  const requestTypeId = setup?.requestTypeIds.approval ?? setup?.requestTypeIds.fix;
  if (!setup?.serviceDeskId || !requestTypeId) return raiseFailure('not_set_up');
  const map = await deps.resolutionMap();
  if (!decisionNames(map).approved.length) return raiseFailure('approvals_not_set_up');

  const now = await recheckAsk(ask, deps);
  if (!now) return raiseFailure('not_found');
  const targets = approvalTargets(now.answer);
  if (!targets.length || !now.environment) return { ok: true, card: now.card, raised: [] };
  const restated = now.answer.state === 'checked' ? now.answer.restated : '';
  const environment = now.environment;
  return raiseAll(
    'approval',
    targets,
    now,
    { serviceDeskId: setup.serviceDeskId, requestTypeId },
    deps,
    (t) => approvalRequestText(t, { tool: now.tool, environment, restated, catalog: now.catalog, map }),
    async (t, requestKey) => {
      const actionKey = t.target.slice(APPROVAL_TARGET.length);
      try {
        await deps.approvals.addPending({ askerAccountId: asker, toolId: now.tool.id, environmentId: environment.id, actionKey, requestKey });
      } catch (e) {
        // The decision writes the grant anyway (decide() inserts a missing one); until then the open request shows.
        deps.log?.(`[request] pending grant for ${requestKey} not written: ${String(e).slice(0, 200)}`);
      }
    },
  );
}

/**
 * Ask the owner (spec F5): a private question for the asker, routed to the tool owner, holding the restated
 * requirement and what isn't verified. Questions outside the catalog (no keys) aren't raised: answering
 * them needs catalog editing, which isn't built (D35).
 */
export async function raiseQuestion(askId: number, asker: string, deps: LoopDeps): Promise<RaiseReply> {
  const ask = await deps.loadAsk(askId);
  if (!ask || ask.askerAccountId !== asker) return raiseFailure('not_found');
  const setup = await deps.setup();
  const requestTypeId = setup?.requestTypeIds.question ?? setup?.requestTypeIds.fix;
  if (!setup?.serviceDeskId || !requestTypeId) return raiseFailure('not_set_up');
  const now = await recheckAsk(ask, deps);
  if (!now) return raiseFailure('not_found');
  const targets = questionTargets(now.answer);
  if (!targets.length) return { ok: true, card: now.card, raised: [] };
  const restated = now.answer.state === 'checked' ? now.answer.restated : '';
  // The owner answers questions, whoever owns the environment.
  const toOwner = targets.map((t) => ({ ...t, result: { ...t.result, route: 'tool_owner' } }));
  return raiseAll('question', toOwner, now, { serviceDeskId: setup.serviceDeskId, requestTypeId }, deps, () => questionRequestText(now, restated));
}

type RequestText = { summary: string; description: string };

async function raiseAll(
  kind: RequestKind,
  targets: FixTarget[],
  now: Rechecked,
  desk: { serviceDeskId: string; requestTypeId: string },
  deps: LoopDeps,
  text: (t: FixTarget) => RequestText,
  afterRaise?: (t: FixTarget, requestKey: string) => Promise<void>,
): Promise<RaiseReply> {
  const rows: RequestRow[] = [];
  const raised: string[] = [];
  const names = targets.map((t) => t.target);
  for (const t of targets) {
    const one = await raiseOne(kind, t, now, desk, deps, text, afterRaise);
    if (!one.ok) return raiseFailure(one.error, attachOpenRequests(now.card, names, rows));
    rows.push(one.row);
    if (one.raised && one.row.requestKey) raised.push(one.row.requestKey);
  }
  return { ok: true, card: attachOpenRequests(now.card, names, rows), raised };
}

async function raiseOne(
  kind: RequestKind,
  t: FixTarget,
  now: Rechecked,
  desk: { serviceDeskId: string; requestTypeId: string },
  deps: LoopDeps,
  text: (t: FixTarget) => RequestText,
  afterRaise?: (t: FixTarget, requestKey: string) => Promise<void>,
): Promise<RaiseOne> {
  const environment = now.environment;
  const environmentId = environment?.id ?? null;
  const asker = now.ask.askerAccountId;
  const claim = await deps.requests.claim({
    kind,
    askId: now.ask.id,
    toolId: now.tool.id,
    environmentId,
    askerAccountId: asker,
    ownerAccountId: routeOwner(t.result.route, now.tool, environment),
    target: t.target,
    requirementHash: requirementHash(now.ask.requirement ?? []),
    openKey: openKey(kind, environmentId, t.target, asker),
  });
  const row = claim.row;
  if (!claim.mine) {
    if (row.status !== 'raising') return { ok: true, row, raised: false };
    // Another click is raising it now, unless that attempt stopped: then this one takes over.
    if (!(await deps.requests.takeOver(row.id))) return { ok: true, row, raised: false };
  }

  let created: { issueKey: string; portalUrl: string | null };
  try {
    created = await deps.jsm.createRequest({ ...desk, raiseOnBehalfOf: asker, ...text(t) });
  } catch (e) {
    await deps.requests.release(row.id, String(e).slice(0, 300));
    deps.log?.(`[request] raising a ${kind} request failed: ${String(e).slice(0, 200)}`);
    const customerRole = e instanceof JsmError ? e.code === 'customer_role' : (e as { code?: unknown } | null)?.code === 'customer_role';
    return { ok: false, error: customerRole ? 'customer_role' : 'request_failed' };
  }
  await deps.requests.markRaised(row.id, created.issueKey, created.portalUrl);
  if (afterRaise) await afterRaise(t, created.issueKey);
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

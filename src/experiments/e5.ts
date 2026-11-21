/**
 * E5: can the app raise requests for an employee and react to resolution?
 * prepare(): find the Tool Passport Desk (TPD) and a request type that needs only summary/description.
 * raise():   as the app, raise two requests on behalf of the person clicking and assign them to the owner.
 * onEvent(): the avi:jira:updated:issue handler records what the event carries and how late it is.
 * Phase 0 only.
 */
import { route } from '@forge/api';
import { getSetting, recordRun, setSetting } from '../db/store';
import { call, field, keysOf, list, requester, text, type Requester, type Step } from '../providers/assets-api';

const DESK_KEY = 'TPD';
const ALLOWED_REQUIRED = new Set(['summary', 'description']);

export interface E5Request {
  key: string;
  purpose: 'done' | 'declined';
  raisedFor: 'admin' | 'non-admin';
  createdAt: string;
}

export interface E5State {
  serviceDeskId: string;
  requestTypeId: string;
  requestTypeName: string;
  ownerAccountId: string;
  requests: E5Request[];
}

export const STATE_KEY = 'exp.e5';

export async function prepare(r: Requester, ownerAccountId: string): Promise<{ ok: boolean; steps: Step[]; state?: E5State }> {
  const steps: Step[] = [];
  const desks = await call(r, 'list service desks', route`/rest/servicedeskapi/servicedesk?limit=100`);
  steps.push(desks.step);
  const desk = list(desks.body, 'values').find((d) => field(d, 'projectKey') === DESK_KEY);
  const serviceDeskId = text(field(desk, 'id'));
  if (!serviceDeskId) {
    steps.push({ step: `find desk ${DESK_KEY}`, status: null, ok: false, note: 'TPD not found' });
    return { ok: false, steps };
  }

  const types = await call(r, 'list request types', route`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype?limit=100`);
  steps.push(types.step);
  for (const t of list(types.body, 'values')) {
    const id = text(field(t, 'id'));
    if (!id) continue;
    const fields = await call(r, `fields of request type ${id}`, route`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype/${id}/field`);
    steps.push(fields.step);
    const required = list(field(fields.body, 'requestTypeFields'))
      .filter((f) => field(f, 'required') === true)
      .map((f) => text(field(f, 'fieldId')) ?? '');
    if (required.every((f) => ALLOWED_REQUIRED.has(f))) {
      const prev = await getSetting<E5State>(STATE_KEY);
      const state: E5State = {
        serviceDeskId,
        requestTypeId: id,
        requestTypeName: text(field(t, 'name')) ?? '?',
        ownerAccountId,
        requests: prev?.requests ?? [],
      };
      await setSetting(STATE_KEY, state);
      return { ok: true, steps, state };
    }
  }
  steps.push({ step: 'pick request type', status: null, ok: false, note: 'no request type needs only summary/description' });
  return { ok: false, steps };
}

export interface RaiseResult {
  ok: boolean;
  steps: Step[];
  raised: E5Request[];
}

/** Raised as the app for `askerAccountId` (the caller from the Forge context, never a payload). */
export async function raise(askerAccountId: string, raisedFor: E5Request['raisedFor']): Promise<RaiseResult> {
  const steps: Step[] = [];
  const state = await getSetting<E5State>(STATE_KEY);
  if (!state) return { ok: false, steps: [{ step: 'state', status: null, ok: false, note: 'run E5 · Prepare (admin) first' }], raised: [] };

  const app = requester('app');
  const raised: E5Request[] = [];
  for (const purpose of ['done', 'declined'] as const) {
    const body = {
      serviceDeskId: state.serviceDeskId,
      requestTypeId: state.requestTypeId,
      raiseOnBehalfOf: askerAccountId,
      requestFieldValues: {
        summary: `Tool Passport E5 test: resolve as ${purpose === 'done' ? 'Done' : 'Declined'}`,
        description: 'Raised by the Tool Passport app during Phase 0 experiment E5. Safe to resolve.',
      },
    };
    let res = await call(app, `raise (${purpose}) as app on behalf of asker`, route`/rest/servicedeskapi/request`, 'POST', body);
    steps.push(res.step);
    // If the asker isn't a customer of the desk, try adding them and raise once more.
    if (!res.step.ok && /customer/i.test(res.step.note ?? '')) {
      const add = await call(app, 'add asker as desk customer (as app)', route`/rest/servicedeskapi/servicedesk/${state.serviceDeskId}/customer`, 'POST', {
        accountIds: [askerAccountId],
      });
      steps.push(add.step);
      if (add.step.ok) {
        res = await call(app, `raise (${purpose}) retry`, route`/rest/servicedeskapi/request`, 'POST', body);
        steps.push(res.step);
      }
    }
    const key = text(field(res.body, 'issueKey'));
    if (!key) continue;
    const assign = await call(app, `assign ${key} to owner (as app)`, route`/rest/api/3/issue/${key}/assignee`, 'PUT', {
      accountId: state.ownerAccountId,
    });
    steps.push(assign.step);
    raised.push({ key, purpose, raisedFor, createdAt: new Date().toISOString() });
  }
  if (raised.length) await setSetting(STATE_KEY, { ...state, requests: [...state.requests, ...raised] });
  return { ok: raised.length === 2 && steps.every((s) => s.ok || /customer/i.test(s.note ?? '')), steps, raised };
}

// ---- avi:jira:updated:issue ----

interface IssueEvent {
  eventType?: string;
  jiraEventTypeName?: string;
  timestamp?: number | string;
  issue?: { key?: string; fields?: Record<string, unknown> };
  changelog?: { items?: unknown[] };
}

/** Only issues this experiment raised are looked at; everything else returns at once. */
export async function onEvent(event: IssueEvent): Promise<void> {
  const key = event.issue?.key;
  if (!key) return;
  const state = await getSetting<E5State>(STATE_KEY);
  const mine = state?.requests.find((r) => r.key === key);
  if (!mine) return;

  const receivedAt = Date.now();
  const fields = event.issue?.fields ?? {};
  const eventResolution = text(field(field(fields, 'resolution'), 'name'));
  // Status and resolution changes only: other changelog items can carry people's names.
  const changes = list(event.changelog?.items)
    .filter((i) => ['status', 'resolution'].includes(String(field(i, 'field') ?? field(i, 'fieldId'))))
    .map((i) => ({ field: field(i, 'field'), from: field(i, 'fromString'), to: field(i, 'toString') }));

  const issue = await call(requester('app'), `read ${key}`, route`/rest/api/3/issue/${key}?fields=resolution,resolutiondate,status`);
  const resolutionName = text(field(field(field(issue.body, 'fields'), 'resolution'), 'name'));
  const resolutionDate = text(field(field(issue.body, 'fields'), 'resolutiondate'));
  const statusName = text(field(field(field(issue.body, 'fields'), 'status'), 'name'));
  const latencySeconds = resolutionDate ? Math.round((receivedAt - Date.parse(resolutionDate)) / 1000) : null;

  const detail = {
    key,
    purpose: mine.purpose,
    eventType: event.eventType,
    jiraEventTypeName: event.jiraEventTypeName,
    eventTimestamp: event.timestamp,
    issueFieldKeys: keysOf(fields),
    resolutionInEventFields: eventResolution ?? null,
    changelog: changes,
    readBack: { step: issue.step, resolutionName, resolutionDate, statusName },
    latencySeconds,
  };
  const resolved = !!resolutionName;
  const summary = `${key} (${mine.purpose}) ${event.jiraEventTypeName ?? event.eventType}: status=${statusName ?? '?'} resolution=${
    resolutionName ?? 'none'
  } (in event fields: ${eventResolution ? 'yes' : 'no'}) latency=${latencySeconds ?? '?'}s`;
  await recordRun('E5', 'event', resolved, summary, detail);
  console.log(`[E5] ${summary}`);
}

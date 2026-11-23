import { route } from '@forge/api';
import { call, field, list, requester, text } from '../providers/assets-api';
import { JsmError, type JsmClient } from './requests';
import { resolvedBy } from './resolution';

/**
 * Jira Service Management calls, all as the app. Raising on behalf of the asker, assigning, and reading the
 * resolution back were run in E5 (docs/experiments.md); the comment endpoint is POST
 * /rest/servicedeskapi/request/{key}/comment with `public: true`, so the asker sees it on their request.
 */

const app = requester('app');
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,31}-\d{1,12}$/;

function checkKey(issueKey: string): string {
  if (!ISSUE_KEY.test(issueKey)) throw new Error(`Not an issue key: ${issueKey.slice(0, 40)}`);
  return issueKey;
}

export const forgeJsm: JsmClient = {
  async createRequest(r) {
    const res = await call(app, 'raise request', route`/rest/servicedeskapi/request`, 'POST', {
      serviceDeskId: r.serviceDeskId,
      requestTypeId: r.requestTypeId,
      raiseOnBehalfOf: r.raiseOnBehalfOf,
      requestFieldValues: { summary: r.summary, description: r.description },
    });
    if (!res.step.ok) {
      const note = res.step.note ?? '';
      // E5: 401 "they need the customer role on your site", key sd.request.create.error.permission.requestor (D23).
      if (/customer role|permission\.requestor/i.test(note)) throw new JsmError('customer_role', `${res.step.status} ${note}`);
      throw new JsmError('failed', `${res.step.status ?? 'no reply'} ${note}`);
    }
    const issueKey = text(field(res.body, 'issueKey'));
    if (!issueKey || !ISSUE_KEY.test(issueKey)) throw new JsmError('failed', 'The reply had no issue key');
    const web = text(field(field(res.body, '_links'), 'web'));
    return { issueKey, portalUrl: web && /^https:\/\/[^\s"<>]+$/.test(web) ? web : null };
  },

  async assign(issueKey, accountId) {
    const res = await call(app, 'assign', route`/rest/api/3/issue/${checkKey(issueKey)}/assignee`, 'PUT', { accountId });
    return res.step.ok;
  },

  async comment(issueKey, body) {
    const res = await call(app, 'comment', route`/rest/servicedeskapi/request/${checkKey(issueKey)}/comment`, 'POST', { body, public: true });
    if (!res.step.ok) throw new Error(`comment ${res.step.status ?? 'no reply'}: ${res.step.note ?? ''}`);
  },

  async resolution(issueKey) {
    const res = await call(app, 'read resolution', route`/rest/api/3/issue/${checkKey(issueKey)}?fields=resolution,assignee&expand=changelog`);
    if (!res.step.ok) throw new Error(`read ${issueKey}: ${res.step.status ?? 'no reply'} ${res.step.note ?? ''}`);
    const fields = field(res.body, 'fields');
    return {
      name: text(field(field(fields, 'resolution'), 'name')) ?? null,
      resolvedBy: resolvedBy(field(field(res.body, 'changelog'), 'histories')),
      assignee: text(field(field(fields, 'assignee'), 'accountId')) ?? null,
    };
  },
};

/** Jira's resolutions, for the setup mapping. */
export async function listResolutions(): Promise<DeskOption[]> {
  const res = await call(app, 'list resolutions', route`/rest/api/3/resolution/search?maxResults=100`);
  if (!res.step.ok) throw new Error(`resolutions: ${res.step.status ?? 'no reply'}`);
  return list(res.body, 'values').flatMap((r) => {
    const id = text(field(r, 'id'));
    const name = text(field(r, 'name'));
    return id && name ? [{ id, name }] : [];
  });
}

// ---- setup lists ----

export interface DeskOption {
  id: string;
  name: string;
}

export async function listDesks(): Promise<DeskOption[]> {
  const res = await call(app, 'list service desks', route`/rest/servicedeskapi/servicedesk?limit=100`);
  if (!res.step.ok) throw new Error(`service desks: ${res.step.status ?? 'no reply'}`);
  return list(res.body, 'values').flatMap((d) => {
    const id = text(field(d, 'id'));
    const name = text(field(d, 'projectName')) ?? text(field(d, 'projectKey'));
    return id && name ? [{ id, name: `${name}${text(field(d, 'projectKey')) ? ` (${text(field(d, 'projectKey'))})` : ''}` }] : [];
  });
}

/** The request type needs nothing the app can't fill: summary and description only (as E5 picked "Get IT help"). */
const FILLABLE = new Set(['summary', 'description']);

export async function usableRequestTypes(serviceDeskId: string): Promise<DeskOption[] | null> {
  const types = await call(app, 'list request types', route`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype?limit=50`);
  if (types.step.status === 404) return null;
  if (!types.step.ok) throw new Error(`request types: ${types.step.status ?? 'no reply'}`);
  const usable: DeskOption[] = [];
  for (const t of list(types.body, 'values')) {
    const id = text(field(t, 'id'));
    const name = text(field(t, 'name'));
    if (!id || !name) continue;
    const fields = await call(app, `fields of request type ${id}`, route`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype/${id}/field`);
    if (!fields.step.ok) continue;
    const required = list(field(fields.body, 'requestTypeFields')).filter((f) => field(f, 'required') === true);
    if (required.every((f) => FILLABLE.has(text(field(f, 'fieldId')) ?? ''))) usable.push({ id, name });
  }
  return usable;
}

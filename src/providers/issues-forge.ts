import api, { route } from '@forge/api';
import { StoryCommentError, type Adf, type StoryCommenter } from '../loop/stories';

/**
 * Work items for the story panel. Reads are as the person looking (asUser), so it shows only what Jira lets them
 * see; only the summary and description are fetched. "Add to story" comments as the person; the update after a
 * re-check comments as the app, since nobody is signed in then.
 */
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-\d{1,10}$/;

export async function readIssueAsUser(issueKey: string): Promise<{ summary: string; description: unknown } | null> {
  if (!ISSUE_KEY.test(issueKey)) return null;
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const body = (await res.json()) as { fields?: { summary?: unknown; description?: unknown } };
  const summary = body.fields?.summary;
  return typeof summary === 'string' ? { summary, description: body.fields?.description ?? null } : null;
}

type Requester = Pick<ReturnType<typeof api.asApp>, 'requestJira'>;

async function comment(requester: Requester, issueKey: string, body: Adf): Promise<void> {
  if (!ISSUE_KEY.test(issueKey)) throw new StoryCommentError('failed', 'Not a work item key');
  const res = await requester.requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (res.ok) return;
  // 403: no permission to comment; 404: the work item is gone or not visible.
  if (res.status === 403 || res.status === 404) throw new StoryCommentError('not_allowed', `comment ${res.status}`);
  throw new StoryCommentError('failed', `comment ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export const forgeStoryComments: StoryCommenter = {
  asUser: (issueKey, body) => comment(api.asUser(), issueKey, body),
  asApp: (issueKey, body) => comment(api.asApp(), issueKey, body),
};

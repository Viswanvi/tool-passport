import api, { route } from '@forge/api';

/**
 * Reads a work item for the story panel, as the person looking (asUser), so it shows only what Jira lets them
 * see. Only the summary and description are fetched. Null when they can't read it, it's gone, or the key isn't
 * a work item key.
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

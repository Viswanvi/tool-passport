import { describe, expect, it } from 'vitest';
import type { SavedAsk } from '../../src/db/asks';
import type { Groups } from '../../src/engine/model';
import { adfText, handleStoryCheck, handleStoryContext, storyText, type StoryDeps } from '../../src/resolvers/story-handlers';
import { demoWorld, depsFor, DEV, modelReplying, PRIYA, PROD, WEB, type World } from '../support/demo-world';

/**
 * "Check this story": a panel on a Jira work item. The work item comes from the Forge context only and is read as
 * the person looking, so they see only what Jira lets them see. The environment is suggested by its name appearing
 * in the story (plain text matching, no model); the story's text is read into catalog keys exactly like a question,
 * and the answer is saved like any ask, so its card can raise requests.
 */

const ISSUE = {
  summary: 'Build a usage dashboard for the sales team in KS-DEV',
  description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Charts of weekly usage. ' }, { type: 'text', text: 'Needs a custom web front end.' }] }] },
};

function deps(w: World, issue: { summary: string; description: unknown } | null = ISSUE, reply: unknown = WEB) {
  const model = modelReplying(reply);
  const base = depsFor(w, model);
  const saved: SavedAsk[] = [];
  const issuesRead: string[] = [];
  const d: StoryDeps = {
    listTools: async () => [{ id: w.tool.id, name: w.tool.name }],
    loadTool: async (id) => (id === w.tool.id ? w.tool : null),
    loadEnvironment: async (id) => w.environments.find((e) => e.id === id) ?? null,
    listEnvironments: async () => w.environments,
    loadCatalog: async () => w.catalog,
    readGroups: async (a): Promise<Groups> => w.groups.get(a) ?? { ok: false },
    repo: base.repo,
    environments: base.environments,
    chat: () => model,
    saveAsk: async (a) => {
      saved.push(a);
      return saved.length;
    },
    readIssue: async (key) => {
      issuesRead.push(key);
      return issue;
    },
  };
  return { d, model, saved, issuesRead };
}

describe('the story text', () => {
  it('reads the text out of a work item description, and keeps the story short', () => {
    expect(adfText(ISSUE.description)).toBe('Charts of weekly usage. Needs a custom web front end.');
    expect(adfText(null)).toBe('');
    expect(adfText('plain text from an older field')).toBe('plain text from an older field');
    const long = storyText('A'.repeat(300), { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B'.repeat(900) }] }] });
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long.startsWith('A'.repeat(300))).toBe(true);
  });
});

describe('the panel', () => {
  it('shows the work item from the Forge context, and suggests the environment the story names', async () => {
    const { d, issuesRead } = deps(demoWorld());
    const r = await handleStoryContext({ accountId: PRIYA, issueKey: 'KAN-7' }, d);
    expect(r).toMatchObject({ ok: true, issueKey: 'KAN-7', summary: ISSUE.summary, tools: [{ name: 'Kestrel Studio' }], suggestedEnvironmentId: DEV });
    if (r.ok) expect(r.environments.map((e) => e.name)).toEqual(['KS-DEV', 'KS-PROD']);
    expect(issuesRead).toEqual(['KAN-7']);
  });

  it('suggests nothing when the story names no environment, or names two', async () => {
    for (const summary of ['Build a usage dashboard', 'Move the dashboard from KS-DEV to KS-PROD', 'Fix the KS-DEVELOPER docs']) {
      const { d } = deps(demoWorld(), { summary, description: null });
      expect(await handleStoryContext({ accountId: PRIYA, issueKey: 'KAN-7' }, d)).toMatchObject({ ok: true, suggestedEnvironmentId: null });
    }
  });

  it('needs a signed-in person on a work item they can read', async () => {
    expect(await handleStoryContext({ issueKey: 'KAN-7' }, deps(demoWorld()).d)).toMatchObject({ ok: false });
    expect(await handleStoryContext({ accountId: PRIYA }, deps(demoWorld()).d)).toMatchObject({ ok: false });
    expect(await handleStoryContext({ accountId: PRIYA, issueKey: 'KAN-7' }, deps(demoWorld(), null).d)).toMatchObject({ ok: false });
  });
});

describe('checking the story', () => {
  it('reads the story into catalog keys like a question, answers it, and saves it with the summary', async () => {
    const { d, model, saved } = deps(demoWorld());
    const r = await handleStoryCheck({ toolId: 1, environmentId: DEV }, { accountId: PRIYA, issueKey: 'KAN-7' }, d);
    expect(r).toMatchObject({ ok: true, askId: 1, card: { title: 'Not ready', action: { kind: 'request_fix' } } });
    const sent = JSON.stringify(model.sent);
    expect(sent).toContain('Build a usage dashboard for the sales team in KS-DEV');
    expect(sent).toContain('Needs a custom web front end.');
    expect(saved).toEqual([expect.objectContaining({ askerAccountId: PRIYA, environmentId: DEV, questionText: ISSUE.summary, verdict: 'not_ready' })]);
  });

  it('KS-PROD gives No for the same story', async () => {
    const { d } = deps(demoWorld());
    expect(await handleStoryCheck({ toolId: 1, environmentId: PROD }, { accountId: PRIYA, issueKey: 'KAN-7' }, d)).toMatchObject({ ok: true, card: { title: 'No' } });
  });

  it('the work item comes from the context, never the payload; an unreadable one calls no model', async () => {
    const { d, issuesRead } = deps(demoWorld());
    await handleStoryCheck({ toolId: 1, environmentId: DEV, issueKey: 'SECRET-1' }, { accountId: PRIYA, issueKey: 'KAN-7' }, d);
    expect(issuesRead).toEqual(['KAN-7']);
    const none = deps(demoWorld(), null);
    expect(await handleStoryCheck({ toolId: 1, environmentId: DEV }, { accountId: PRIYA, issueKey: 'KAN-7' }, none.d)).toMatchObject({ ok: false, error: 'not_found' });
    expect(none.model.sent).toHaveLength(0);
    expect(await handleStoryCheck({ toolId: 1, environmentId: DEV }, { issueKey: 'KAN-7' }, d)).toMatchObject({ ok: false, error: 'not_signed_in' });
  });

  it('an environment outside the person\'s audience is refused before any model call', async () => {
    const w = demoWorld();
    w.environments.find((e) => e.id === DEV)!.audienceGroup = 'kestrel-admins';
    const { d, model, saved } = deps(w);
    expect(await handleStoryCheck({ toolId: 1, environmentId: DEV }, { accountId: PRIYA, issueKey: 'KAN-7' }, d)).toMatchObject({ ok: true, askId: null, card: { kind: 'refused' } });
    expect(model.sent).toHaveLength(0);
    expect(saved).toEqual([]);
  });
});

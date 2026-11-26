import { describe, expect, it } from 'vitest';
import { handleIssueEvent, sweepRequests } from '../../src/loop/events';
import { raiseFix, recheckAsk } from '../../src/loop/requests';
import { sameRequirement, storyComment, StoryCommentError, type Adf, type StoryLinks } from '../../src/loop/stories';
import type { StoredAsk } from '../../src/loop/requests';
import { adfText, handleStoryShare } from '../../src/resolvers/story-handlers';
import { DEV, PRIYA, SAM } from '../support/demo-world';
import { loopWorld, resolvedEvent } from '../support/fix-world';

/**
 * "Add to story" (D53): the person's own answer posted on the work item as their comment, built on the server; the
 * story remembered with the verdict it was told; one update from the app when a re-check changes the verdict.
 */

const STORY = 'KAN-7';

function memoryStories(asks: Map<number, StoredAsk>) {
  const shares: Array<{ id: number; askId: number; toolId: number; issueKey: string; verdict: string }> = [];
  const posted: Array<{ as: 'user' | 'app'; issueKey: string; body: Adf }> = [];
  const fail = { user: null as StoryCommentError | null, app: false, save: false, read: false };
  const links: StoryLinks = {
    shares: {
      async save(s) {
        if (fail.save) throw new Error('table missing');
        const held = shares.find((x) => x.askId === s.askId && x.issueKey === s.issueKey);
        if (held) held.verdict = s.verdict;
        else shares.push({ id: 900 + shares.length, ...s });
      },
      async related(ask) {
        if (fail.read) throw new Error("Table 'story_shares' doesn't exist");
        return shares
          .filter((s) => {
            const a = asks.get(s.askId);
            return a && a.askerAccountId === ask.askerAccountId && a.toolId === ask.toolId && a.environmentId === ask.environmentId && sameRequirement(a.requirement, ask.requirement);
          })
          .map(({ id, issueKey, verdict }) => ({ id, issueKey, verdict }));
      },
      async moveVerdict(id, from, to) {
        const s = shares.find((x) => x.id === id);
        if (!s || s.verdict !== from) return false;
        s.verdict = to;
        return true;
      },
    },
    comments: {
      async asUser(issueKey, body) {
        if (fail.user) throw fail.user;
        posted.push({ as: 'user', issueKey, body });
      },
      async asApp(issueKey, body) {
        if (fail.app) throw new Error('comment 500');
        posted.push({ as: 'app', issueKey, body });
      },
    },
  };
  return { shares, posted, fail, links };
}

function world() {
  const x = loopWorld();
  const s = memoryStories(x.asks);
  x.deps.stories = s.links;
  // null: opened outside a work item (no issue in the Forge context).
  const share = (askId: number, accountId = PRIYA, issueKey: string | null = STORY) =>
    handleStoryShare({ askId }, { accountId, issueKey: issueKey ?? undefined }, { loop: x.deps, stories: s.links });
  return { x, s, share };
}

/** Every text node in the document, for "no empty text" (Jira rejects those). */
function textNodes(n: unknown): Array<{ text: unknown }> {
  if (!n || typeof n !== 'object') return [];
  const o = n as { type?: unknown; text?: unknown; content?: unknown };
  return [...(o.type === 'text' ? [{ text: o.text }] : []), ...(Array.isArray(o.content) ? o.content.flatMap(textNodes) : [])];
}

describe('the comment', () => {
  it('holds the card in its fixed words: verdict, where, reason, the four stamps with evidence, the path, and who it was checked for', async () => {
    const { x } = world();
    const now = (await recheckAsk((await x.deps.loadAsk(x.addAsk(DEV)))!, x.deps))!;
    const doc = storyComment(now.card, { toolName: 'Kestrel Studio', asker: PRIYA });
    const words = adfText(doc);
    expect(words).toContain("Tool Passport: Not ready · Kestrel Studio in KS-DEV · 13.2 Frontend build isn't set up in KS-DEV.");
    expect(words).toContain('Tool can do it: Yes (Owner-verified · 13.2)');
    expect(words).toContain('Policy allows it: Needs approval (Policy rule · Needs design review)');
    expect(words).toContain('Set up here: Missing · Frontend build (Assets record · Build environments)');
    expect(words).toContain('You have access: Yes (Mapped access · kestrel-dev-builders)');
    expect(words).toContain('Path to Yes: Asked → Set up frontend build → Get approval → Yes');
    expect(words).toContain('Access and approvals are personal');
    expect(JSON.stringify(doc)).toContain(JSON.stringify({ type: 'mention', attrs: { id: PRIYA } }));
    for (const t of textNodes(doc)) expect(typeof t.text === 'string' && t.text.length > 0).toBe(true);
  });
});

describe('Add to story', () => {
  it("posts the person's own answer as their comment on the panel's work item, and remembers the story", async () => {
    const { x, s, share } = world();
    const askId = x.addAsk(DEV);
    expect(await share(askId)).toMatchObject({ ok: true, verdict: 'not_ready', following: true, card: { verdict: 'not_ready' } });
    expect(s.posted).toHaveLength(1);
    expect(s.posted[0]).toMatchObject({ as: 'user', issueKey: STORY });
    expect(s.shares).toEqual([{ id: 900, askId, toolId: 1, issueKey: STORY, verdict: 'not_ready' }]);
    // Adding the same answer again comments again and keeps one remembered story.
    await share(askId);
    expect(s.shares).toHaveLength(1);
  });

  it("never posts someone else's answer, and needs a signed-in person and a work item from the context", async () => {
    const { x, s, share } = world();
    const priyas = x.addAsk(DEV);
    expect(await share(priyas, SAM)).toMatchObject({ ok: false, error: 'not_found' });
    expect(await handleStoryShare({ askId: priyas }, { issueKey: STORY }, { loop: x.deps, stories: s.links })).toMatchObject({ ok: false, error: 'not_signed_in' });
    expect(await share(priyas, PRIYA, null)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await share(-1)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(s.posted).toEqual([]);
    expect(s.shares).toEqual([]);
  });

  it('someone who may not comment gets told so, and nothing is remembered', async () => {
    const { x, s, share } = world();
    s.fail.user = new StoryCommentError('not_allowed', 'comment 403');
    expect(await share(x.addAsk(DEV))).toMatchObject({ ok: false, error: 'not_allowed', message: "You can't comment on this work item, so the answer wasn't added." });
    expect(s.shares).toEqual([]);
  });

  it('a comment posted but not remembered says no update will follow', async () => {
    const { x, s, share } = world();
    s.fail.save = true;
    expect(await share(x.addAsk(DEV))).toMatchObject({ ok: true, following: false });
    expect(s.posted).toHaveLength(1);
  });
});

describe('the update after a request is resolved', () => {
  async function sharedAndFixed() {
    const w = world();
    const askId = w.x.addAsk(DEV);
    await w.share(askId);
    expect(await raiseFix(askId, PRIYA, w.x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
    w.x.w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
    w.x.jsm.resolutions.set('TPD-1', 'Done');
    return { ...w, askId };
  }

  it('the app adds the new answer to the story once, naming the request', async () => {
    const { x, s } = await sharedAndFixed();
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    const updates = s.posted.filter((p) => p.as === 'app');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.issueKey).toBe(STORY);
    const words = adfText(updates[0]!.body);
    expect(words).toContain('Tool Passport update: Yes, with approval (was Not ready) · Kestrel Studio in KS-DEV · 13.2');
    expect(words).toContain('Path to Yes: Asked → Get approval → Yes');
    expect(words).toContain('after TPD-1 was resolved.');
    expect(s.shares[0]!.verdict).toBe('yes_with_approval');
    // The request still gets its own comment.
    expect(x.jsm.comments.at(-1)!.body).toContain('Answer now: Yes, with approval.');

    // The same resolution again (a second event, the sweep) adds nothing.
    await handleIssueEvent(resolvedEvent('TPD-1'), x.deps);
    await sweepRequests(x.deps, 25);
    expect(s.posted.filter((p) => p.as === 'app')).toHaveLength(1);
  });

  it('the story hears about the same question asked again: checking the story again makes a new ask (found live)', async () => {
    const { x, s, share } = world();
    await share(x.addAsk(DEV));
    // The panel checked the story again, and the fix was requested from that newer answer.
    const again = x.addAsk(DEV);
    expect(await raiseFix(again, PRIYA, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
    // The same story added twice, from both answers: it still hears once.
    await share(again);
    expect(s.shares).toHaveLength(2);
    x.w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(s.posted.filter((p) => p.as === 'app')).toHaveLength(1);
    expect(s.shares.map((r) => r.verdict)).toEqual(['yes_with_approval', 'yes_with_approval']);
  });

  it("never tells a story about someone else's question, another environment or other keys", async () => {
    const { x, s, share } = world();
    await share(x.addAsk(DEV, PRIYA, [{ key: 'max_upload_gb', value: 3 }])); // another question
    await share(x.addAsk(null)); // Any environment
    const sams = x.addAsk(DEV, SAM);
    x.asks.set(sams, { ...x.asks.get(sams)!, askerAccountId: SAM });
    s.shares.push({ id: 990, askId: sams, toolId: 1, issueKey: 'KAN-9', verdict: 'not_ready' }); // Sam's own share
    const priyas = x.addAsk(DEV);
    expect(await raiseFix(priyas, PRIYA, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
    x.w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(s.posted.filter((p) => p.as === 'app')).toEqual([]);
  });

  it('the same question means the same keys and values, in any order', () => {
    expect(sameRequirement([{ key: 'web_frontend' }, { key: 'max_upload_gb', value: 3 }], [{ key: 'max_upload_gb', value: 3 }, { key: 'web_frontend' }])).toBe(true);
    expect(sameRequirement([{ key: 'max_upload_gb', value: 3 }], [{ key: 'max_upload_gb', value: 5 }])).toBe(false);
    expect(sameRequirement(null, null)).toBe(false);
    expect(sameRequirement([], [])).toBe(false);
  });

  it('no update when the verdict did not change', async () => {
    const { x, s } = await sharedAndFixed();
    x.w.records.get(DEV)!['Build environments'] = ['standard']; // resolved without the fix
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(s.posted.filter((p) => p.as === 'app')).toEqual([]);
    expect(s.shares[0]!.verdict).toBe('not_ready');
  });

  it('a failing story never stops the request loop', async () => {
    const failing = await sharedAndFixed();
    failing.s.fail.app = true;
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), failing.x.deps)).toBe('rechecked');
    expect(failing.x.logs.some((l) => l.startsWith('[story] update on KAN-7 failed'))).toBe(true);

    const unreadable = await sharedAndFixed();
    unreadable.s.fail.read = true;
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), unreadable.x.deps)).toBe('rechecked');
    expect(unreadable.x.jsm.comments.at(-1)!.body).toContain('Answer now: Yes, with approval.');
  });

  it('without stories wired in, the loop behaves as before', async () => {
    const { x } = await sharedAndFixed();
    delete x.deps.stories;
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
  });
});

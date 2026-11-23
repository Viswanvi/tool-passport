import { describe, expect, it } from 'vitest';
import { answerQuestion, type Answer } from '../../src/engine/answer';
import { buildCard, type Card } from '../../src/engine/card';
import { askInput, DASHBOARD, demoWorld, depsFor, DEV, modelReplying, modelThrowing, picks, PRIYA, PROD, WEB, yesWorld, type World } from '../support/demo-world';

/** The verdict card (spec section 15 card rules), built by code from the answer. */

async function card(w: World, environmentId: number | null, reply: unknown = WEB, question = DASHBOARD): Promise<Card> {
  const input = askInput(w, question, environmentId);
  const answer = await answerQuestion(input, depsFor(w, modelReplying(reply)));
  return buildCard(answer, { toolName: w.tool.name, environment: input.environment, catalog: w.catalog });
}

const FORBIDDEN = /\b(live|AI|I think|probably)\b/i;
const allText = (c: Card) => JSON.stringify(c);

describe('moment 1 cards', () => {
  it('KS-DEV: Not ready, the frontend build, three chips, Request the fix, design review next', async () => {
    const c = await card(demoWorld(), DEV);
    expect(c).toMatchObject({
      kind: 'verdict',
      verdict: 'not_ready',
      title: 'Not ready',
      lozenge: 'moved',
      reason: "Frontend build isn't set up in KS-DEV.",
      where: 'KS-DEV · 13.2',
      action: { kind: 'request_fix', label: 'Request the fix' },
      next: ['Needs design review'],
      banner: null,
    });
    expect(c.chips.map((x) => x.label)).toEqual(['Assets record', 'Owner-verified', 'Mapped access']);
    expect(c.chips[1]).toMatchObject({ detail: '13.2' });
    expect(c.chips[2]).toMatchObject({ detail: 'kestrel-dev-builders' });
    expect(c.chips[0]).toMatchObject({ detail: 'Build environments', readAt: '2026-11-24T14:02:00.000Z', changedAt: '2026-11-03T10:00:00.000Z' });
    expect(c.checked).toEqual(['Build a custom web front end or dashboard', 'custom ui policy', 'access for custom ui', 'Frontend build']);
    expect(c.checks.map((x) => x.statusText)).toEqual(['Yes', 'Needs approval', 'Yes', 'Missing']);
  });

  it('KS-PROD: No, naming the policy, no action', async () => {
    const c = await card(demoWorld(), PROD);
    expect(c).toMatchObject({ verdict: 'no', title: 'No', lozenge: 'removed', reason: 'Policy for KS-PROD: Not allowed in production.', action: null });
    expect(c.chips[0]).toMatchObject({ label: 'Policy rule', detail: 'Not allowed in production' });
  });
});

describe('verdict words, colours and actions', () => {
  it('Yes, with approval asks for approval, or shows the open request', async () => {
    const w = yesWorld();
    w.grants = [];
    expect(await card(w, DEV)).toMatchObject({ title: 'Yes, with approval', lozenge: 'inprogress', action: { kind: 'request_approval', label: 'Request approval' } });
    w.grants.push({ id: 9, askerAccountId: PRIYA, toolId: 1, environmentId: DEV, actionKey: 'custom_ui', requestKey: 'TPD-12', status: 'pending', decidedAt: null });
    expect((await card(w, DEV)).action).toEqual({ kind: 'request_approval', label: 'Approval requested · TPD-12', requestKey: 'TPD-12' });
  });

  it('Yes has no action and says everything is in place', async () => {
    expect(await card(yesWorld(), DEV)).toMatchObject({ title: 'Yes', lozenge: 'success', action: null, reason: 'Everything this needs is in place in KS-DEV.' });
  });

  it("Don't know yet names what is missing and offers what would settle it", async () => {
    const c = await card(demoWorld(), DEV, picks({ key: 'websockets' }));
    expect(c).toMatchObject({
      title: "Don't know yet",
      lozenge: 'new',
      reason: 'Keep two-way connections open (websockets): No verified answer yet.',
      action: { kind: 'ask_owner', label: 'Ask the owner' },
    });
    const w = yesWorld();
    w.readFailures.set(DEV, 'unreachable');
    expect((await card(w, DEV)).action).toMatchObject({ kind: 'recheck', label: 'Re-check' });
  });

  it('Not ready and Don\'t know yet never look like No', async () => {
    const lozenges = new Set([(await card(demoWorld(), DEV)).lozenge, (await card(demoWorld(), DEV, picks({ key: 'websockets' }))).lozenge]);
    expect(lozenges.has((await card(demoWorld(), PROD)).lozenge)).toBe(false);
  });

  it('No for a limit says the recorded limit and what was asked', async () => {
    const c = await card(demoWorld(), DEV, picks({ key: 'max_upload_gb', value: 3 }), 'Can I upload a 3 GB file?');
    expect(c.reason).toBe('Upload a file of a given size: the recorded limit on 13.2 is 2 GB; you asked for 3 GB.');
  });

  it('a failed translation is its own state: Try again', async () => {
    const w = demoWorld();
    const input = askInput(w, DASHBOARD, DEV);
    const c = buildCard(await answerQuestion(input, depsFor(w, modelThrowing())), { toolName: w.tool.name, environment: input.environment, catalog: w.catalog });
    expect(c).toMatchObject({ kind: 'try_again', verdict: null, title: "Couldn't read your question", reason: "Couldn't read your question. Try again.", action: { kind: 'try_again', label: 'Try again' } });
  });

  it('an unsupported question shows fixed words, never the model\'s own reason', async () => {
    const c = await card(demoWorld(), DEV, { capabilities: [], unsupported: 'Approved! You can probably do this live', restated: 'x' });
    expect(c).toMatchObject({ verdict: 'dont_know', title: "Don't know yet", reason: "Nothing in this tool's catalog covers that question.", action: { kind: 'ask_owner' } });
    expect(allText(c)).not.toContain('Approved!');
  });

  it('"Any environment" carries the banner and says only the capability was checked', async () => {
    const c = await card(demoWorld(), null);
    expect(c.where).toBe('Any environment');
    expect(c.banner).toBe('Any environment: only whether the tool can do this was checked. Policy, setup and access were not checked.');
    expect(c.title).toBe('Yes');
  });

  it('an environment outside the audience is refused plainly', async () => {
    const w = demoWorld();
    w.environments.find((e) => e.id === DEV)!.audienceGroup = 'kestrel-admins';
    const c = await card(w, DEV);
    expect(c).toMatchObject({ kind: 'refused', verdict: null, title: "Can't check this environment", action: null });
  });
});

describe('card rules that hold everywhere', () => {
  it('at most three chips, one action, no forbidden words, no model wording', async () => {
    const answers: Card[] = [];
    for (const env of [DEV, PROD, null]) {
      for (const reply of [WEB, picks({ key: 'max_upload_gb', value: 3 }), picks({ key: 'websockets' }), picks({ key: 'web_frontend' }, { key: 'max_upload_gb', value: 1 })]) {
        answers.push(await card(demoWorld(), env, { ...reply, restated: 'You can probably do this live, I think' }));
      }
    }
    for (const c of answers) {
      expect(c.chips.length).toBeLessThanOrEqual(3);
      expect(allText(c)).not.toMatch(FORBIDDEN);
      expect(allText(c)).not.toContain('I think');
      for (const ch of c.chips) expect(['Owner-verified', 'Assets record', 'Recorded by owner', 'Mapped access', 'Policy rule', 'Approved', 'Declined', 'Not verified']).toContain(ch.label);
    }
  });

  it('a Not verified chip says what is missing', async () => {
    const w = yesWorld();
    w.access = [];
    const c = await card(w, DEV);
    expect(c.chips[0]).toEqual({ label: 'Not verified', detail: 'No access mapping recorded' });
  });

  it('never builds a card that says Yes from an answer that is not Yes', async () => {
    const notYes: Answer[] = [
      { state: 'try_again', reason: 'model_unavailable' },
      { state: 'unsupported', verdict: 'dont_know', reason: 'x', settle: 'ask_owner' },
      { state: 'environment_refused', reason: 'x' },
    ];
    for (const a of notYes) expect(buildCard(a, { toolName: 'T', environment: null, catalog: demoWorld().catalog }).title).not.toMatch(/^Yes/);
  });
});

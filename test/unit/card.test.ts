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

describe('passport stamps: one per check kind, built by code from the checks', () => {
  it('KS-DEV: the tool can, policy needs approval, frontend build missing, access yes', async () => {
    const c = await card(demoWorld(), DEV);
    expect(c.stamps.map((s) => [s.dimension, s.title, s.state, s.statusText])).toEqual([
      ['capability', 'Tool can do it', 'pass', 'Yes'],
      ['policy', 'Policy allows it', 'approval', 'Needs approval'],
      ['environment', 'Set up here', 'missing', 'Missing'],
      ['access', 'You have access', 'pass', 'Yes'],
    ]);
    expect(c.stamps[0]).toMatchObject({ detail: null, chip: { label: 'Owner-verified', detail: '13.2' }, more: 0 });
    expect(c.stamps[1]).toMatchObject({ chip: { label: 'Policy rule', detail: 'Needs design review' } });
    expect(c.stamps[2]).toMatchObject({ detail: 'Frontend build', chip: { label: 'Assets record', readAt: '2026-11-24T14:02:00.000Z' } });
    expect(c.stamps[3]).toMatchObject({ chip: { label: 'Mapped access', detail: 'kestrel-dev-builders' } });
  });

  it('KS-PROD: the policy stamp says No and names the rule', async () => {
    const c = await card(demoWorld(), PROD);
    expect(c.stamps[1]).toMatchObject({ dimension: 'policy', state: 'fail', statusText: 'No', chip: { label: 'Policy rule', detail: 'Not allowed in production' } });
  });

  it('Any environment: only the tool stamp is checked; the rest say Not checked', async () => {
    const c = await card(demoWorld(), null);
    expect(c.stamps.map((s) => s.state)).toEqual(['pass', 'not_checked', 'not_checked', 'not_checked']);
    for (const s of c.stamps.slice(1)) expect(s).toMatchObject({ statusText: 'Not checked', chip: null, detail: null, more: 0 });
  });

  it('an unverified capability is a Not verified stamp that names it, never a Yes', async () => {
    const c = await card(demoWorld(), DEV, picks({ key: 'websockets' }));
    expect(c.stamps[0]).toMatchObject({ dimension: 'capability', state: 'unknown', statusText: 'Not verified' });
    expect(c.stamps[0]!.detail).toContain('websockets');
  });

  it('cards with no checks have no stamps', async () => {
    expect((await card(demoWorld(), DEV, { capabilities: [], unsupported: 'x', restated: 'x' })).stamps).toEqual([]);
    const a: Answer = { state: 'try_again', reason: 'model_unavailable' };
    expect(buildCard(a, { toolName: 'T', environment: null, catalog: demoWorld().catalog }).stamps).toEqual([]);
  });
});

describe('the path to Yes', () => {
  it('KS-DEV: asked, set up the frontend build, get approval, Yes', async () => {
    const c = await card(demoWorld(), DEV);
    expect(c.path).toEqual([
      { id: 'asked', kind: 'asked', label: 'Asked', state: 'done' },
      { id: 'ready:frontend_build', kind: 'fix', label: 'Set up frontend build', state: 'todo' },
      { id: 'approval:custom_ui', kind: 'approval', label: 'Get approval', state: 'todo' },
      { id: 'yes', kind: 'yes', label: 'Yes', state: 'todo' },
    ]);
  });

  it('Yes, with approval: asked, get approval, Yes; a pending approval shows its request', async () => {
    const w = yesWorld();
    w.grants = [];
    expect((await card(w, DEV)).path.map((s) => s.label)).toEqual(['Asked', 'Get approval', 'Yes']);
    w.grants.push({ id: 9, askerAccountId: PRIYA, toolId: 1, environmentId: DEV, actionKey: 'custom_ui', requestKey: 'TPD-12', status: 'pending', decidedAt: null });
    expect((await card(w, DEV)).path[1]).toEqual({ id: 'approval:custom_ui', kind: 'approval', label: 'Get approval · TPD-12', state: 'requested', requestKey: 'TPD-12' });
  });

  it('No, Yes, Don\'t know yet and Any environment have no path', async () => {
    expect((await card(demoWorld(), PROD)).path).toEqual([]);
    expect((await card(yesWorld(), DEV)).path).toEqual([]);
    expect((await card(demoWorld(), DEV, picks({ key: 'websockets' }))).path).toEqual([]);
    expect((await card(demoWorld(), null)).path).toEqual([]);
  });
});

describe('card rules that hold everywhere', () => {
  it('a stamp says Yes only when every check under it passed, and shows the worst one', async () => {
    const rank = ['pass', 'approval', 'missing', 'unknown', 'fail'];
    const w = yesWorld();
    w.access = [];
    const cards: Card[] = [await card(w, DEV)];
    for (const env of [DEV, PROD, null]) {
      for (const reply of [WEB, picks({ key: 'max_upload_gb', value: 3 }), picks({ key: 'websockets' }), picks({ key: 'web_frontend' }, { key: 'max_upload_gb', value: 1 })]) {
        cards.push(await card(demoWorld(), env, reply));
      }
    }
    for (const c of cards) {
      for (const s of c.stamps) {
        const under = c.checks.filter((x) => (s.dimension === 'capability' ? x.dimension === 'capability' || x.dimension === 'unlinked' : x.dimension === s.dimension));
        if (s.state === 'not_checked' || s.state === 'none') {
          expect(under).toEqual([]);
          continue;
        }
        const worst = under.map((x) => x.status).sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0];
        expect(s.state).toBe(worst);
        if (s.state === 'pass') expect(under.every((x) => x.status === 'pass')).toBe(true);
        expect(s.more).toBe(under.length - 1);
      }
    }
  });

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

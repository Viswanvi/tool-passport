import { describe, expect, it } from 'vitest';
import { handleIssueEvent } from '../../src/loop/events';
import { raiseQuestion, recheckForAsker } from '../../src/loop/requests';
import { handleMyTools, handleOpenQuestions, handlePublishAnswer, type OwnerDeps } from '../../src/resolvers/owner-handlers';
import { DEV, MARCO, PRIYA, PROD, SAM } from '../support/demo-world';
import { loopWorld, memoryWriter, resolvedEvent } from '../support/fix-world';

/**
 * Ask the owner (spec F5, section 11 `publishAnswer`, section 16 "the unknown loop"). Don't know yet → a
 * private question request for the asker, routed to the tool owner, holding the restated requirement and what
 * isn't verified, never the question text. The owner answers once; publishing adds a fact verification and
 * re-checks every open question for the tool, commenting and resolving the ones now decided. Askers never
 * see each other's requests.
 */

const WS = [{ key: 'websockets' }];
const WEB = [{ key: 'web_frontend' }];

function ownerWorld(admin = false) {
  const x = loopWorld();
  const writer = memoryWriter(x.w);
  const deps: OwnerDeps = {
    loop: x.deps,
    writer,
    check: { isJiraAdmin: async () => admin },
    listTools: async () => [{ id: x.w.tool.id, name: x.w.tool.name }],
    listEnvironments: async () => x.w.environments,
  };
  return { ...x, writer, owner: deps };
}

/** Priya and Sam ask about websockets in KS-DEV in their own words; each asks the owner. */
async function twoAskers(samEnv = DEV) {
  const x = ownerWorld();
  const priya = x.addAsk(DEV, PRIYA, WS);
  const sam = x.addAsk(samEnv, SAM, WS);
  expect(await raiseQuestion(priya, PRIYA, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
  expect(await raiseQuestion(sam, SAM, x.deps)).toMatchObject({ ok: true, raised: ['TPD-2'] });
  return { x, priya, sam };
}

const answer = (over: Record<string, unknown> = {}) => ({ toolId: 1, key: 'websockets', value: true, environmentId: null, version: '13.2.1', everyVersion: true, ...over });

describe('Ask the owner', () => {
  it('raises one private question for the asker, routed to the tool owner, with the requirement and what is not verified', async () => {
    const x = ownerWorld();
    x.w.environments[0]!.ownerAccountId = 'acct-env-owner';
    const askId = x.addAsk(DEV, PRIYA, WS);
    const r = await raiseQuestion(askId, PRIYA, x.deps);
    expect(r).toMatchObject({ ok: true, raised: ['TPD-1'], card: { verdict: 'dont_know', action: { kind: 'owner_asked', label: 'Question sent', requests: [{ key: 'TPD-1', ownerAccountId: MARCO }] } } });
    const c = x.jsm.created[0]!;
    expect(c.raiseOnBehalfOf).toBe(PRIYA);
    expect(c.summary).toBe('Question about Kestrel Studio: Keep two-way connections open (websockets)');
    expect(c.description).toContain('in KS-DEV');
    expect(c.description).toContain('Not verified yet: Keep two-way connections open (websockets): No verified answer yet.');
    expect(c.description).toContain('My tools');
    // Questions go to the tool owner, whoever owns the environment.
    expect(x.jsm.assigned).toEqual([{ issueKey: 'TPD-1', accountId: MARCO }]);
    expect(x.requests.rows[0]).toMatchObject({ kind: 'question', status: 'open', target: expect.stringMatching(/^question:[0-9a-f]{64}$/) });
  });

  it('gives each asker their own request for the same requirement, and one request per person', async () => {
    const { x, priya } = await twoAskers();
    expect(x.jsm.created.map((c) => c.raiseOnBehalfOf)).toEqual([PRIYA, SAM]);
    expect(x.requests.rows[0]!.target).toBe(x.requests.rows[1]!.target);
    // Sam's request holds nothing of Priya's: both are built from the requirement only.
    expect(x.jsm.created[1]!.description).toBe(x.jsm.created[0]!.description);
    expect(await raiseQuestion(priya, PRIYA, x.deps)).toMatchObject({ ok: true, raised: [] });
    expect(x.jsm.created).toHaveLength(2);
  });

  it('asks nothing when the answer is not Don\'t know yet, or there are no keys to ask about', async () => {
    const x = ownerWorld();
    expect(await raiseQuestion(x.addAsk(DEV, PRIYA, WEB), PRIYA, x.deps)).toMatchObject({ ok: true, raised: [], card: { verdict: 'not_ready' } });
    expect(await raiseQuestion(x.addAsk(DEV, PRIYA, null), PRIYA, x.deps)).toMatchObject({ ok: true, raised: [], card: { verdict: 'dont_know' } });
    expect(x.jsm.created).toHaveLength(0);
  });

  it("refuses another person's ask", async () => {
    const x = ownerWorld();
    expect(await raiseQuestion(x.addAsk(DEV, PRIYA, WS), SAM, x.deps)).toMatchObject({ ok: false, error: 'not_found' });
    expect(x.jsm.created).toHaveLength(0);
  });

  it('works for an "Any environment" question too', async () => {
    const x = ownerWorld();
    expect(await raiseQuestion(x.addAsk(null, PRIYA, WS), PRIYA, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
    expect(x.jsm.created[0]!.description).toContain('in any environment');
  });
});

describe('the owner answers once', () => {
  it('publishing adds a verified fact and settles every open question it decides, each on its own request', async () => {
    const { x, priya, sam } = await twoAskers();
    const r = await handlePublishAnswer(answer(), { accountId: MARCO }, x.owner);
    expect(r).toEqual({ ok: true, settled: ['TPD-1', 'TPD-2'], stillOpen: 0 });
    expect(x.w.facts.find((f) => f.factKey === 'websockets')).toMatchObject({ environmentId: null, audienceGroup: null, versionSensitive: false, status: 'active' });
    const fact = x.w.facts.find((f) => f.factKey === 'websockets')!;
    // 13.2.1 is read at the tool's granularity (minor).
    expect(x.w.factVersions.find((v) => v.factId === fact.id)).toMatchObject({ version: '13.2', value: true, verifiedBy: MARCO });
    expect(x.w.tool.catalogRevision).toBe(2);
    expect(x.writer.audits).toEqual([{ actor: MARCO, action: 'fact.published', after: expect.objectContaining({ key: 'websockets', version: '13.2', value: true }) }]);
    expect(x.jsm.comments.map((c) => c.issueKey)).toEqual(['TPD-1', 'TPD-2']);
    for (const c of x.jsm.comments) {
      expect(c.body).toContain('The tool owner answered in Tool Passport.');
      expect(c.body).toContain('Answer now: Yes.');
    }
    expect(x.jsm.resolvedByApp).toEqual(['TPD-1', 'TPD-2']);
    expect(x.requests.rows.map((r) => r.status)).toEqual(['closed', 'closed']);
    expect(await recheckForAsker(priya, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'yes' } });
    expect(await recheckForAsker(sam, SAM, x.deps)).toMatchObject({ ok: true, card: { verdict: 'yes' } });
    // The app resolving the request fires an event; it settles nothing twice.
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('already');
    expect(x.jsm.comments).toHaveLength(2);
  });

  it('an answer for one environment and version settles only the questions it decides', async () => {
    const { x } = await twoAskers(PROD);
    const r = await handlePublishAnswer(answer({ environmentId: DEV, everyVersion: false, version: '13.2' }), { accountId: MARCO }, x.owner);
    expect(r).toEqual({ ok: true, settled: ['TPD-1'], stillOpen: 1 });
    expect(x.jsm.comments.map((c) => c.issueKey)).toEqual(['TPD-1']);
    expect(x.requests.rows[1]!.status).toBe('open');
  });

  it('"No" is an answer too: the question closes with No', async () => {
    const { x, priya } = await twoAskers();
    expect(await handlePublishAnswer(answer({ value: false }), { accountId: MARCO }, x.owner)).toMatchObject({ ok: true, stillOpen: 0 });
    expect(x.jsm.comments[0]!.body).toContain('Answer now: No.');
    expect(await recheckForAsker(priya, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'no' } });
  });

  it('an answer about something else leaves the question open, with no comment', async () => {
    const { x } = await twoAskers();
    expect(await handlePublishAnswer(answer({ key: 'gpu_compute' }), { accountId: MARCO }, x.owner)).toEqual({ ok: true, settled: [], stillOpen: 2 });
    expect(x.jsm.comments).toEqual([]);
    expect(x.requests.rows.map((r) => r.status)).toEqual(['open', 'open']);
  });

  it('a request the app could not resolve still gets the answer, and says so in the log', async () => {
    const { x } = await twoAskers();
    x.jsm.failResolve = true;
    expect(await handlePublishAnswer(answer(), { accountId: MARCO }, x.owner)).toMatchObject({ ok: true, settled: ['TPD-1', 'TPD-2'] });
    expect(x.jsm.comments).toHaveLength(2);
    expect(x.logs.join('\n')).toContain('TPD-1 was answered but not resolved');
  });

  it('only the tool owner or a Jira administrator may publish, and nothing is written otherwise', async () => {
    const { x } = await twoAskers();
    expect(await handlePublishAnswer(answer(), { accountId: SAM }, x.owner)).toMatchObject({ ok: false });
    expect(await handlePublishAnswer(answer(), {}, x.owner)).toMatchObject({ ok: false });
    expect(x.w.facts.some((f) => f.factKey === 'websockets')).toBe(false);
    expect(x.jsm.comments).toEqual([]);
    const admin = { ...x.owner, check: { isJiraAdmin: async () => true } };
    expect(await handlePublishAnswer(answer(), { accountId: SAM }, admin)).toMatchObject({ ok: true });
  });

  it('accepts only a capability key of the catalog, a value of its type, a readable version and an environment of the tool', async () => {
    const { x } = await twoAskers();
    const bad = [
      answer({ key: 'not_a_key' }),
      answer({ key: 'external_sharing' }), // a policy action: rules, not facts
      answer({ value: 'yes' }),
      answer({ key: 'max_upload_gb', value: 'big' }),
      answer({ key: 'max_upload_gb', value: Number.NaN }),
      answer({ version: 'banana' }),
      answer({ environmentId: 999 }),
      answer({ toolId: 9 }),
      { ...answer(), value: undefined },
    ];
    for (const p of bad) expect(await handlePublishAnswer(p, { accountId: MARCO }, x.owner), JSON.stringify(p)).toMatchObject({ ok: false });
    expect(x.w.facts.some((f) => f.factKey === 'websockets')).toBe(false);
    expect(await handlePublishAnswer(answer({ key: 'max_upload_gb', value: 5 }), { accountId: MARCO }, x.owner)).toMatchObject({ ok: true });
  });

  it('a question the owner resolves in the service desk is checked again and gets the verdict', async () => {
    const { x } = await twoAskers();
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.jsm.comments[0]!.body).toContain("Answer now: Don't know yet.");
    expect(x.requests.rows[0]!.status).toBe('closed');
  });
});

describe("the owner's view", () => {
  it('groups open questions by requirement, with what is missing and the requests, for the owner only', async () => {
    const { x } = await twoAskers();
    const view = await handleOpenQuestions({ toolId: 1 }, { accountId: MARCO }, x.owner);
    expect(view).toMatchObject({
      ok: true,
      tool: { id: 1, name: 'Kestrel Studio' },
      environments: [
        { id: DEV, name: 'KS-DEV', version: '13.2' },
        { id: PROD, name: 'KS-PROD', version: '13.2' },
      ],
      groups: [
        {
          environments: ['KS-DEV'],
          keys: [{ key: 'websockets', label: 'Keep two-way connections open (websockets)', valueType: 'boolean' }],
          missing: ['Keep two-way connections open (websockets): No verified answer yet'],
          requests: [{ key: 'TPD-1' }, { key: 'TPD-2' }],
        },
      ],
    });
    expect(await handleOpenQuestions({ toolId: 1 }, { accountId: SAM }, x.owner)).toMatchObject({ ok: false });
  });

  it('lists the tools a person owns; a Jira administrator sees every tool', async () => {
    const x = ownerWorld();
    expect(await handleMyTools({ accountId: MARCO }, x.owner)).toEqual({ tools: [{ id: 1, name: 'Kestrel Studio' }] });
    expect(await handleMyTools({ accountId: SAM }, x.owner)).toEqual({ tools: [] });
    expect(await handleMyTools({}, x.owner)).toEqual({ tools: [] });
    const admin = ownerWorld(true);
    expect(await handleMyTools({ accountId: SAM }, admin.owner)).toEqual({ tools: [{ id: 1, name: 'Kestrel Studio' }] });
  });
});

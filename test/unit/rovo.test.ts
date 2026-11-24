import { describe, expect, it, vi } from 'vitest';
import type { SavedAsk } from '../../src/db/asks';
import type { AskHandlerDeps } from '../../src/resolvers/handlers';
import { accountIdOf, rovoAskOwner, rovoCheck, type RovoDeps } from '../../src/rovo/actions';
import { DASHBOARD, demoWorld, depsFor, DEV, MARCO, modelReplying, picks, PRIYA, SAM, WEB, type World } from '../support/demo-world';
import { loopWorld } from '../support/fix-world';

/**
 * The Rovo actions (spec F8, section 14). `check-tool-readiness` takes a tool, an environment and a question by
 * name, runs the same ask as the page for the person in the Forge context, and returns the verdict with its
 * labels. `ask-tool-owner` raises the private question for that person's own ask. Neither takes an account id:
 * the caller is `context.principal.accountId` (the Forge function-arguments page), never an input the model
 * filled in.
 */

const as = (accountId: string | undefined) => (accountId ? { principal: { accountId } } : {});
const WS = picks({ key: 'websockets' });

function rovoWorld(w: World = demoWorld(), reply: unknown = WEB) {
  const base = depsFor(w, modelReplying(reply));
  const saved: SavedAsk[] = [];
  const groupsRead: string[] = [];
  const x = loopWorld(w);
  const ask: AskHandlerDeps = {
    loadTool: async (id) => (id === w.tool.id ? w.tool : null),
    loadEnvironment: async (id) => w.environments.find((e) => e.id === id) ?? null,
    loadCatalog: async () => w.catalog,
    readGroups: async (accountId) => {
      groupsRead.push(accountId);
      return w.groups.get(accountId) ?? { ok: false };
    },
    chat: () => base.chat,
    repo: base.repo,
    environments: base.environments,
    saveAsk: async (a) => {
      saved.push(a);
      return x.addAsk(a.environmentId, a.askerAccountId, a.requirement);
    },
  };
  const listTools = vi.fn(async () => [{ id: w.tool.id, name: w.tool.name }]);
  const deps: RovoDeps = { ask, listTools, listEnvironments: async () => w.environments, loop: x.deps };
  return { w, x, deps, saved, groupsRead, listTools };
}

describe('who is asking', () => {
  it('is the principal in the Forge context, nothing else', () => {
    expect(accountIdOf({ principal: { accountId: PRIYA } })).toBe(PRIYA);
    for (const c of [undefined, null, {}, { accountId: PRIYA }, { principal: {} }, { principal: { accountId: '' } }, { principal: { accountId: 7 } }, { context: { accountId: PRIYA } }]) {
      expect(accountIdOf(c)).toBeUndefined();
    }
  });
});

describe('check-tool-readiness', () => {
  it('answers for the person in the context, by tool and environment name, with the verdict and its labels', async () => {
    const r = rovoWorld();
    const reply = await rovoCheck({ tool: ' kestrel studio ', environment: 'ks-dev', question: DASHBOARD, accountId: SAM }, as(PRIYA), r.deps);
    expect(reply).toMatchObject({
      ok: true,
      verdict: 'Not ready',
      reason: "Frontend build isn't set up in KS-DEV.",
      where: 'KS-DEV · 13.2',
    });
    if (!reply.ok) return;
    expect(reply.evidence.map((e) => e.split(' · ')[0])).toEqual(expect.arrayContaining(['Assets record', 'Owner-verified', 'Mapped access']));
    expect(reply.nextStep).toContain('Request the fix');
    expect(reply.nextStep).toContain('Tool Passport');
    expect(reply.askId).toEqual(expect.any(Number));
    // The account id in the input changed nothing.
    expect(r.groupsRead).toEqual([PRIYA]);
    expect(r.saved[0]!.askerAccountId).toBe(PRIYA);
  });

  // Found live: a Rovo Studio agent with no instructions reused the check and opened with "No, you cannot…" for
  // Not ready. Another agent sees only the reply, so the reply says how to report it.
  it('tells any agent to keep the verdict word: Not ready is not a No', async () => {
    const reply = await rovoCheck({ tool: 'Kestrel Studio', environment: 'KS-DEV', question: DASHBOARD }, as(PRIYA), rovoWorld().deps);
    if (!reply.ok) throw new Error('no reply');
    expect(reply.answer).toBe("Not ready. Frontend build isn't set up in KS-DEV.");
    expect(reply.howToReport).toContain('exact words');
    expect(reply.howToReport).toContain('Not ready');
    expect(reply.howToReport).toContain('not a No');
    expect(reply.howToReport).toContain("Don't know yet");
  });

  it('without a principal, refuses and reads nothing', async () => {
    const r = rovoWorld();
    for (const c of [undefined, {}, { accountId: PRIYA }]) {
      expect(await rovoCheck({ tool: 'Kestrel Studio', environment: 'KS-DEV', question: DASHBOARD, accountId: PRIYA }, c, r.deps)).toMatchObject({ ok: false, problem: 'not_signed_in' });
    }
    expect(r.listTools).not.toHaveBeenCalled();
    expect(r.saved).toEqual([]);
  });

  it('an unknown tool lists the tools; an unknown environment lists only the ones this person may pick', async () => {
    const r = rovoWorld();
    expect(await rovoCheck({ tool: 'Nope', environment: 'KS-DEV', question: DASHBOARD }, as(PRIYA), r.deps)).toMatchObject({ ok: false, problem: 'unknown_tool', tools: ['Kestrel Studio'] });
    r.w.environments.find((e) => e.id === DEV)!.audienceGroup = 'kestrel-admins';
    // KS-DEV is hidden from Priya: asked by name, it is unknown, and it isn't listed.
    expect(await rovoCheck({ tool: 'Kestrel Studio', environment: 'KS-DEV', question: DASHBOARD }, as(PRIYA), r.deps)).toMatchObject({
      ok: false,
      problem: 'unknown_environment',
      environments: ['KS-PROD'],
    });
    expect(r.saved).toEqual([]);
  });

  it('with no environment named, answers for any environment', async () => {
    const r = rovoWorld();
    const reply = await rovoCheck({ tool: 'Kestrel Studio', question: DASHBOARD }, as(PRIYA), r.deps);
    expect(reply).toMatchObject({ ok: true });
    expect(r.saved[0]!.environmentId).toBeNull();
  });

  it("Don't know yet offers asking the owner, with the ask to use, and never a guess", async () => {
    const r = rovoWorld(demoWorld(), WS);
    const reply = await rovoCheck({ tool: 'Kestrel Studio', environment: 'KS-DEV', question: 'Can my dashboard keep a live connection open?' }, as(PRIYA), r.deps);
    expect(reply).toMatchObject({ ok: true, verdict: "Don't know yet" });
    if (!reply.ok) return;
    expect(reply.nextStep).toContain('ask-tool-owner');
    expect(reply.nextStep).toContain(String(reply.askId));
  });

  it('a bad input is a problem, and a failure is try again, never a verdict', async () => {
    const r = rovoWorld();
    for (const p of [null, {}, { tool: 'Kestrel Studio' }, { tool: 'Kestrel Studio', question: '' }, { tool: 'Kestrel Studio', question: 'x'.repeat(2001) }]) {
      expect(await rovoCheck(p, as(PRIYA), r.deps)).toMatchObject({ ok: false, problem: 'bad_input' });
    }
    const broken = rovoWorld();
    broken.deps.ask.loadCatalog = async () => {
      throw new Error('SQL down');
    };
    const reply = await rovoCheck({ tool: 'Kestrel Studio', environment: 'KS-DEV', question: DASHBOARD }, as(PRIYA), broken.deps);
    expect(reply).toMatchObject({ ok: false, problem: 'try_again' });
    expect(JSON.stringify(reply)).not.toMatch(/"verdict"/);
  });
});

describe('ask-tool-owner', () => {
  it("raises the private question for the caller's own ask", async () => {
    const r = rovoWorld(demoWorld(), WS);
    const check = await rovoCheck({ tool: 'Kestrel Studio', environment: 'KS-DEV', question: 'Can my dashboard keep a live connection open?' }, as(PRIYA), r.deps);
    if (!check.ok || check.askId === null) throw new Error('no ask');
    const reply = await rovoAskOwner({ askId: check.askId, accountId: SAM }, as(PRIYA), r.deps);
    expect(reply).toMatchObject({ ok: true, raised: ['TPD-1'] });
    expect(r.x.jsm.created[0]!.raiseOnBehalfOf).toBe(PRIYA);
    expect(r.x.jsm.assigned).toEqual([{ issueKey: 'TPD-1', accountId: MARCO }]);
  });

  it("refuses another person's ask, a missing principal and a bad input; raises nothing", async () => {
    const r = rovoWorld(demoWorld(), WS);
    const check = await rovoCheck({ tool: 'Kestrel Studio', environment: 'KS-DEV', question: 'Can my dashboard keep a live connection open?' }, as(PRIYA), r.deps);
    if (!check.ok || check.askId === null) throw new Error('no ask');
    expect(await rovoAskOwner({ askId: check.askId }, as(SAM), r.deps)).toMatchObject({ ok: false, problem: 'not_found' });
    expect(await rovoAskOwner({ askId: check.askId, accountId: PRIYA }, {}, r.deps)).toMatchObject({ ok: false, problem: 'not_signed_in' });
    for (const p of [null, {}, { askId: 'x' }, { askId: -1 }]) expect(await rovoAskOwner(p, as(PRIYA), r.deps)).toMatchObject({ ok: false, problem: 'bad_input' });
    expect(r.x.jsm.created).toEqual([]);
  });

  it('asks nothing when the answer is not Don\'t know yet', async () => {
    const r = rovoWorld();
    const check = await rovoCheck({ tool: 'Kestrel Studio', environment: 'KS-DEV', question: DASHBOARD }, as(PRIYA), r.deps);
    if (!check.ok || check.askId === null) throw new Error('no ask');
    expect(await rovoAskOwner({ askId: check.askId }, as(PRIYA), r.deps)).toMatchObject({ ok: true, raised: [] });
    expect(r.x.jsm.created).toEqual([]);
  });
});

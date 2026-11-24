import { describe, expect, it } from 'vitest';
import type { Card } from '../../src/engine/card';
import { handleIssueEvent, resolutionChange, sweepRequests } from '../../src/loop/events';
import { attachOpenRequests, raiseFix, recheckForAsker, routeOwner, type RequestRow } from '../../src/loop/requests';
import { handleRecheck, handleRequestFix, handleRequestSetup, handleSaveRequestSetup, type SetupDeps } from '../../src/resolvers/request-handlers';
import { DEV, MARCO, PRIYA, SAM } from '../support/demo-world';
import { customerRoleError, loopWorld, resolvedEvent, statusEvent } from '../support/fix-world';

/**
 * The guided fix (spec F4 and section 11 "Request loop"): Request the fix raises a private request for the
 * asker, built from the stored answer; resolution is read back from the issue (D22) and re-checks the stored
 * requirement for the asker; the sweep covers missed events. Account ids come from the Forge context only.
 */

const ENV_OWNER = 'acct-env-owner';
const fixFrontend = (x: ReturnType<typeof loopWorld>) => {
  x.w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
};

describe('Request the fix', () => {
  it('raises one private request for the asker, from the stored answer, assigned to the environment owner', async () => {
    const x = loopWorld();
    x.w.environments[0]!.ownerAccountId = ENV_OWNER;
    const askId = x.addAsk(DEV);
    const r = await raiseFix(askId, PRIYA, x.deps);
    expect(r).toMatchObject({ ok: true, raised: ['TPD-1'], card: { verdict: 'not_ready', action: { kind: 'fix_requested' } } });
    expect(x.jsm.created).toHaveLength(1);
    const c = x.jsm.created[0]!;
    expect(c).toMatchObject({ serviceDeskId: '14', requestTypeId: '320', raiseOnBehalfOf: PRIYA });
    expect(c.summary).toBe('Fix needed in KS-DEV: Frontend build');
    expect(c.description).toContain('Build environments needs to include "frontend"');
    expect(c.description).toContain('Assets record TPE-11');
    expect(c.description).toContain('Build a custom web front end or dashboard');
    expect(x.jsm.assigned).toEqual([{ issueKey: 'TPD-1', accountId: ENV_OWNER }]);
    expect(x.requests.rows[0]).toMatchObject({ kind: 'fix', status: 'open', target: 'ready:frontend_build', askerAccountId: PRIYA, ownerAccountId: ENV_OWNER, requestKey: 'TPD-1' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.card.action?.requests).toEqual([{ key: 'TPD-1', url: 'https://example.test/servicedesk/customer/portal/14/TPD-1', ownerAccountId: ENV_OWNER }]);
  });

  it('routes each missing piece: setup to the environment owner, access to the tool owner', async () => {
    const x = loopWorld();
    x.w.environments[0]!.ownerAccountId = ENV_OWNER;
    // Sam isn't in kestrel-dev-builders, and KS-DEV has no frontend build: two fixes.
    const r = await raiseFix(x.addAsk(DEV, SAM), SAM, x.deps);
    expect(r).toMatchObject({ ok: true, raised: ['TPD-1', 'TPD-2'] });
    // Same order as the checks: access, then setup.
    expect(x.jsm.created.map((c) => c.summary)).toEqual(['Access needed in KS-DEV: kestrel-dev-builders', 'Fix needed in KS-DEV: Frontend build']);
    expect(x.jsm.created[0]!.description).toContain('membership of kestrel-dev-builders, which gives Developer role in Kestrel');
    expect(x.jsm.created.every((c) => c.raiseOnBehalfOf === SAM)).toBe(true);
    expect(x.jsm.assigned).toEqual([
      { issueKey: 'TPD-1', accountId: MARCO },
      { issueKey: 'TPD-2', accountId: ENV_OWNER },
    ]);
  });

  it("refuses an ask that belongs to someone else, and reads nothing", async () => {
    const x = loopWorld();
    const askId = x.addAsk(DEV, PRIYA);
    expect(await raiseFix(askId, SAM, x.deps)).toMatchObject({ ok: false, error: 'not_found' });
    expect(await raiseFix(999, PRIYA, x.deps)).toMatchObject({ ok: false, error: 'not_found' });
    expect(x.jsm.created).toHaveLength(0);
    expect(x.groupsRead).toEqual([]);
  });

  it('keeps one open request per person, kind and target', async () => {
    const x = loopWorld();
    const first = await raiseFix(x.addAsk(DEV), PRIYA, x.deps);
    const again = await raiseFix(x.addAsk(DEV), PRIYA, x.deps);
    expect(first).toMatchObject({ ok: true, raised: ['TPD-1'] });
    expect(again).toMatchObject({ ok: true, raised: [], card: { action: { kind: 'fix_requested', requests: [{ key: 'TPD-1' }] } } });
    expect(x.jsm.created).toHaveLength(1);
    // Someone else's request for the same fix doesn't count as theirs: each asker has their own.
    x.w.groups.set(SAM, { ok: true, names: ['kestrel-dev-builders'] });
    expect(await raiseFix(x.addAsk(DEV, SAM), SAM, x.deps)).toMatchObject({ ok: true, raised: ['TPD-2'] });
  });

  it('sends nothing while another click is still raising the same request', async () => {
    const x = loopWorld();
    const askId = x.addAsk(DEV);
    await x.requests.claim({ kind: 'fix', askId, toolId: 1, environmentId: DEV, askerAccountId: PRIYA, ownerAccountId: MARCO, target: 'ready:frontend_build', requirementHash: 'h', openKey: `fix|${DEV}|ready:frontend_build|${PRIYA}` });
    const r = await raiseFix(askId, PRIYA, x.deps);
    expect(r).toMatchObject({ ok: true, raised: [], card: { action: { kind: 'fix_requested', requests: [{ key: null }] } } });
    expect(x.jsm.created).toHaveLength(0);
  });

  it('takes over an attempt that stopped before the request was raised', async () => {
    const x = loopWorld();
    const askId = x.addAsk(DEV);
    await x.requests.claim({ kind: 'fix', askId, toolId: 1, environmentId: DEV, askerAccountId: PRIYA, ownerAccountId: MARCO, target: 'ready:frontend_build', requirementHash: 'h', openKey: `fix|${DEV}|ready:frontend_build|${PRIYA}` });
    x.requests.rows[0]!.stale = true;
    expect(await raiseFix(askId, PRIYA, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
    expect(x.requests.rows).toHaveLength(1);
    expect(x.requests.rows[0]).toMatchObject({ status: 'open', requestKey: 'TPD-1' });
  });

  it('without the Customer role (D23) says what to do, leaves nothing open, and works once the role is added', async () => {
    const x = loopWorld();
    x.jsm.failCreate = customerRoleError();
    const askId = x.addAsk(DEV);
    const r = await raiseFix(askId, PRIYA, x.deps);
    expect(r).toMatchObject({ ok: false, error: 'customer_role' });
    if (r.ok) throw new Error('expected an error');
    expect(r.message).toContain('Customer role');
    expect(r.card?.action?.kind).toBe('request_fix');
    expect(x.requests.rows[0]).toMatchObject({ status: 'failed', openKey: null });
    x.jsm.failCreate = null;
    expect(await raiseFix(askId, PRIYA, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
  });

  it('says so when requests are not set up, and calls no service desk', async () => {
    const x = loopWorld();
    x.setSetup(null);
    expect(await raiseFix(x.addAsk(DEV), PRIYA, x.deps)).toMatchObject({ ok: false, error: 'not_set_up' });
    x.setSetup({ serviceDeskId: '14', requestTypeIds: {} });
    expect(await raiseFix(x.addAsk(DEV), PRIYA, x.deps)).toMatchObject({ ok: false, error: 'not_set_up' });
    expect(x.jsm.created).toHaveLength(0);
  });

  it('raises nothing when the fix is already in place, and shows the answer as it is now', async () => {
    const x = loopWorld();
    const askId = x.addAsk(DEV);
    fixFrontend(x);
    expect(await raiseFix(askId, PRIYA, x.deps)).toMatchObject({ ok: true, raised: [], card: { verdict: 'yes_with_approval' } });
    expect(await raiseFix(x.addAsk(null), PRIYA, x.deps)).toMatchObject({ ok: true, raised: [], card: { verdict: 'yes' } });
    expect(x.jsm.created).toHaveLength(0);
  });

  it('keeps the request when assignment fails, and says it is not assigned', async () => {
    const x = loopWorld();
    x.jsm.failAssign = true;
    expect(await raiseFix(x.addAsk(DEV), PRIYA, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
    expect(x.requests.rows[0]).toMatchObject({ status: 'open', requestKey: 'TPD-1' });
    expect(x.logs.join('\n')).toContain('TPD-1 was raised but not assigned');
  });

  it('sends a route it does not know, or an environment with no owner, to the tool owner', () => {
    const x = loopWorld();
    const env = { ...x.w.environments[0]!, ownerAccountId: '' };
    expect(routeOwner('environment_owner', x.w.tool, x.w.environments[0]!)).toBe(MARCO);
    expect(routeOwner('environment_owner', x.w.tool, env)).toBe(MARCO);
    expect(routeOwner('somebody_else', x.w.tool, x.w.environments[0]!)).toBe(MARCO);
    expect(routeOwner(null, x.w.tool, null)).toBe(MARCO);
  });
});

describe('open requests on the card', () => {
  const notReady = (): Card => ({
    kind: 'verdict',
    verdict: 'not_ready',
    title: 'Not ready',
    lozenge: 'moved',
    reason: 'r',
    where: 'KS-DEV',
    chips: [],
    action: { kind: 'request_fix', label: 'Request the fix' },
    next: [],
    checked: [],
    checks: [],
    banner: null,
  });
  const row = (target: string, key: string | null): RequestRow => ({
    id: 1,
    kind: 'fix',
    askId: 1,
    toolId: 1,
    environmentId: DEV,
    askerAccountId: PRIYA,
    ownerAccountId: MARCO,
    requestKey: key,
    portalUrl: null,
    target,
    status: key ? 'open' : 'raising',
  });

  it('shows Fix requested only when every missing piece has an open request', () => {
    const targets = ['ready:frontend_build', 'access:custom_ui'];
    expect(attachOpenRequests(notReady(), targets, [row('ready:frontend_build', 'TPD-1')]).action?.kind).toBe('request_fix');
    const both = attachOpenRequests(notReady(), targets, [row('ready:frontend_build', 'TPD-1'), row('access:custom_ui', 'TPD-2')]);
    expect(both.action).toMatchObject({ kind: 'fix_requested', label: 'Fix requested', requests: [{ key: 'TPD-1' }, { key: 'TPD-2' }] });
  });

  it('leaves any other action alone', () => {
    const yes = { ...notReady(), verdict: 'yes' as const, action: null };
    expect(attachOpenRequests(yes, ['ready:frontend_build'], [row('ready:frontend_build', 'TPD-1')])).toEqual(yes);
    expect(attachOpenRequests(notReady(), [], []).action?.kind).toBe('request_fix');
  });
});

describe('resolution events (D22)', () => {
  async function raised(x = loopWorld()) {
    const askId = x.addAsk(DEV);
    await raiseFix(askId, PRIYA, x.deps);
    return { x, askId };
  }

  it('finds the resolution in the changelog, not in issue.fields', () => {
    expect(resolutionChange(resolvedEvent('TPD-1'))).toEqual({ key: 'TPD-1', resolved: true });
    expect(resolutionChange(resolvedEvent('TPD-1', null))).toEqual({ key: 'TPD-1', resolved: false });
    expect(resolutionChange({ issue: { key: 'TPD-1', fields: { resolution: { name: 'Done' } } }, changelog: { items: [{ field: 'assignee', toString: 'Marco' }] } })).toBeNull();
    for (const junk of [null, undefined, 'x', {}, { issue: {} }, { issue: { key: 5 }, changelog: { items: [{ field: 'resolution', toString: 'Done' }] } }]) {
      expect(resolutionChange(junk)).toBeNull();
    }
  });

  it('a status change alone is worth a read-back: a site with no resolutions sends nothing else (D41, found live)', () => {
    expect(resolutionChange(statusEvent('TPD-1'))).toEqual({ key: 'TPD-1', resolved: true });
  });

  it('ignores issues the app did not raise, without reading them', async () => {
    const { x } = await raised();
    expect(await handleIssueEvent(resolvedEvent('HR-7'), x.deps)).toBe('not_ours');
    expect(await handleIssueEvent(statusEvent('HR-7'), x.deps)).toBe('not_ours');
    expect(await handleIssueEvent({ issue: { key: 'TPD-1' }, changelog: { items: [{ field: 'assignee', toString: 'Marco' }] } }, x.deps)).toBe('ignored');
    expect(x.jsm.resolutionReads).toEqual([]);
    expect(x.jsm.comments).toEqual([]);
  });

  it('a status change on its own request is read back; one that is not done changes nothing', async () => {
    const { x } = await raised();
    expect(await handleIssueEvent(statusEvent('TPD-1', 'In progress'), x.deps)).toBe('unresolved');
    expect(x.jsm.resolutionReads).toEqual(['TPD-1']);
    expect(x.jsm.comments).toEqual([]);
    expect(x.requests.rows[0]!.status).toBe('open');
  });

  it('on a site with no resolutions, a request moved to a done status is checked again (TPD-1, found live)', async () => {
    const { x, askId } = await raised();
    fixFrontend(x);
    x.jsm.resolutions.set('TPD-1', 'Resolved'); // the read-back's name: no resolution, so the done status
    expect(await handleIssueEvent(statusEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.jsm.comments[0]!.body).toContain('Answer now: Yes, with approval.');
    expect(x.saved).toContainEqual({ askId, verdict: 'yes_with_approval' });
  });

  it('trusts the read-back of the issue over the event', async () => {
    const { x } = await raised();
    x.jsm.resolutions.set('TPD-1', null);
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('unresolved');
    expect(x.jsm.resolutionReads).toEqual(['TPD-1']);
    expect(x.jsm.comments).toEqual([]);
    expect(x.requests.rows[0]!.status).toBe('open');
  });

  it('after the fix, re-checks for the asker and comments the new verdict on the request', async () => {
    const { x, askId } = await raised();
    fixFrontend(x);
    x.jsm.resolutions.set('TPD-1', 'Done');
    x.groupsRead.length = 0;
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.groupsRead).toEqual([PRIYA]);
    expect(x.jsm.comments).toHaveLength(1);
    expect(x.jsm.comments[0]!.issueKey).toBe('TPD-1');
    expect(x.jsm.comments[0]!.body).toContain('Answer now: Yes, with approval.');
    expect(x.jsm.comments[0]!.body).not.toContain('still missing');
    expect(x.requests.rows[0]).toMatchObject({ status: 'closed', result: { verdict: 'yes_with_approval' } });
    expect(x.saved).toContainEqual({ askId, verdict: 'yes_with_approval' });
  });

  it('says so when the setting is still missing, and the card offers the fix again', async () => {
    const { x, askId } = await raised();
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(x.jsm.comments[0]!.body).toContain('Answer now: Not ready.');
    expect(x.jsm.comments[0]!.body).toContain('Frontend build is still missing');
    expect(x.requests.rows[0]).toMatchObject({ status: 'closed', openKey: null });
    const card = await recheckForAsker(askId, PRIYA, x.deps);
    expect(card).toMatchObject({ ok: true, card: { verdict: 'not_ready', action: { kind: 'request_fix' } } });
    expect(await raiseFix(askId, PRIYA, x.deps)).toMatchObject({ ok: true, raised: ['TPD-2'] });
  });

  it('comments once when the same resolution arrives twice', async () => {
    const { x } = await raised();
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('rechecked');
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('already');
    expect(x.jsm.comments).toHaveLength(1);
  });

});

describe('the sweep', () => {
  it('re-checks an open request whose event never arrived', async () => {
    const x = loopWorld();
    await raiseFix(x.addAsk(DEV), PRIYA, x.deps);
    fixFrontend(x);
    x.jsm.resolutions.set('TPD-1', 'Done');
    expect(await sweepRequests(x.deps, 25)).toMatchObject({ looked: 1, rechecked: 1, failed: 0 });
    expect(x.jsm.comments[0]!.body).toContain('Answer now: Yes, with approval.');
    expect(x.requests.rows[0]!.status).toBe('closed');
  });

  it('only notes the look at a request that is not resolved yet', async () => {
    const x = loopWorld();
    await raiseFix(x.addAsk(DEV), PRIYA, x.deps);
    expect(await sweepRequests(x.deps, 25)).toMatchObject({ looked: 1, rechecked: 0 });
    expect(x.jsm.comments).toEqual([]);
    expect(x.requests.rows[0]).toMatchObject({ status: 'open', looked: 1 });
  });

  it('finishes a re-check that stopped part way (the comment failed)', async () => {
    const x = loopWorld();
    await raiseFix(x.addAsk(DEV), PRIYA, x.deps);
    x.jsm.resolutions.set('TPD-1', 'Done');
    x.jsm.failComment = true;
    expect(await handleIssueEvent(resolvedEvent('TPD-1'), x.deps)).toBe('comment_failed');
    expect(x.requests.rows[0]!.status).toBe('resolved');
    x.jsm.failComment = false;
    x.requests.rows[0]!.resolvedLongAgo = true;
    expect(await sweepRequests(x.deps, 25)).toMatchObject({ rechecked: 1 });
    expect(x.jsm.comments).toHaveLength(1);
    expect(x.requests.rows[0]!.status).toBe('closed');
  });

  it('keeps going when one request fails', async () => {
    const x = loopWorld();
    x.w.groups.set(SAM, { ok: true, names: ['kestrel-dev-builders'] });
    await raiseFix(x.addAsk(DEV, PRIYA), PRIYA, x.deps);
    await raiseFix(x.addAsk(DEV, SAM), SAM, x.deps);
    const read = x.jsm.resolution.bind(x.jsm);
    x.jsm.resolution = async (key) => {
      if (key === 'TPD-1') throw new Error('Jira timed out');
      return read(key);
    };
    x.jsm.resolutions.set('TPD-2', 'Done');
    expect(await sweepRequests(x.deps, 25)).toMatchObject({ looked: 2, rechecked: 1, failed: 1 });
    expect(x.jsm.comments.map((c) => c.issueKey)).toEqual(['TPD-2']);
  });
});

describe('Re-check', () => {
  it('re-evaluates the stored keys for the asker, with no model call', async () => {
    const x = loopWorld();
    const askId = x.addAsk(DEV);
    // The fake model throws if called, so a Not ready here proves no translation ran.
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, askId, card: { verdict: 'not_ready', action: { kind: 'request_fix' } } });
    fixFrontend(x);
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'yes_with_approval' } });
    expect(x.saved).toEqual([
      { askId, verdict: 'not_ready' },
      { askId, verdict: 'yes_with_approval' },
    ]);
    expect(x.groupsRead).toEqual([PRIYA, PRIYA]);
  });

  it("refuses another person's ask", async () => {
    const x = loopWorld();
    expect(await recheckForAsker(x.addAsk(DEV, PRIYA), SAM, x.deps)).toMatchObject({ ok: false, error: 'not_found' });
    expect(x.groupsRead).toEqual([]);
  });

  it("a stored key the catalog no longer has is Don't know yet, never a guess", async () => {
    const x = loopWorld();
    const gone = x.addAsk(DEV, PRIYA, [{ key: 'retired_key' }]);
    expect(await recheckForAsker(gone, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'dont_know' } });
    // A value on a key that no longer takes one would widen the question: not trusted either.
    const widened = x.addAsk(DEV, PRIYA, [{ key: 'web_frontend', value: 3 }]);
    expect(await recheckForAsker(widened, PRIYA, x.deps)).toMatchObject({ ok: true, card: { verdict: 'dont_know' } });
  });

  it('shows Fix requested while a fix request is open', async () => {
    const x = loopWorld();
    const askId = x.addAsk(DEV);
    await raiseFix(askId, PRIYA, x.deps);
    expect(await recheckForAsker(askId, PRIYA, x.deps)).toMatchObject({ ok: true, card: { action: { kind: 'fix_requested', requests: [{ key: 'TPD-1', ownerAccountId: MARCO }] } } });
  });
});

describe('request resolvers', () => {
  it('take the asker from the Forge context, never the payload', async () => {
    const x = loopWorld();
    const askId = x.addAsk(DEV, PRIYA);
    expect(await handleRequestFix({ askId, accountId: PRIYA }, { accountId: SAM }, x.deps)).toMatchObject({ ok: false, error: 'not_found' });
    expect(await handleRecheck({ askId, accountId: PRIYA }, { accountId: SAM }, x.deps)).toMatchObject({ ok: false, error: 'not_found' });
    expect(await handleRequestFix({ askId }, {}, x.deps)).toMatchObject({ ok: false, error: 'not_signed_in' });
    for (const p of [null, {}, { askId: '70' }, { askId: -1 }, { askId: 1.5 }]) {
      expect(await handleRequestFix(p, { accountId: PRIYA }, x.deps)).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(x.jsm.created).toHaveLength(0);
    expect(await handleRequestFix({ askId }, { accountId: PRIYA }, x.deps)).toMatchObject({ ok: true, raised: ['TPD-1'] });
  });

  it('turn a thrown error into Try again, never a request state', async () => {
    const x = loopWorld();
    const askId = x.addAsk(DEV);
    x.deps.loadAsk = async () => {
      throw new Error('SQL down');
    };
    expect(await handleRequestFix({ askId }, { accountId: PRIYA }, x.deps)).toMatchObject({ ok: false, error: 'try_again' });
    expect(await handleRecheck({ askId }, { accountId: PRIYA }, x.deps)).toMatchObject({ ok: false, error: 'try_again' });
  });
});

describe('request setup (Jira administrators only)', () => {
  function setupDeps(admin: boolean) {
    const saved: unknown[] = [];
    const deps: SetupDeps = {
      check: { isJiraAdmin: async () => admin },
      desks: async () => [{ id: '14', name: 'Tool Passport Desk' }],
      usableRequestTypes: async (desk) => (desk === '14' ? [{ id: '320', name: 'Get IT help' }] : null),
      getSetup: async () => null,
      saveSetup: async (s) => {
        saved.push(s);
      },
    };
    return { deps, saved };
  }

  it('refuses anyone who is not a Jira administrator', async () => {
    const { deps, saved } = setupDeps(false);
    expect(await handleRequestSetup({ accountId: PRIYA }, deps)).toMatchObject({ ok: false });
    expect(await handleSaveRequestSetup({ serviceDeskId: '14', requestTypeId: '320' }, { accountId: PRIYA }, deps)).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
  });

  it('saves only a request type the desk offers that needs nothing but a summary and description', async () => {
    const { deps, saved } = setupDeps(true);
    expect(await handleSaveRequestSetup({ serviceDeskId: '14', requestTypeId: '999' }, { accountId: MARCO }, deps)).toMatchObject({ ok: false });
    expect(await handleSaveRequestSetup({ serviceDeskId: '15', requestTypeId: '320' }, { accountId: MARCO }, deps)).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
    expect(await handleSaveRequestSetup({ serviceDeskId: '14', requestTypeId: '320' }, { accountId: MARCO }, deps)).toMatchObject({ ok: true });
    expect(saved).toEqual([{ serviceDeskId: '14', requestTypeIds: { fix: '320' } }]);
    expect(await handleRequestSetup({ accountId: MARCO }, deps)).toMatchObject({ ok: true, desks: [{ id: '14', name: 'Tool Passport Desk' }] });
  });
});

import { describe, expect, it } from 'vitest';
import { answerQuestion, type Answer } from '../../src/engine/answer';
import type { CheckResult, Environment } from '../../src/engine/model';
import { askInput, DASHBOARD, demoWorld, depsFor, DEV, modelReplying, picks, PRIYA, PROD, SAM, WEB, type World } from '../support/demo-world';

/**
 * The spec's three demo moments (section 16) through the whole pipeline with a fake model. The false-Yes
 * suite proves the engine never says Yes wrongly; these prove it says the right thing when the data is there.
 */

async function ask(w: World, environmentId: number | null, reply: unknown = WEB, asker = PRIYA, question = DASHBOARD) {
  return answerQuestion(askInput(w, question, environmentId, asker), depsFor(w, modelReplying(reply)));
}

function checked(a: Answer) {
  if (a.state !== 'checked') throw new Error(`expected checks, got ${a.state}`);
  return a;
}

const by = (a: Answer, dimension: CheckResult['check']['dimension']) => checked(a).outcome.results.find((r) => r.check.dimension === dimension)!;
const UPLOAD = (gb: number) => picks({ key: 'max_upload_gb', value: gb });

describe('moment 1: the same question, two environments', () => {
  it('KS-DEV is Not ready: frontend build missing, design review next', async () => {
    const a = checked(await ask(demoWorld(), DEV));
    expect(a.verdict).toBe('not_ready');
    expect(by(a, 'capability')).toMatchObject({ status: 'pass', label: { kind: 'owner_verified', version: '13.2' } });
    expect(by(a, 'policy')).toMatchObject({ status: 'approval', route: 'design-review:acct-marco', pending: null });
    expect(by(a, 'environment')).toMatchObject({
      status: 'missing',
      label: { kind: 'assets_record', attribute: 'Build environments' },
      route: 'env-owner:acct-marco',
    });
    expect(by(a, 'access')).toMatchObject({ status: 'pass', label: { kind: 'mapped_access', group: 'kestrel-dev-builders' } });
    expect(a.outcome).toMatchObject({ fixes: [{ check: { key: 'frontend_build' } }], next: [{ check: { action: 'custom_ui' } }] });
  });

  it('KS-PROD is No: not allowed in production, even though Prod has the frontend build', async () => {
    const a = checked(await ask(demoWorld(), PROD));
    expect(a.verdict).toBe('no');
    expect(by(a, 'policy')).toMatchObject({ status: 'fail', label: { kind: 'policy_rule', effect: 'deny', reason: 'Not allowed in production' } });
    expect(by(a, 'environment').status).toBe('pass');
    expect(by(a, 'access').status).toBe('missing');
  });
});

describe('moment 2: guided fix, then approval', () => {
  it('Not ready → Yes, with approval → Approval requested → Yes', async () => {
    const w = demoWorld();
    w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
    expect(checked(await ask(w, DEV)).verdict).toBe('yes_with_approval');

    w.grants.push({ id: 1, askerAccountId: PRIYA, toolId: 1, environmentId: DEV, actionKey: 'custom_ui', requestKey: 'TPD-12', status: 'pending', decidedAt: null });
    const pending = checked(await ask(w, DEV));
    expect(pending.verdict).toBe('yes_with_approval');
    expect(by(pending, 'policy').pending).toEqual({ requestKey: 'TPD-12' });

    w.grants[0]!.status = 'approved';
    const yes = checked(await ask(w, DEV));
    expect(yes.verdict).toBe('yes');
    expect(by(yes, 'policy').label).toMatchObject({ kind: 'approved', requestKey: 'TPD-12' });
  });

  it('a declined approval is No', async () => {
    const w = demoWorld();
    w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
    w.grants.push({ id: 1, askerAccountId: PRIYA, toolId: 1, environmentId: DEV, actionKey: 'custom_ui', requestKey: 'TPD-12', status: 'declined', decidedAt: null });
    expect(checked(await ask(w, DEV)).verdict).toBe('no');
  });

  it("an approval belongs to the person who got it: Sam doesn't inherit Priya's", async () => {
    const w = demoWorld();
    w.records.get(DEV)!['Build environments'] = ['standard', 'frontend'];
    w.grants.push({ id: 1, askerAccountId: PRIYA, toolId: 1, environmentId: DEV, actionKey: 'custom_ui', requestKey: 'TPD-12', status: 'approved', decidedAt: null });
    w.groups.set(SAM, { ok: true, names: ['kestrel-dev-builders'] });
    const sam = checked(await ask(w, DEV, WEB, SAM));
    expect(sam.verdict).toBe('yes_with_approval');
  });
});

describe('moment 3: a version change in one environment', () => {
  it('3 GB is No in both on 13.2 (limit 2 GB)', async () => {
    for (const env of [DEV, PROD]) {
      const a = checked(await ask(demoWorld(), env, UPLOAD(3)));
      expect(a.verdict).toBe('no');
      expect(by(a, 'capability')).toMatchObject({ status: 'fail', label: { kind: 'owner_verified', version: '13.2' } });
    }
  });

  it('KS-DEV on 14.0 is Don\'t know yet; KS-PROD on 13.2 still says No', async () => {
    const w = demoWorld();
    w.records.get(DEV)!.Version = ['14.0'];
    const dev = checked(await ask(w, DEV, UPLOAD(3)));
    expect(dev.verdict).toBe('dont_know');
    expect(by(dev, 'capability').label).toEqual({ kind: 'not_verified', missing: 'Verified on 13.2; KS-DEV runs 14.0' });
    expect(checked(await ask(w, PROD, UPLOAD(3))).verdict).toBe('no');
  });

  it('a 13.2.1 patch still counts as 13.2 (minor granularity)', async () => {
    const w = demoWorld();
    w.records.get(DEV)!.Version = ['13.2.1'];
    expect(checked(await ask(w, DEV, UPLOAD(1))).verdict).toBe('yes');
  });

  it('"Still true on 14.0" and "Changed: 5 GB" make KS-DEV Yes; rolling back restores the old answer', async () => {
    const w = demoWorld();
    w.records.get(DEV)!.Version = ['14.0'];
    const upload = w.facts.find((f) => f.factKey === 'max_upload_gb')!;
    w.factVersions.push({ id: 2000, factId: upload.id, version: '14.0', value: 5, quote: null, verifiedBy: 'acct-marco', verifiedAt: '2026-12-01T00:00:00.000Z', status: 'active' });
    expect(checked(await ask(w, DEV, UPLOAD(3))).verdict).toBe('yes');
    expect(checked(await ask(w, PROD, UPLOAD(3))).verdict).toBe('no');
    w.records.get(DEV)!.Version = ['13.2'];
    expect(checked(await ask(w, DEV, UPLOAD(3))).verdict).toBe('no');
  });

  it('facts that are not version-sensitive keep answering after the upgrade', async () => {
    const w = demoWorld();
    w.records.get(DEV)!.Version = ['14.0'];
    expect(checked(await ask(w, DEV, picks({ key: 'scheduled_jobs' }))).verdict).toBe('yes');
  });

  it('notes the version it read, and an error there does not change the answer', async () => {
    const w = demoWorld();
    const seen: Array<[string, string | null]> = [];
    const deps = depsFor(w, modelReplying(UPLOAD(1)));
    deps.noteVersion = async (e: Environment, v) => {
      seen.push([e.name, v]);
      throw new Error('SQL down');
    };
    const a = await answerQuestion(askInput(w, 'Can I upload 1 GB?', DEV), deps);
    expect(seen).toEqual([['KS-DEV', '13.2']]);
    expect(checked(a).verdict).toBe('yes');
  });
});

describe('the known unknown and "Any environment"', () => {
  it('websockets has no fact yet: Don\'t know yet, Ask the owner', async () => {
    const a = checked(await ask(demoWorld(), DEV, picks({ key: 'websockets' })));
    expect(a.verdict).toBe('dont_know');
    expect(by(a, 'capability')).toMatchObject({ settle: 'ask_owner', label: { missing: 'No verified answer yet' } });
  });

  it('"Any environment" answers the capability only, and says so', async () => {
    const w = demoWorld();
    const a = checked(await ask(w, null));
    expect(a.anyEnvironment).toBe(true);
    expect(a.checks).toEqual([{ dimension: 'capability', key: 'web_frontend' }]);
    expect(a.verdict).toBe('yes');
    expect(w.reads.some((r) => r.startsWith('env:') || r.startsWith('rules:'))).toBe(false);
  });

  it('records which fact versions were used, for the ask\'s evidence', async () => {
    const a = checked(await ask(demoWorld(), DEV));
    expect(by(a, 'capability').factVersionId).toBe(1000);
  });
});

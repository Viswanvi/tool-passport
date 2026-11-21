import Resolver from '@forge/resolver';
import { z } from 'zod';
import { runMigrations } from '../db/migrations';
import { recentRuns, recordRun, runDetail, setSetting } from '../db/store';
import { callerIsJiraAdmin, read, setup, summarise } from '../experiments/e1';
import { report } from '../experiments/e10';
import { groupsOf, myGroups, seedGroups } from '../experiments/e6';
import { prepare as e5Prepare, raise as e5Raise, STATE_KEY as E5_STATE, type E5State } from '../experiments/e5';
import { getSetting } from '../db/store';
import { listModels as e4ListModels, report as e4Report, runBatch as e4RunBatch } from '../experiments/e4';
import type { ImpersonationTarget } from '../change/sweep';
import { requester } from '../providers/assets-api';

/**
 * UI resolvers. Identity always comes from the Forge context (req.context.accountId), never the
 * payload (CLAUDE.md rule 3). Phase 0: only the temporary experiment endpoints exist.
 */
const resolver = new Resolver();

resolver.define('health', async () => ({ ok: true, phase: 0 }));

// ---- Phase 0 experiments (temporary) ----

/** E1 setup: create the fictional schema. Assets writes are admin-only (spec section 14). */
resolver.define('exp.e1.setup', async ({ context }) => {
  await runMigrations();
  if (!context.accountId) return { refused: 'No signed-in user' };
  if (!(await callerIsJiraAdmin(requester('user')))) {
    await recordRun('E1', 'setup:refused', false, 'refused: caller is not a Jira administrator', null);
    return { refused: 'Only a Jira administrator can create the test schema' };
  }
  // As the app first (is that enough for writes?), then as the admin user if it isn't.
  const asApp = await setup(requester('app'));
  await recordRun('E1', 'setup:app', asApp.ok, summarise('setup', asApp), asApp);
  if (asApp.ok) return { app: asApp };
  const asUser = await setup(requester('user'));
  await recordRun('E1', 'setup:user', asUser.ok, summarise('setup', asUser), asUser);
  return { app: asApp, user: asUser };
});

/** E1 read as the person clicking, and as the app; remembers who clicked for the impersonation run. */
resolver.define('exp.e1.read', async ({ context }) => {
  await runMigrations();
  const accountId = context.accountId;
  if (!accountId) return { refused: 'No signed-in user' };
  const isJiraAdmin = await callerIsJiraAdmin(requester('user'));
  const who = isJiraAdmin ? 'admin' : 'non-admin';

  const asUser = await read(requester('user'));
  await recordRun('E1', `ui:user:${who}`, asUser.ok, summarise('read', asUser), asUser);
  const asApp = await read(requester('app'));
  await recordRun('E1', 'ui:app', asApp.ok, summarise('read', asApp), asApp);

  // The sweep impersonates whoever clicked last, so the next tick tests that person's path.
  const target: ImpersonationTarget = { accountId, isJiraAdmin, setAt: new Date().toISOString() };
  await setSetting('exp.impersonate', target);
  return { who, user: asUser, app: asApp };
});

/** E6: the caller's groups as the user, and the same person's groups as the app. */
resolver.define('exp.e6.groups', async ({ context }) => {
  await runMigrations();
  const accountId = context.accountId;
  if (!accountId) return { refused: 'No signed-in user' };
  const isJiraAdmin = await callerIsJiraAdmin(requester('user'));
  const who = isJiraAdmin ? 'admin' : 'non-admin';
  const asUser = await myGroups(requester('user'));
  await recordRun('E6', `ui:user:${who}`, asUser.ok, `${asUser.ok ? 'ok' : 'failed'}: ${asUser.groups.length} groups ${asUser.steps[0]?.status ?? ''}`, asUser);
  const asApp = await groupsOf(requester('app'), accountId);
  await recordRun('E6', `ui:app:${who}`, asApp.ok, `${asApp.ok ? 'ok' : 'failed'}: ${asApp.groups.length} groups ${asApp.steps[0]?.status ?? ''}`, asApp);
  // The sweep reads this person's groups with no user present (app context and impersonation).
  const target: ImpersonationTarget = { accountId, isJiraAdmin, setAt: new Date().toISOString() };
  await setSetting('exp.impersonate', target);
  return { who, user: asUser, app: asApp };
});

/** E6 / gap J: create the demo groups and add the admin (Priya) to kestrel-dev-builders. Admin only. */
resolver.define('exp.e6.seed', async ({ context }) => {
  await runMigrations();
  const accountId = context.accountId;
  if (!accountId) return { refused: 'No signed-in user' };
  if (!(await callerIsJiraAdmin(requester('user')))) return { refused: 'Only a Jira administrator can create groups' };
  const asApp = await seedGroups(requester('app'), accountId);
  await recordRun('E6', 'seed:app', asApp.ok, summariseSteps(asApp.ok, asApp.steps), asApp);
  if (asApp.ok) return { app: asApp };
  const asUser = await seedGroups(requester('user'), accountId);
  await recordRun('E6', 'seed:user', asUser.ok, summariseSteps(asUser.ok, asUser.steps), asUser);
  return { app: asApp, user: asUser };
});

/** E5: find the desk and a simple request type; the admin who clicks becomes the owner/assignee. */
resolver.define('exp.e5.prepare', async ({ context }) => {
  await runMigrations();
  const accountId = context.accountId;
  if (!accountId) return { refused: 'No signed-in user' };
  if (!(await callerIsJiraAdmin(requester('user')))) return { refused: 'Only a Jira administrator can prepare E5' };
  const res = await e5Prepare(requester('app'), accountId);
  await recordRun(
    'E5',
    'prepare:app',
    res.ok,
    res.ok ? `ok: desk ${res.state?.serviceDeskId}, request type "${res.state?.requestTypeName}"` : summariseSteps(false, res.steps),
    res,
  );
  return res;
});

/** E5: the app raises two requests on behalf of the person clicking (identity from the context only). */
resolver.define('exp.e5.raise', async ({ context }) => {
  await runMigrations();
  const accountId = context.accountId;
  if (!accountId) return { refused: 'No signed-in user' };
  const who = (await callerIsJiraAdmin(requester('user'))) ? 'admin' : 'non-admin';
  const res = await e5Raise(accountId, who);
  await recordRun('E5', `raise:app:for-${who}`, res.ok, res.ok ? `ok: ${res.raised.map((r) => r.key).join(', ')}` : summariseSteps(false, res.steps), res);
  return res;
});

resolver.define('exp.e5.state', async () => {
  const state = await getSetting<E5State>(E5_STATE);
  return state ? { requests: state.requests, requestType: state.requestTypeName, serviceDeskId: state.serviceDeskId } : null;
});

// E4 pilot. Admin only: every call costs money, and the human approved at most 100 calls / $3 (DECISIONS D6).
const E4Model = z.object({ model: z.enum(['sonnet', 'haiku']) });

resolver.define('exp.e4.models', async ({ context }) => {
  await runMigrations();
  if (!context.accountId) return { refused: 'No signed-in user' };
  if (!(await callerIsJiraAdmin(requester('user')))) return { refused: 'Only a Jira administrator can run E4' };
  const res = await e4ListModels();
  await recordRun('E4', 'list', res.ok, res.ok ? `ok: ${JSON.stringify(res.models).slice(0, 400)}` : `failed: ${res.error ?? ''}`, res);
  return res;
});

resolver.define('exp.e4.run', async ({ context, payload }) => {
  await runMigrations();
  if (!context.accountId) return { refused: 'No signed-in user' };
  const parsed = E4Model.safeParse(payload);
  if (!parsed.success) return { refused: 'Bad model' };
  if (!(await callerIsJiraAdmin(requester('user')))) return { refused: 'Only a Jira administrator can run E4' };
  return e4RunBatch(parsed.data.model, 2);
});

resolver.define('exp.e4.report', async () => e4Report());

function summariseSteps(ok: boolean, steps: { step: string; status: number | null; ok: boolean; note?: string }[]): string {
  if (ok) return 'ok';
  const failed = steps.find((s) => !s.ok);
  return failed ? `failed at "${failed.step}" (${failed.status ?? 'no status'}) ${failed.note ?? ''}`.trim() : 'failed';
}

resolver.define('exp.status', async () => {
  const migrations = await runMigrations().then(
    (applied) => ({ ok: true, appliedNow: applied }),
    (e: unknown) => ({ ok: false, error: String(e).slice(0, 300) }),
  );
  if (!migrations.ok) return { migrations };
  return { migrations, e10: await report(), runs: await recentRuns(30) };
});

const RunId = z.object({ id: z.number().int().positive() });

resolver.define('exp.run', async ({ payload }) => {
  const parsed = RunId.safeParse(payload);
  if (!parsed.success) return { refused: 'Bad run id' };
  return { id: parsed.data.id, detail: await runDetail(parsed.data.id) };
});

export const uiResolver = resolver.getDefinitions();

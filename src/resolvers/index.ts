import Resolver from '@forge/resolver';
import { z } from 'zod';
import { runMigrations } from '../db/migrations';
import { recentRuns, recordRun, runDetail, setSetting } from '../db/store';
import { callerIsJiraAdmin, read, setup, summarise } from '../experiments/e1';
import { report } from '../experiments/e10';
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

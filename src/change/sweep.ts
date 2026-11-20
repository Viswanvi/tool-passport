/**
 * The five-minute sweep (spec section 11). Runs with no user. Phase 0: migrations, the E10
 * tick and E1's no-user Assets reads. Phase 1 adds the open-request re-checks.
 */
import { runMigrations } from '../db/migrations';
import { getSetting, recordRun } from '../db/store';
import { read, summarise } from '../experiments/e1';
import { tick } from '../experiments/e10';
import { requester } from '../providers/assets-api';

const BUDGET_MS = 30_000; // headroom under the 55 s scheduled-trigger limit

export interface ImpersonationTarget {
  accountId: string;
  isJiraAdmin: boolean;
  setAt: string;
}

export async function sweep(): Promise<void> {
  const started = Date.now();
  try {
    const applied = await runMigrations();
    if (applied.length) console.log(`[sweep] migrations applied: ${applied.join(', ')}`);
  } catch (e) {
    console.error(`[sweep] migrations failed: ${String(e).slice(0, 300)}`);
    return; // nothing below works without the tables
  }

  await tick();
  if (Date.now() - started > BUDGET_MS) return;

  const asApp = await read(requester('app'));
  await recordRun('E1', 'sweep:app', asApp.ok, summarise('read', asApp), asApp);
  console.log(`[E1] sweep:app ${summarise('read', asApp)}`);

  const target = await getSetting<ImpersonationTarget>('exp.impersonate');
  if (!target || Date.now() - started > BUDGET_MS) return;
  const who = target.isJiraAdmin ? 'admin' : 'non-admin';
  const asUser = await read(requester('impersonate', target.accountId));
  await recordRun('E1', `sweep:impersonate:${who}`, asUser.ok, summarise('read', asUser), asUser);
  console.log(`[E1] sweep:impersonate:${who} ${summarise('read', asUser)}`);
}

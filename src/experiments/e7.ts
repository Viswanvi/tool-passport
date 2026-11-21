import { sql, type UpdateQueryResponse } from '@forge/sql';
import { noteVersion, type EnvironmentSnapshot, type NoteOutcome } from '../change/detect';
import { sqlDetectRepo } from '../change/detect-sql';

/**
 * E7: is change detection safe to repeat? Runs against real Forge SQL on a throwaway environment row
 * (tool_id 0), then deletes it. Scenarios from spec section 7: two detections in parallel, a crash
 * between the change insert and the version update, a rollback 14.0 → 13.2, and a repeat upgrade
 * after the rollback (the case v2 blocked). No Assets or LLM calls.
 */

interface EnvRow {
  id: number;
  tool_id: number;
  provider: string;
  last_seen_version: string | null;
  last_seen_at: string | null;
}

interface ChangeDbRow {
  id: number;
  baseline_at: string;
  from_version: string;
  to_version: string;
  origin: string;
}

async function snapshot(id: number): Promise<EnvironmentSnapshot> {
  const res = await sql
    .prepare<EnvRow>('SELECT id, tool_id, provider, last_seen_version, last_seen_at FROM environments WHERE id = ?')
    .bindParams(id)
    .execute();
  const r = res.rows[0];
  if (!r) throw new Error(`E7 environment ${id} vanished`);
  return {
    id: Number(r.id),
    toolId: Number(r.tool_id),
    provider: r.provider === 'registry' ? 'registry' : 'assets',
    granularity: 'minor',
    lastSeenVersion: r.last_seen_version,
    lastSeenAt: r.last_seen_at,
  };
}

async function changes(id: number): Promise<ChangeDbRow[]> {
  const res = await sql
    .prepare<ChangeDbRow>(
      'SELECT id, baseline_at, from_version, to_version, origin FROM changes WHERE environment_id = ? ORDER BY baseline_at, created_at',
    )
    .bindParams(id)
    .execute();
  return res.rows;
}

export interface E7Step {
  step: string;
  ok: boolean;
  expected: string;
  observed: unknown;
}

export async function run(): Promise<{ ok: boolean; steps: E7Step[]; environmentId: number | null; error?: string }> {
  const steps: E7Step[] = [];
  let envId: number | null = null;
  const check = (step: string, ok: boolean, expected: string, observed: unknown) => steps.push({ step, ok, expected, observed });
  try {
    // A baseline far in the past, so later baselines (set to "now" by the compare-and-set) can't collide with it.
    const name = `E7 test ${new Date().toISOString()}`;
    const ins = await sql
      .prepare<UpdateQueryResponse>(
        `INSERT INTO environments (tool_id, name, provider, owner_account_id, last_seen_version, last_seen_at)
         VALUES (0, ?, 'assets', 'e7-experiment', '13.2', '2026-11-01 00:00:00')`,
      )
      .bindParams(name)
      .execute();
    envId = Number(ins.rows.insertId);
    check('create test environment', envId > 0, 'insertId > 0', { insertId: envId });

    // 1. Three detections of 14.0 at once from the same stale snapshot ("14.0.3" normalises to 14.0).
    const s1 = await snapshot(envId);
    const parallel: NoteOutcome[] = await Promise.all([
      noteVersion(s1, '14.0', sqlDetectRepo),
      noteVersion(s1, '14.0', sqlDetectRepo),
      noteVersion(s1, '14.0.3', sqlDetectRepo),
    ]);
    const moved = parallel.filter((o) => o.action === 'change' && o.moved).length;
    const after1 = await changes(envId);
    const env1 = await snapshot(envId);
    check('parallel: one change row', after1.length === 1, '1 row 13.2 → 14.0', after1);
    check('parallel: exactly one compare-and-set wins', moved === 1, 'moved 1 of 3', { moved, parallel });
    check('parallel: version now 14.0 with a new baseline', env1.lastSeenVersion === '14.0' && env1.lastSeenAt !== s1.lastSeenAt, '14.0, baseline moved', env1);

    // 2. Rollback to 13.2, with a crash after the change insert and before the version update.
    const s2 = await snapshot(envId);
    await sqlDetectRepo.insertChangeIgnoreDuplicate({
      toolId: 0,
      environmentId: envId,
      baselineAt: s2.lastSeenAt ?? '',
      fromVersion: '14.0',
      toVersion: '13.2',
      origin: 'detected',
    });
    const afterCrash = await changes(envId);
    const envCrash = await snapshot(envId);
    check('crash: row written, version not yet moved', afterCrash.length === 2 && envCrash.lastSeenVersion === '14.0', '2 rows, still 14.0', { rows: afterCrash.length, version: envCrash.lastSeenVersion });
    // The next detection, from the same stale snapshot, finishes the job without a second row.
    const retry = await noteVersion(s2, '13.2', sqlDetectRepo);
    const after2 = await changes(envId);
    const env2 = await snapshot(envId);
    check('crash: re-detection adds no row and finishes the update', retry.action === 'change' && retry.moved && after2.length === 2 && env2.lastSeenVersion === '13.2', 'moved, still 2 rows, 13.2', { retry, rows: after2.length, version: env2.lastSeenVersion });

    // 3. A repeat upgrade 13.2 → 14.0 after the rollback is a new transition (new baseline), so a new row.
    const s3 = await snapshot(envId);
    const again = await noteVersion(s3, '14.0', sqlDetectRepo);
    const after3 = await changes(envId);
    const env3 = await snapshot(envId);
    check('repeat upgrade after rollback: new row', again.action === 'change' && again.moved && after3.length === 3 && env3.lastSeenVersion === '14.0', 'moved, 3 rows, 14.0', { again, rows: after3 });

    // 4. Same version again: nothing happens.
    const same = await noteVersion(await snapshot(envId), '14.0.9', sqlDetectRepo);
    check('same version (14.0.9 at minor granularity): no-op', same.action === 'none' && (await changes(envId)).length === 3, 'none, 3 rows', same);

    // 5. Platform probes (recorded for Phase 1+ code; they pass whatever the numbers are).
    const dup = await sql
      .prepare<UpdateQueryResponse>(
        `INSERT INTO changes (tool_id, environment_id, baseline_at, from_version, to_version, origin)
         VALUES (0, ?, '2026-11-01 00:00:00', '13.2', '14.0', 'detected') ON DUPLICATE KEY UPDATE id = id`,
      )
      .bindParams(envId)
      .execute();
    const noop = await sql
      .prepare<UpdateQueryResponse>('UPDATE environments SET last_seen_version = last_seen_version WHERE id = ?')
      .bindParams(envId)
      .execute();
    check('probe: affectedRows for a skipped duplicate and for a no-change UPDATE', true, 'recorded only', {
      duplicateInsertAffectedRows: dup.rows.affectedRows,
      noChangeUpdateAffectedRows: noop.rows.affectedRows,
      rowsAfter: (await changes(envId)).length,
    });

    return { ok: steps.every((s) => s.ok), steps, environmentId: envId };
  } catch (e) {
    return { ok: false, steps, environmentId: envId, error: String(e).slice(0, 500) };
  } finally {
    if (envId !== null) {
      await sql.prepare('DELETE FROM changes WHERE environment_id = ?').bindParams(envId).execute();
      await sql.prepare('DELETE FROM environments WHERE id = ?').bindParams(envId).execute();
    }
  }
}

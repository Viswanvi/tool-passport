/**
 * Version change detection (spec section 11, "Version validity", `noteVersion`). No Forge imports: the
 * repository is passed in, so the logic runs in unit tests and in E7 against real Forge SQL.
 *
 * Forge SQL has no transactions, so safety comes from two statements that are each safe to repeat:
 * an insert that ignores duplicates of (environment_id, baseline_at, to_version), then a compare-and-set
 * of the environment's version. A crash between them, or two detections at once, still leaves one
 * change row per transition. Answers never depend on this finishing (they compare versions at read time).
 */

import { normaliseVersion, type Granularity } from '../engine/version';

export { normaliseVersion, type Granularity };

export interface EnvironmentSnapshot {
  id: number;
  toolId: number;
  provider: 'assets' | 'registry';
  granularity: Granularity;
  lastSeenVersion: string | null;
  /** When lastSeenVersion was first seen, exactly as stored; it becomes the change's baseline. */
  lastSeenAt: string | null;
}

export interface ChangeRow {
  toolId: number;
  environmentId: number;
  baselineAt: string;
  fromVersion: string;
  toVersion: string;
  origin: 'detected' | 'recorded';
}

export interface DetectRepo {
  /** First sighting: set the version only if none is stored yet. Returns true if this call set it. */
  setBaseline(environmentId: number, version: string): Promise<boolean>;
  /**
   * Insert unless (environment_id, baseline_at, to_version) exists. Returns nothing on purpose: Forge SQL
   * reports affectedRows = 1 for a skipped duplicate too (found-rows behaviour, E7), so "was it new?"
   * can't be told from the reply, and nothing here needs to know.
   */
  insertChangeIgnoreDuplicate(row: ChangeRow): Promise<void>;
  /**
   * UPDATE … WHERE last_seen_version = from. Returns true if this call moved the version. Safe to read
   * from affectedRows because the old value is in the WHERE clause: a matched row is a changed row.
   */
  compareAndSetVersion(environmentId: number, from: string, to: string): Promise<boolean>;
}

export type NoteOutcome =
  | { action: 'none' }
  | { action: 'baseline'; set: boolean }
  | { action: 'change'; from: string; to: string; moved: boolean };

export async function noteVersion(env: EnvironmentSnapshot, observed: string | null | undefined, repo: DetectRepo): Promise<NoteOutcome> {
  const v = normaliseVersion(observed, env.granularity);
  if (!v || v === env.lastSeenVersion) return { action: 'none' };
  if (env.lastSeenVersion === null || env.lastSeenAt === null) {
    return { action: 'baseline', set: await repo.setBaseline(env.id, v) };
  }
  await repo.insertChangeIgnoreDuplicate({
    toolId: env.toolId,
    environmentId: env.id,
    baselineAt: env.lastSeenAt,
    fromVersion: env.lastSeenVersion,
    toVersion: v,
    origin: env.provider === 'registry' ? 'recorded' : 'detected',
  });
  const moved = await repo.compareAndSetVersion(env.id, env.lastSeenVersion, v);
  return { action: 'change', from: env.lastSeenVersion, to: v, moved };
}

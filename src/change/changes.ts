import type { Environment, EnvironmentReader, FactRow, FactVersionRow, Tool } from '../engine/model';
import type { RegistryWriter } from '../registry/write';
import type { NoteOutcome } from './detect';

/**
 * Version validity, the owner's side (spec F6, section 11 `buildRecheckList`). Answers never wait for this:
 * the capability check only accepts a verification for the version the environment runs now. This builds the
 * re-verify list, marks recent asks "may have changed", and records "Still true" in one click. Every statement
 * is safe to repeat; a list that keeps failing is marked failed after three tries (answers stay correct).
 * No Forge imports.
 */

export interface ChangeRecord {
  id: number;
  toolId: number;
  environmentId: number;
  fromVersion: string;
  toVersion: string;
  origin: 'detected' | 'recorded';
  status: 'open' | 'listed' | 'failed';
  attempts: number;
  error: string | null;
  createdAt: string;
}

export type FactWithVersions = FactRow & { versions: FactVersionRow[] };

export interface ChangeRepo {
  openChanges(limit: number): Promise<ChangeRecord[]>;
  changesFor(toolId: number, limit: number): Promise<ChangeRecord[]>;
  changeById(id: number): Promise<ChangeRecord | null>;
  /** Active facts that apply in this environment: its own and the all-environment ones. */
  factsInScope(toolId: number, environmentId: number): Promise<FactWithVersions[]>;
  /** Insert, ignoring ones already there (unique change, kind, ref). */
  addRecheckItems(changeId: number, kind: 'fact' | 'ask', refIds: number[]): Promise<void>;
  openRecheckFacts(changeId: number): Promise<number[]>;
  /** A verification for `version` now exists: close that fact's open items on changes to that version. */
  closeFactRechecks(factId: number, version: string): Promise<void>;
  /** Recent asks in the environment with the fact versions their evidence used. */
  recentAsks(environmentId: number, days: number): Promise<Array<{ id: number; factVersionIds: number[] }>>;
  markMayHaveChanged(askIds: number[]): Promise<void>;
  setStatus(changeId: number, status: 'listed' | 'failed', error?: string): Promise<void>;
  /** Count a failed try; returns the attempts so far. */
  bumpAttempts(changeId: number, error: string): Promise<number>;
}

export const RECENT_DAYS = 30;
export const MAX_ATTEMPTS = 3;

/** Version-sensitive facts with no active verification for the new version: the owner's re-verify list. */
export function affectedFacts(facts: FactWithVersions[], toVersion: string): FactWithVersions[] {
  return facts.filter((f) => f.status === 'active' && f.versionSensitive && !f.versions.some((v) => v.status === 'active' && v.version === toVersion));
}

export async function buildRecheckList(change: ChangeRecord, repo: ChangeRepo): Promise<'listed' | 'retry' | 'failed'> {
  try {
    const facts = affectedFacts(await repo.factsInScope(change.toolId, change.environmentId), change.toVersion);
    await repo.addRecheckItems(change.id, 'fact', facts.map((f) => f.id));
    const used = new Set(facts.flatMap((f) => f.versions.map((v) => v.id)));
    const asks = (await repo.recentAsks(change.environmentId, RECENT_DAYS)).filter((a) => a.factVersionIds.some((id) => used.has(id)));
    if (asks.length) {
      await repo.addRecheckItems(change.id, 'ask', asks.map((a) => a.id));
      await repo.markMayHaveChanged(asks.map((a) => a.id));
    }
    await repo.setStatus(change.id, 'listed');
    return 'listed';
  } catch (e) {
    const error = String(e).slice(0, 300);
    const attempts = await repo.bumpAttempts(change.id, error);
    if (attempts < MAX_ATTEMPTS) return 'retry';
    await repo.setStatus(change.id, 'failed', error);
    return 'failed';
  }
}

/** The sweep's share: build the list for each open change. */
export async function sweepChanges(repo: ChangeRepo, limit: number): Promise<{ listed: number; failed: number }> {
  let listed = 0;
  let failed = 0;
  for (const change of await repo.openChanges(limit)) {
    const out = await buildRecheckList(change, repo);
    if (out === 'listed') listed += 1;
    if (out === 'failed') failed += 1;
  }
  return { listed, failed };
}

/**
 * Detection without an ask (F6: "by the sweep if E10 allows", and E10 did): read each environment's record
 * as the app and note its version. A read that fails notes nothing; the next sweep or ask tries again.
 */
export async function detectVersions(
  tools: Array<{ tool: Tool; environments: Environment[] }>,
  reader: EnvironmentReader,
  note: (tool: Tool, environment: Environment, observed: string | null) => Promise<NoteOutcome | unknown>,
): Promise<number> {
  let changed = 0;
  for (const { tool, environments } of tools) {
    for (const environment of environments) {
      try {
        const r = await reader.read(environment);
        if (!r.ok || !r.version) continue;
        const out = (await note(tool, environment, r.version)) as NoteOutcome | undefined;
        if (out?.action === 'change') changed += 1;
      } catch {
        // Unreachable now; nothing is noted, so nothing is wrong.
      }
    }
  }
  return changed;
}

/**
 * "Still true on 14.0" (spec F6): one click adds a verification for the new version with the value verified
 * for the old one, and closes the item. Only for a fact on that change's open list.
 */
export async function stillTrue(
  input: { changeId: number; factId: number },
  tool: Tool,
  actor: string,
  deps: { changes: ChangeRepo; writer: Pick<RegistryWriter, 'upsertFactVersion' | 'bumpRevision' | 'audit'>; facts: FactWithVersions[] },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const change = await deps.changes.changeById(input.changeId);
  if (!change || change.toolId !== tool.id) return { ok: false, reason: 'That change is not one of this tool' };
  const open = await deps.changes.openRecheckFacts(change.id);
  if (!open.includes(input.factId)) return { ok: false, reason: "That fact is not on this change's list" };
  const fact = deps.facts.find((f) => f.id === input.factId && f.toolId === tool.id);
  const active = (fact?.versions ?? []).filter((v) => v.status === 'active');
  const was = active.find((v) => v.version === change.fromVersion) ?? active.at(-1);
  if (!fact || !was) return { ok: false, reason: 'There is no earlier verification to carry over; use Changed' };
  await deps.writer.upsertFactVersion({ factId: fact.id, version: change.toVersion, value: was.value as boolean | number | string, quote: was.quote, verifiedBy: actor });
  await deps.changes.closeFactRechecks(fact.id, change.toVersion);
  await deps.writer.bumpRevision(tool.id);
  await deps.writer.audit(actor, 'fact.still_true', 'facts', String(fact.id), { version: change.toVersion, value: was.value });
  return { ok: true };
}

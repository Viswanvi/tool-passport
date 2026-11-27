/**
 * "Needs you" at the top of My tools (D62): what the owner has to do for a tool, counted from the same replies
 * the tabs below show, so a number here is always what the tab holds. Nothing is stored for it. A reply that
 * failed counts as unknown (null), never as zero. No Forge imports.
 */

export interface Needs {
  /** Questions waiting for the owner's answer. */
  questions: number | null;
  /** Facts to re-check after a version change. */
  recheck: number | null;
  /** The newest change with facts still to re-check, in words. */
  moved: string | null;
  /** Capabilities nobody has verified in any environment. */
  unverified: number | null;
}

type Refusal = { ok: false };
type QuestionsLike = { ok: true; groups: unknown[] } | Refusal;
type ChangesLike = { ok: true; changes: Array<{ environment: string; from: string; to: string; toRecheck: unknown[] }> } | Refusal;
type PassportLike = { ok: true; rows: Array<{ cells: Array<{ verdict: string | null }> }> } | Refusal;

export function needsOf(x: { questions: QuestionsLike | null; changes: ChangesLike | null; passport: PassportLike | null }): Needs {
  const q = x.questions?.ok ? x.questions.groups.length : null;
  const open = x.changes?.ok ? x.changes.changes.filter((c) => c.toRecheck.length > 0) : null;
  // Changes come newest first.
  const newest = open?.[0];
  const unverified = x.passport?.ok ? x.passport.rows.filter((r) => r.cells.length > 0 && r.cells.every((c) => c.verdict === 'dont_know')).length : null;
  return {
    questions: q,
    recheck: open ? open.reduce((n, c) => n + c.toRecheck.length, 0) : null,
    moved: newest ? `${newest.environment} moved from ${newest.from} to ${newest.to}` : null,
    unverified,
  };
}

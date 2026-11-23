import type { Catalog, Environment, Tool } from '../engine/model';
import { normaliseVersion } from '../engine/version';
import type { RegistryWriter } from '../registry/write';
import { recheckAsk, saveResult, type LoopDeps, type Rechecked, type RequestRow } from './requests';

/**
 * Ask the owner, the owner's side (spec F5, section 11 `publishAnswer`). The owner answers once: the answer
 * becomes a fact verification (same tables the seed writes), the catalog revision moves on (so cached
 * translations are redone, spec section 10), and every open question for the tool is checked again for its
 * own asker. The ones now decided get the verdict as a comment on their own request and are closed and
 * resolved; the rest stay open, untouched. No Forge imports.
 */

export type AnswerWriter = Pick<RegistryWriter, 'upsertFact' | 'upsertFactVersion' | 'bumpRevision' | 'audit'>;

export interface Answer {
  key: string;
  value: boolean | number | string;
  /** Null: every environment. */
  environmentId: number | null;
  version: string;
  /** True: the answer holds for every version (the fact isn't version-sensitive). */
  everyVersion: boolean;
  quote: string | null;
}

export type Checked = { ok: true; fact: { key: string; value: boolean | number | string; environmentId: number | null; version: string; versionSensitive: boolean; quote: string | null } } | { ok: false; reason: string };

/** The answer against the catalog and the tool: only capability keys, values of the key's type, a readable version. */
export function checkAnswer(a: Answer, tool: Tool, catalog: Catalog, environments: Environment[]): Checked {
  const key = catalog.keys.get(a.key);
  if (!key) return { ok: false, reason: `"${a.key}" is not in this tool's catalog` };
  if (key.kind !== 'capability') return { ok: false, reason: `"${key.label}" is a policy action: it is decided by rules, not answered as a fact` };
  if (key.valueType === 'boolean' && typeof a.value !== 'boolean') return { ok: false, reason: `"${key.label}" needs Yes or No` };
  if (key.valueType === 'number' && (typeof a.value !== 'number' || !Number.isFinite(a.value))) return { ok: false, reason: `"${key.label}" needs a number` };
  if (key.valueType === 'text' && (typeof a.value !== 'string' || !a.value.trim())) return { ok: false, reason: `"${key.label}" needs some text` };
  if (a.environmentId !== null && !environments.some((e) => e.id === a.environmentId && e.toolId === tool.id)) {
    return { ok: false, reason: 'That environment is not one of this tool' };
  }
  const version = normaliseVersion(a.version, tool.versionGranularity);
  if (!version) return { ok: false, reason: `"${a.version}" is not a version number` };
  const value = typeof a.value === 'string' ? a.value.trim() : a.value;
  return { ok: true, fact: { key: a.key, value, environmentId: a.environmentId, version, versionSensitive: !a.everyVersion, quote: a.quote?.trim() || null } };
}

/** Write the fact verification, move the catalog revision on, and record who did it. */
export async function writeAnswer(tool: Tool, fact: Extract<Checked, { ok: true }>['fact'], actor: string, writer: AnswerWriter): Promise<void> {
  const factId = await writer.upsertFact({
    toolId: tool.id,
    environmentId: fact.environmentId,
    audienceGroup: null,
    factKey: fact.key,
    versionSensitive: fact.versionSensitive,
    source: 'published_question',
  });
  await writer.upsertFactVersion({ factId, version: fact.version, value: fact.value, quote: fact.quote, verifiedBy: actor });
  await writer.bumpRevision(tool.id);
  await writer.audit(actor, 'fact.published', 'facts', String(factId), fact);
}

/** The comment a settled question gets: the card's fixed words, and the next step if there is one. */
export function answeredComment(now: Rechecked): string {
  const lines = ['The tool owner answered in Tool Passport.', '', `Answer now: ${now.card.title}. ${now.card.reason}`];
  if (now.answer.state === 'checked' && now.answer.verdict === 'not_ready') lines.push('Next step: request the fix in Tool Passport.');
  if (now.answer.state === 'checked' && now.answer.verdict === 'yes_with_approval') lines.push('Next step: request approval in Tool Passport.');
  return lines.join('\n');
}

const QUESTION_LIMIT = 100;

/**
 * Check every open question for the tool again, each for its own asker. Decided (anything but Don't know yet):
 * claim it (compare-and-set), comment the verdict, close it, resolve the request. Still unknown: leave it.
 */
export async function settleOpenQuestions(toolId: number, deps: LoopDeps): Promise<{ settled: string[]; stillOpen: number }> {
  const settled: string[] = [];
  let stillOpen = 0;
  for (const row of await deps.requests.openByKind(toolId, 'question', QUESTION_LIMIT)) {
    try {
      if ((await settleOne(row, deps)) === 'settled') settled.push(row.requestKey!);
      else stillOpen += 1;
    } catch (e) {
      stillOpen += 1;
      deps.log?.(`[question] ${row.requestKey ?? row.id} could not be checked: ${String(e).slice(0, 200)}`);
    }
  }
  return { settled, stillOpen };
}

async function settleOne(row: RequestRow, deps: LoopDeps): Promise<'settled' | 'open'> {
  if (!row.requestKey) return 'open';
  const ask = await deps.loadAsk(row.askId);
  const now = ask ? await recheckAsk(ask, deps) : null;
  if (!ask || !now || now.answer.state !== 'checked' || now.answer.verdict === 'dont_know') return 'open';
  // Someone else (another publish, or the owner resolving it by hand) may be settling it right now.
  if (!(await deps.requests.markResolved(row.id))) return 'open';
  await saveResult(deps, ask.id, now.answer);
  try {
    await deps.jsm.comment(row.requestKey, answeredComment(now));
  } catch (e) {
    // Left resolved: the sweep finishes it (finishRecheck comments the verdict).
    deps.log?.(`[question] comment on ${row.requestKey} failed: ${String(e).slice(0, 200)}`);
    return 'settled';
  }
  await deps.requests.markRechecked(row.id, { verdict: now.answer.verdict, reason: now.card.reason, at: new Date().toISOString() });
  let resolved = false;
  try {
    resolved = await deps.jsm.resolve(row.requestKey);
  } catch {
    resolved = false;
  }
  if (!resolved) deps.log?.(`[question] ${row.requestKey} was answered but not resolved; the owner can resolve it`);
  return 'settled';
}

export interface QuestionGroup {
  target: string;
  /** Where the questions were asked: environment names, or "Any environment". */
  environments: string[];
  /** The capability keys the owner can answer, from the stored requirement. */
  keys: Array<{ key: string; label: string; valueType: string; unit: string | null }>;
  /** What isn't verified, from checking the newest question again. */
  missing: string[];
  requests: Array<{ key: string | null; url: string | null }>;
}

/** Open questions for the tool, grouped by requirement (spec section 15, My tools). */
export async function openQuestionGroups(tool: Tool, catalog: Catalog, environments: Environment[], deps: LoopDeps): Promise<QuestionGroup[]> {
  const rows = await deps.requests.openByKind(tool.id, 'question', QUESTION_LIMIT);
  const byTarget = new Map<string, RequestRow[]>();
  for (const r of rows) byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r]);
  const envName = (id: number | null) => (id === null ? 'Any environment' : (environments.find((e) => e.id === id)?.name ?? 'an environment'));
  const groups: QuestionGroup[] = [];
  for (const [target, members] of byTarget) {
    const newest = members.reduce((a, b) => (b.id > a.id ? b : a));
    const ask = await deps.loadAsk(newest.askId);
    const now = ask ? await recheckAsk(ask, deps) : null;
    const keys = (ask?.requirement ?? []).flatMap((c) => {
      const k = catalog.keys.get(c.key);
      return k && k.kind === 'capability' ? [{ key: k.key, label: k.label, valueType: k.valueType, unit: k.unit ?? null }] : [];
    });
    groups.push({
      target,
      environments: [...new Set(members.map((m) => envName(m.environmentId)))],
      keys,
      missing: now ? now.card.checks.filter((c) => c.status === 'unknown').map((c) => `${c.subject}: ${c.chip.detail}`) : [],
      requests: members.map((m) => ({ key: m.requestKey, url: m.portalUrl })),
    });
  }
  return groups;
}

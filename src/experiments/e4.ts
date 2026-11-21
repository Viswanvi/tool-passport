import { chat, list } from '@forge/llm';
import { getSetting, recordRun, setSetting } from '../db/store';
import { CASES, CATALOG, type PilotCase } from './e4-data';
import { translate, scoreCase, type ChatFn, type TranslateResult } from './e4-translate';

/**
 * E4 pilot runner (DECISIONS D6). Every LLM call goes through `guarded`, which enforces the human's
 * approval: at most MAX_CALLS calls and MAX_USD estimated spend in total, across all runs. Only models
 * with a price on the Forge LLMs pricing page (read 2026-11-21) can be used, so the estimate is real.
 */

export const MAX_CALLS = 100;
export const MAX_USD = 2.9;

/** USD per 1M tokens, from the Forge LLMs pricing page. */
export const PRICED = {
  sonnet: { model: 'claude-sonnet-4-5-20250929', inPerM: 3, outPerM: 15 },
  haiku: { model: 'claude-haiku-4-5-20251001', inPerM: 1, outPerM: 5 },
} as const;
export type ModelKey = keyof typeof PRICED;

/** Bump when the prompt changes, so a re-run is stored separately from the earlier results. */
export const PROMPT_VERSION = 1;

const BUDGET_KEY = 'exp.e4.budget';
const FORCED_ERROR_MODEL = 'claude-e4-forced-error';

export interface Budget {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  log: { at: string; model: string; ok: boolean; input: number; output: number; usd: number; ms: number }[];
}

export interface CaseResult {
  id: string;
  kind: PilotCase['kind'];
  pass: boolean;
  result: TranslateResult;
  calls: number;
  usd: number;
}

const emptyBudget = (): Budget => ({ calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, log: [] });

export async function budget(): Promise<Budget> {
  return (await getSetting<Budget>(BUDGET_KEY)) ?? emptyBudget();
}

class BudgetExceeded extends Error {}

/** A ChatFn that checks and records the budget around each real call. */
function guarded(model: string, price: { inPerM: number; outPerM: number }): ChatFn & { spent: () => { calls: number; usd: number } } {
  let calls = 0;
  let usd = 0;
  const fn = (async (messages) => {
    const b = await budget();
    if (b.calls >= MAX_CALLS || b.usd >= MAX_USD) throw new BudgetExceeded(`Budget reached: ${b.calls} calls, $${b.usd.toFixed(4)}`);
    const started = Date.now();
    let input = 0;
    let output = 0;
    let ok = false;
    try {
      const res = await chat({ model, messages, max_completion_tokens: 400 });
      ok = true;
      // If usage is missing, count a conservative estimate (about 3 characters per token) instead of zero.
      input = res.usage?.input_tokens ?? Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3);
      output = res.usage?.output_tokens ?? 400;
      return { content: res.choices?.[0]?.message?.content, usage: res.usage };
    } finally {
      const cost = (input * price.inPerM + output * price.outPerM) / 1_000_000;
      calls += 1;
      usd += cost;
      const after = await budget();
      after.calls += 1;
      after.inputTokens += input;
      after.outputTokens += output;
      after.usd += cost;
      after.log.push({ at: new Date().toISOString(), model, ok, input, output, usd: cost, ms: Date.now() - started });
      await setSetting(BUDGET_KEY, after);
    }
  }) as ChatFn & { spent: () => { calls: number; usd: number } };
  fn.spent = () => ({ calls, usd });
  return fn;
}

/** list() is a model-list read, not a prompt; it still counts as one call against the cap. */
export async function listModels(): Promise<{ ok: boolean; models?: unknown; error?: string }> {
  const b = await budget();
  if (b.calls >= MAX_CALLS) return { ok: false, error: 'Budget reached' };
  try {
    const res = await list();
    return { ok: true, models: res.models };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300) };
  } finally {
    const after = await budget();
    after.calls += 1;
    after.log.push({ at: new Date().toISOString(), model: 'list()', ok: true, input: 0, output: 0, usd: 0, ms: 0 });
    await setSetting(BUDGET_KEY, after);
  }
}

const resultsKey = (m: ModelKey) => `exp.e4.v${PROMPT_VERSION}.${m}`;

export async function results(m: ModelKey): Promise<CaseResult[]> {
  return (await getSetting<CaseResult[]>(resultsKey(m))) ?? [];
}

/**
 * Run the next `size` cases for one model. Small batches keep each resolver call well inside the
 * function time limit; the panel calls this until `done`.
 */
export async function runBatch(m: ModelKey, size: number): Promise<{ done: boolean; ran: CaseResult[]; stopped?: string }> {
  const price = PRICED[m];
  const done = await results(m);
  const todo = CASES.filter((c) => !done.some((d) => d.id === c.id)).slice(0, size);
  const ran: CaseResult[] = [];
  for (const c of todo) {
    const fn = guarded(c.kind === 'forced-error' ? FORCED_ERROR_MODEL : price.model, price);
    let result: TranslateResult;
    try {
      result = await translate(c.question, CATALOG, fn);
    } catch (e) {
      if (e instanceof BudgetExceeded) return { done: false, ran, stopped: e.message };
      throw e;
    }
    // A budget stop inside translate() surfaces as model_unavailable; don't record it as a result.
    if (result.status === 'failed' && result.error?.includes('Budget reached')) return { done: false, ran, stopped: result.error };
    const pass = scoreCase(c.expected, result, c.kind === 'forced-error');
    const spent = fn.spent();
    const r: CaseResult = { id: c.id, kind: c.kind, pass, result, calls: spent.calls, usd: spent.usd };
    ran.push(r);
    done.push(r);
    await setSetting(resultsKey(m), done);
    await recordRun('E4', `${m}:${c.id}`, pass, `${pass ? 'pass' : 'FAIL'} ${c.kind} → ${describe(result)}`, { question: c.question, expected: c.expected, ...r });
  }
  return { done: done.length >= CASES.length, ran };
}

function describe(r: TranslateResult): string {
  if (r.status === 'ok') return `ok ${r.requirement.map((k) => (k.value === undefined ? k.key : `${k.key}=${String(k.value)}`)).join(', ')}`;
  if (r.status === 'unsupported') return `unsupported (${r.reason})`;
  return `failed (${r.reason})`;
}

export async function report(): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const m of Object.keys(PRICED) as ModelKey[]) {
    const rs = await results(m);
    const model = rs.filter((r) => r.kind !== 'empty' && r.kind !== 'forced-error');
    const answerable = model.filter((r) => r.kind !== 'unsupported');
    const unsupported = model.filter((r) => r.kind === 'unsupported');
    out[m] = {
      model: PRICED[m].model,
      casesRun: rs.length,
      ofCases: CASES.length,
      answerableExact: `${answerable.filter((r) => r.pass).length}/${answerable.length}`,
      unsupportedMarked: `${unsupported.filter((r) => r.pass).length}/${unsupported.length}`,
      empty: rs.find((r) => r.kind === 'empty')?.pass ?? null,
      forcedError: rs.find((r) => r.kind === 'forced-error')?.pass ?? null,
      retries: rs.filter((r) => r.result.attempts > 1).map((r) => r.id),
      failures: rs.filter((r) => !r.pass).map((r) => `${r.id}: ${describe(r.result)}`),
    };
  }
  const b = await budget();
  out.budget = { calls: b.calls, inputTokens: b.inputTokens, outputTokens: b.outputTokens, usd: Number(b.usd.toFixed(4)), maxCalls: MAX_CALLS, maxUsd: MAX_USD };
  return out;
}

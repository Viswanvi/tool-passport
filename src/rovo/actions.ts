import { z } from 'zod';
import { canPick } from '../engine/audience';
import type { Card } from '../engine/card';
import type { Environment, Groups } from '../engine/model';
import { raiseQuestion, type LoopDeps } from '../loop/requests';
import { handleAsk, type AskHandlerDeps } from '../resolvers/handlers';

/**
 * The Rovo actions (spec F8). `check-tool-readiness` runs the page's own ask (`handleAsk`) for the person in
 * the Forge context and returns the verdict with its labels, in the card's fixed words. `ask-tool-owner` raises
 * the private question for that person's own ask, through the same loop as the page.
 *
 * Identity: `context.principal.accountId`, the second argument Forge passes to every function (Forge docs,
 * "Function arguments"). The inputs come from the model, so none of them is ever an account id, and an extra
 * one is dropped by zod (CLAUDE.md rule 3; the rovo-action page: "never rely on values passed as inputs").
 * Environments the person may not pick are treated as unknown, so their names never leak. No Forge imports.
 */

export interface RovoDeps {
  ask: AskHandlerDeps;
  listTools(): Promise<Array<{ id: number; name: string }>>;
  listEnvironments(toolId: number): Promise<Environment[]>;
  loop: LoopDeps;
}

const own = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);

/** The caller, from the Forge invocation context only. */
export function accountIdOf(context: unknown): string | undefined {
  const id = own(own(context, 'principal'), 'accountId');
  return typeof id === 'string' && id !== '' ? id : undefined;
}

const CheckInput = z.object({
  tool: z.string().trim().min(1).max(200),
  environment: z.string().trim().max(200).optional(),
  question: z.string().trim().min(1).max(2000),
});

const AskOwnerInput = z.object({ askId: z.number().int().positive() });

type Problem = 'not_signed_in' | 'bad_input' | 'unknown_tool' | 'unknown_environment' | 'not_found' | 'not_raised' | 'try_again';

export type CheckReply =
  | {
      ok: true;
      /** The verdict and reason in one line, to say first. */
      answer: string;
      howToReport: string;
      askId: number | null;
      verdict: string;
      reason: string;
      where: string | null;
      evidence: string[];
      checked: string[];
      next: string[];
      nextStep: string | null;
    }
  | { ok: false; problem: Problem; message: string; tools?: string[]; environments?: string[] };

export type AskOwnerReply = { ok: true; raised: string[]; message: string } | { ok: false; problem: Problem; message: string };

const MESSAGES: Record<Problem, string> = {
  not_signed_in: 'Tool Passport could not tell who is asking, so it checked nothing.',
  bad_input: 'Name the tool and ask a question (up to 2000 characters).',
  unknown_tool: 'Tool Passport has no tool by that name.',
  unknown_environment: 'That environment is not one this person can ask about.',
  not_found: 'That question is not one this person asked.',
  not_raised: 'The request could not be raised.',
  try_again: 'Something went wrong while checking. Try again.',
};

const fail = (problem: Problem, extra: { tools?: string[]; environments?: string[] } = {}) => ({ ok: false as const, problem, message: MESSAGES[problem], ...extra });

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const PAGE = 'in Tool Passport (Apps → Tool Passport in Jira)';

/**
 * Any agent may reuse the check (rovo:mcp) and sees only this reply, not our agent's prompt. Found live: a Rovo
 * Studio agent with no instructions answered "No, you cannot…" for Not ready. Fixed words, as on the card.
 */
export const HOW_TO_REPORT =
  "Give the answer first, in these exact words. Keep the verdict word as it is: Yes; Yes, with approval; Not ready; No; or Don't know yet. " +
  'Not ready means something can be set up first, so it is not a No. ' +
  "Don't know yet and Not verified mean nothing is recorded, so never present them as Yes or No. Then list the evidence with its labels.";

/** What the person can do next, in words the agent can pass on. Fixes and approvals stay on the page. */
function nextStep(card: Card, askId: number | null): string | null {
  const a = card.action;
  if (!a) return null;
  const keys = (a.requests ?? []).flatMap((r) => (r.key ? [r.key] : [])).join(', ');
  switch (a.kind) {
    case 'request_fix':
      return `The missing setting can be requested ${PAGE}: open the question there and choose Request the fix.`;
    case 'request_approval':
      return `Approval can be requested ${PAGE}: open the question there and choose Request approval.`;
    case 'fix_requested':
      return `A fix is already requested${keys ? ` (${keys})` : ''}. Tool Passport checks again when it is resolved.`;
    case 'approval_requested':
      return `Approval is already requested${keys ? ` (${keys})` : ''}. Tool Passport checks again when it is decided.`;
    case 'ask_owner':
      return askId === null
        ? `The owner can be asked ${PAGE}.`
        : `The tool owner can be asked privately: if the person agrees, call ask-tool-owner with askId ${askId}.`;
    case 'owner_asked':
      return `The owner was already asked${keys ? ` (${keys})` : ''}.`;
    default:
      return 'Try again.';
  }
}

export async function rovoCheck(payload: unknown, context: unknown, deps: RovoDeps): Promise<CheckReply> {
  const asker = accountIdOf(context);
  if (!asker) return fail('not_signed_in');
  const p = CheckInput.safeParse(payload);
  if (!p.success) return fail('bad_input');
  try {
    const tools = await deps.listTools();
    const tool = tools.find((t) => same(t.name, p.data.tool));
    if (!tool) return fail('unknown_tool', { tools: tools.map((t) => t.name) });

    let environmentId: number | null = null;
    if (p.data.environment) {
      const all = await deps.listEnvironments(tool.id);
      // Groups are read only when some environment is limited to an audience (as the page does).
      const groups: Groups = all.some((e) => e.audienceGroup) ? await deps.ask.readGroups(asker) : { ok: false };
      const pickable = all.filter((e) => canPick(e, groups).ok);
      const env = pickable.find((e) => same(e.name, p.data.environment!));
      if (!env) return fail('unknown_environment', { environments: pickable.map((e) => e.name) });
      environmentId = env.id;
    }

    const r = await handleAsk({ toolId: tool.id, environmentId, question: p.data.question }, { accountId: asker }, deps.ask);
    console.log(`[rovo] check ${r.ok ? `verdict=${r.card.verdict ?? r.card.kind}` : `error=${r.error}`}`);
    if (!r.ok) return fail(r.error === 'not_found' ? 'unknown_tool' : r.error === 'try_again' ? 'try_again' : 'bad_input');
    const c = r.card;
    if (c.kind === 'try_again' || c.verdict === null) return fail('try_again');
    return {
      ok: true,
      answer: `${c.title}. ${c.reason}`,
      howToReport: HOW_TO_REPORT,
      askId: r.askId,
      verdict: c.title,
      reason: c.reason,
      where: c.where,
      evidence: c.chips.map((chip) => `${chip.label} · ${chip.detail}`),
      checked: c.checked,
      next: c.next,
      nextStep: nextStep(c, r.askId),
    };
  } catch (e) {
    console.error(`[rovo] check failed: ${String(e).slice(0, 300)}`);
    return fail('try_again');
  }
}

export async function rovoAskOwner(payload: unknown, context: unknown, deps: RovoDeps): Promise<AskOwnerReply> {
  const asker = accountIdOf(context);
  if (!asker) return fail('not_signed_in');
  const p = AskOwnerInput.safeParse(payload);
  if (!p.success) return fail('bad_input');
  try {
    const r = await raiseQuestion(p.data.askId, asker, deps.loop);
    console.log(`[rovo] ask-owner ${r.ok ? `raised=${r.raised.length}` : `error=${r.error}`}`);
    if (!r.ok) {
      if (r.error === 'not_found' || r.error === 'not_signed_in') return fail(r.error);
      // Not set up, the customer role, a failed raise: the loop's own words for the page say what to do.
      return { ok: false, problem: 'not_raised', message: r.message };
    }
    const message = r.raised.length
      ? `Asked the tool owner privately (${r.raised.join(', ')}). The answer will arrive on that request, and Tool Passport checks again then.`
      : r.card?.action?.kind === 'owner_asked'
        ? 'The owner was already asked about this.'
        : 'Nothing to ask: this question already has an answer.';
    return { ok: true, raised: r.raised, message };
  } catch (e) {
    console.error(`[rovo] ask-owner failed: ${String(e).slice(0, 300)}`);
    return fail('try_again');
  }
}

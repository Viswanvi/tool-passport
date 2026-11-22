import { canPick } from './audience';
import type { CatalogChoice } from './catalog';
import { evaluate, type EvalDeps } from './evaluate';
import { expand } from './expand';
import type { Catalog, Check, Environment, Groups, Outcome, Tool, Verdict } from './model';
import { translate, type ChatFn } from './translate';

/**
 * The answer pipeline (spec section 11, `ask`), without Forge: the resolver passes the asker from the Forge
 * context, the groups it read, and the repositories. Order: audience check → translate (keys only) →
 * expand (code picks the checks) → evaluate (fails safe). An outage of the model is Try again, never an
 * owner request; a question the catalog doesn't cover is Don't know yet with Ask the owner.
 */

export interface AskInput {
  question: string;
  tool: Tool;
  environment: Environment | null;
  asker: string;
  groups: Groups;
  catalog: Catalog;
}

export interface AskDeps extends EvalDeps {
  chat: ChatFn;
}

export type Answer =
  | { state: 'environment_refused'; reason: string }
  | { state: 'try_again'; reason: 'model_unavailable' | 'unreadable_reply' }
  | { state: 'unsupported'; verdict: 'dont_know'; reason: string; settle: 'ask_owner' }
  | {
      state: 'checked';
      verdict: Verdict;
      outcome: Outcome;
      requirement: CatalogChoice[];
      restated: string;
      checks: Check[];
      /** "Any environment": only capability checks ran; the card must say policy, setup and access weren't. */
      anyEnvironment: boolean;
    };

export async function answerQuestion(input: AskInput, deps: AskDeps): Promise<Answer> {
  const { environment } = input;
  if (environment) {
    if (environment.toolId !== input.tool.id) return { state: 'environment_refused', reason: 'That environment belongs to another tool' };
    const pick = canPick(environment, input.groups);
    if (!pick.ok) return { state: 'environment_refused', reason: pick.reason };
  }

  const t = await translate(
    input.question,
    { toolName: input.tool.name, catalog: [...input.catalog.keys.values()], examples: input.catalog.examples },
    deps.chat,
  );
  if (t.status === 'failed') return { state: 'try_again', reason: t.reason };
  if (t.status === 'unsupported') return { state: 'unsupported', verdict: 'dont_know', reason: t.reason, settle: 'ask_owner' };

  const checks = expand(t.requirement, input.catalog, environment);
  // translate() never returns ok without a key, but combine() would throw on an empty list: say so plainly.
  if (checks.length === 0) return { state: 'unsupported', verdict: 'dont_know', reason: "Nothing in this tool's catalog matches the question", settle: 'ask_owner' };

  const outcome = await evaluate(checks, { tool: input.tool, environment, asker: input.asker, groups: input.groups, catalog: input.catalog }, deps);
  return {
    state: 'checked',
    verdict: outcome.verdict,
    outcome,
    requirement: t.requirement,
    restated: t.restated,
    checks,
    anyEnvironment: environment === null,
  };
}

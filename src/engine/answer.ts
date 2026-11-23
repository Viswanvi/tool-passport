import { canPick } from './audience';
import type { CatalogChoice } from './catalog';
import { evaluate, type EvalDeps } from './evaluate';
import { expand } from './expand';
import type { Catalog, Check, Environment, Groups, Outcome, Tool, Verdict } from './model';
import { checkAgainstCatalog, describeRequirement, translate, type ChatFn, type TranslationStore } from './translate';

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
  /** The translations table; keyed here by tool and catalog revision. */
  translations?: TranslationStore;
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
      /** The translation came from the cache (no model call). */
      cached: boolean;
      modelId?: string;
      /** The version the environment's record showed, for the card header ("KS-DEV · 13.2"). */
      environmentVersion: string | null;
    };

export async function answerQuestion(input: AskInput, deps: AskDeps): Promise<Answer> {
  const refused = audienceRefusal(input);
  if (refused) return refused;

  const t = await translate(
    input.question,
    { toolName: input.tool.name, catalog: [...input.catalog.keys.values()], examples: input.catalog.examples },
    deps.chat,
    deps.translations ? { store: deps.translations, toolId: input.tool.id, catalogRevision: input.catalog.revision } : undefined,
  );
  if (t.status === 'failed') return { state: 'try_again', reason: t.reason };
  if (t.status === 'unsupported') return { state: 'unsupported', verdict: 'dont_know', reason: t.reason, settle: 'ask_owner' };

  return checkRequirement(t.requirement, t.restated, input, deps, t.cached, t.modelId);
}

export interface RequirementInput extends Omit<AskInput, 'question'> {
  /** Keys stored with an earlier ask. */
  requirement: CatalogChoice[];
}

/**
 * Re-check (spec F4): evaluate the keys stored with an ask again, fresh, with no model call. The stored keys
 * are checked against today's catalog first, as cached translations are: a key that's gone, or a value on a
 * key that no longer takes one, is Don't know yet, never a guess. `cached` is true: no model was asked.
 */
export async function answerRequirement(input: RequirementInput, deps: EvalDeps): Promise<Answer> {
  const refused = audienceRefusal(input);
  if (refused) return refused;
  const catalog = [...input.catalog.keys.values()];
  const checked = input.requirement.length ? checkAgainstCatalog({ capabilities: input.requirement, unsupported: null, restated: '' }, catalog) : null;
  if (!checked || 'problem' in checked || JSON.stringify(checked.requirement) !== JSON.stringify(input.requirement)) {
    return { state: 'unsupported', verdict: 'dont_know', reason: 'The catalog changed since this was asked', settle: 'ask_owner' };
  }
  return checkRequirement(checked.requirement, describeRequirement(checked.requirement, catalog), input, deps, true);
}

function audienceRefusal(input: Pick<AskInput, 'tool' | 'environment' | 'groups'>): Answer | null {
  const { environment } = input;
  if (!environment) return null;
  if (environment.toolId !== input.tool.id) return { state: 'environment_refused', reason: 'That environment belongs to another tool' };
  const pick = canPick(environment, input.groups);
  return pick.ok ? null : { state: 'environment_refused', reason: pick.reason };
}

async function checkRequirement(
  requirement: CatalogChoice[],
  restated: string,
  input: Omit<AskInput, 'question'>,
  deps: EvalDeps,
  cached: boolean,
  modelId?: string,
): Promise<Answer> {
  const { environment } = input;
  const checks = expand(requirement, input.catalog, environment);
  // translate() never returns ok without a key, but combine() would throw on an empty list: say so plainly.
  if (checks.length === 0) return { state: 'unsupported', verdict: 'dont_know', reason: "Nothing in this tool's catalog matches the question", settle: 'ask_owner' };

  // Remember the version the read showed, for the card header; the read itself happens once, in evaluate().
  let environmentVersion: string | null = null;
  const environments = {
    read: async (e: Environment) => {
      const r = await deps.environments.read(e);
      if (r.ok) environmentVersion = r.version;
      return r;
    },
  };
  const outcome = await evaluate(checks, { tool: input.tool, environment, asker: input.asker, groups: input.groups, catalog: input.catalog }, { ...deps, environments });
  const answer: Answer = {
    state: 'checked',
    verdict: outcome.verdict,
    outcome,
    requirement,
    restated,
    checks,
    anyEnvironment: environment === null,
    cached,
    environmentVersion,
  };
  return modelId ? { ...answer, modelId } : answer;
}

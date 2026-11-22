import type { ChatFn, ChatMessage, ChatReply } from '../engine/translate';

/**
 * Model choice (spec section 13, `chooseModel`). The manifest declares the Claude family; code needs an
 * exact id, picked from the live `list()` reply, never hard-coded as the only option. The preference order
 * comes from E4 (both scored 20/20; Haiku 5.5 costs a quarter of Sonnet 5.5) and is reviewed after the
 * 40-question set. No Forge imports: `list()`, `chat()` and settings are passed in.
 */

export const PREFERRED_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;

export interface ModelSetting {
  model: string;
  chosenAt: string;
}

export interface ModelDeps {
  getSetting(): Promise<unknown>;
  setSetting(value: ModelSetting): Promise<void>;
  /** The raw `list().models` reply: `[{ model, status: 'active' | 'deprecated' }]`. */
  listModels(): Promise<unknown>;
  now?: () => string;
}

function activeModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return models
    .filter((m): m is { model: string; status: unknown } => !!m && typeof m === 'object' && typeof (m as { model?: unknown }).model === 'string')
    .filter((m) => m.status === 'active')
    .map((m) => m.model);
}

/**
 * First preferred model that is active; otherwise an active Claude model, cheapest family first (haiku,
 * then sonnet, then any), so a retired preference list keeps the app answering instead of failing.
 */
export function chooseModel(models: unknown, preferred: readonly string[] = PREFERRED_MODELS): string | null {
  const active = activeModels(models);
  const claude = active.filter((id) => id.startsWith('claude'));
  return (
    preferred.find((id) => active.includes(id)) ??
    claude.find((id) => id.includes('haiku')) ??
    claude.find((id) => id.includes('sonnet')) ??
    claude[0] ??
    null
  );
}

function storedModel(v: unknown): string | null {
  return v && typeof v === 'object' && typeof (v as { model?: unknown }).model === 'string' ? (v as ModelSetting).model : null;
}

async function chooseAndStore(deps: ModelDeps): Promise<string | null> {
  const chosen = chooseModel(await deps.listModels());
  if (chosen) await deps.setSetting({ model: chosen, chosenAt: (deps.now ?? (() => new Date().toISOString()))() });
  return chosen;
}

/** The stored choice (made by the setup wizard, or here on first use before setup has run). */
export async function currentModel(deps: ModelDeps): Promise<string | null> {
  return storedModel(await deps.getSetting()) ?? chooseAndStore(deps);
}

/**
 * A chat function for translate(). It uses the current model and reports which one answered. If the call
 * fails and the model is no longer listed as active (retired), it switches once to the next choice and
 * tries again, so a retirement during judging doesn't leave every question on Try again. A model that is
 * still active just failed: the error goes up and the question shows Try again, with no switch.
 */
export function modelChat(deps: ModelDeps, call: (model: string, messages: ChatMessage[]) => Promise<ChatReply>): ChatFn {
  let model: string | null = null;
  let switched = false;
  return async (messages) => {
    model ??= await currentModel(deps);
    if (!model) throw new Error('No model is available for translation');
    try {
      return { ...(await call(model, messages)), model };
    } catch (e) {
      if (switched) throw e;
      switched = true;
      let next: string | null = null;
      try {
        const listed = await deps.listModels();
        if (!activeModels(listed).includes(model)) next = chooseModel(listed);
      } catch {
        throw e; // can't tell why it failed: report the original error
      }
      if (!next || next === model) throw e;
      await deps.setSetting({ model: next, chosenAt: (deps.now ?? (() => new Date().toISOString()))() });
      model = next;
      return { ...(await call(model, messages)), model };
    }
  };
}

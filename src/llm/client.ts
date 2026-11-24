import { chat, list } from '@forge/llm';
import { getSetting, setSetting } from '../db/store';
import type { ChatFn } from '../engine/translate';
import { modelChat, type ModelDeps } from './model-choice';

/**
 * The Forge side of the model layer: `list()` and `chat()` from `@forge/llm` (shapes confirmed in E4) and
 * the stored choice in `app_settings`. Every call here is billed to the developer: callers make at most two
 * per new question, none for a cached one (spec section 13).
 */

export const MODEL_SETTING = 'llm.model';

/** E4 replies used about 50 output tokens; 400 leaves room for four keys and a restatement. */
const MAX_COMPLETION_TOKENS = 400;

export const forgeModelDeps: ModelDeps = {
  getSetting: () => getSetting<unknown>(MODEL_SETTING),
  setSetting: (value) => setSetting(MODEL_SETTING, value),
  listModels: async () => (await list()).models,
};

/** A fresh chat function per question (it remembers a model switch for that question only). */
export function translationChat(): ChatFn {
  return modelChat(forgeModelDeps, async (model, messages) => {
    // No temperature: newer models reject it (E4).
    const res = await chat({ model, messages, max_completion_tokens: MAX_COMPLETION_TOKENS });
    return { content: res.choices?.[0]?.message?.content, usage: res.usage };
  });
}

/** Release-note labels (F9): one call per paste, a label and a short quote per fact, so more room. */
const LABEL_COMPLETION_TOKENS = 2000;

export function labelChat(): ChatFn {
  return modelChat(forgeModelDeps, async (model, messages) => {
    const res = await chat({ model, messages, max_completion_tokens: LABEL_COMPLETION_TOKENS });
    return { content: res.choices?.[0]?.message?.content, usage: res.usage };
  });
}

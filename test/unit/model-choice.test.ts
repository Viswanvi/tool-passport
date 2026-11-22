import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatReply } from '../../src/engine/translate';
import { chooseModel, currentModel, modelChat, PREFERRED_MODELS, type ModelDeps, type ModelSetting } from '../../src/llm/model-choice';

const m = (model: string, status = 'active') => ({ model, status });
const LIVE = [m('claude-opus-5-5'), m('claude-sonnet-5-5'), m('claude-haiku-5-5'), m('claude-haiku-4-5', 'deprecated')];

function deps(models: unknown, stored: ModelSetting | null = null) {
  const state = { stored, lists: 0, saved: [] as ModelSetting[] };
  const d: ModelDeps = {
    async getSetting() {
      return state.stored;
    },
    async setSetting(v) {
      state.stored = v;
      state.saved.push(v);
    },
    async listModels() {
      state.lists += 1;
      return typeof models === 'function' ? (models as () => unknown)() : models;
    },
    now: () => '2026-11-22T10:00:00.000Z',
  };
  return { d, state };
}

describe('chooseModel()', () => {
  it('takes the first preferred model that is active', () => {
    expect(PREFERRED_MODELS[0]).toBe('claude-haiku-5-5');
    expect(chooseModel(LIVE)).toBe('claude-haiku-5-5');
    expect(chooseModel([m('claude-haiku-5-5', 'deprecated'), m('claude-sonnet-5-5')])).toBe('claude-sonnet-5-5');
  });

  it('falls back to an active haiku, then sonnet, then any claude model', () => {
    expect(chooseModel([m('claude-opus-6'), m('claude-sonnet-6'), m('claude-haiku-6')])).toBe('claude-haiku-6');
    expect(chooseModel([m('claude-opus-6'), m('claude-sonnet-6')])).toBe('claude-sonnet-6');
    expect(chooseModel([m('claude-opus-6')])).toBe('claude-opus-6');
  });

  it('returns null when nothing usable is listed, whatever the reply looks like', () => {
    for (const bad of [[], [m('claude-haiku-5-5', 'deprecated')], [m('other-model')], null, 'x', { models: LIVE }, [{ id: 'claude-haiku-5-5' }]]) {
      expect(chooseModel(bad)).toBeNull();
    }
  });
});

describe('currentModel()', () => {
  it('uses the stored choice without listing models', async () => {
    const { d, state } = deps(LIVE, { model: 'claude-sonnet-5-5', chosenAt: 'x' });
    expect(await currentModel(d)).toBe('claude-sonnet-5-5');
    expect(state.lists).toBe(0);
  });

  it('chooses and stores a model when none is stored (before the setup wizard runs)', async () => {
    const { d, state } = deps(LIVE);
    expect(await currentModel(d)).toBe('claude-haiku-5-5');
    expect(state.saved).toEqual([{ model: 'claude-haiku-5-5', chosenAt: '2026-11-22T10:00:00.000Z' }]);
  });

  it('ignores a malformed stored value', async () => {
    const { d } = deps(LIVE, { model: 42 } as unknown as ModelSetting);
    expect(await currentModel(d)).toBe('claude-haiku-5-5');
  });
});

describe('modelChat()', () => {
  const MESSAGES: ChatMessage[] = [{ role: 'user', content: '<question>q</question>' }];
  const reply: ChatReply = { content: '{}' };

  it('calls the chosen model and reports which one answered', async () => {
    const { d } = deps(LIVE);
    const call = vi.fn().mockResolvedValue(reply);
    const chat = modelChat(d, call);
    expect(await chat(MESSAGES)).toEqual({ ...reply, model: 'claude-haiku-5-5' });
    expect(call).toHaveBeenCalledWith('claude-haiku-5-5', MESSAGES);
  });

  it('when the stored model was retired, switches once and answers in the same question', async () => {
    const { d, state } = deps([m('claude-haiku-5-5', 'deprecated'), m('claude-sonnet-5-5')], { model: 'claude-haiku-5-5', chosenAt: 'x' });
    const call = vi.fn(async (model: string) => {
      if (model === 'claude-haiku-5-5') throw new Error('claude-haiku-5-5 model is not supported');
      return reply;
    });
    const chat = modelChat(d, call);
    expect(await chat(MESSAGES)).toMatchObject({ model: 'claude-sonnet-5-5' });
    expect(state.stored?.model).toBe('claude-sonnet-5-5');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('a passing outage keeps the stored model and surfaces the error (Try again)', async () => {
    const { d, state } = deps(LIVE, { model: 'claude-haiku-5-5', chosenAt: 'x' });
    const call = vi.fn().mockRejectedValue(new Error('503'));
    await expect(modelChat(d, call)(MESSAGES)).rejects.toThrow('503');
    expect(state.stored?.model).toBe('claude-haiku-5-5');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('switches at most once per question, and throws when no model is available', async () => {
    const { d } = deps(() => [m('claude-sonnet-5-5')], { model: 'claude-haiku-5-5', chosenAt: 'x' });
    const call = vi.fn().mockRejectedValue(new Error('not supported'));
    const chat = modelChat(d, call);
    await expect(chat(MESSAGES)).rejects.toThrow();
    await expect(chat(MESSAGES)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(3); // haiku, then sonnet once; the second attempt doesn't switch again

    const none = deps([]);
    const never = vi.fn();
    await expect(modelChat(none.d, never)(MESSAGES)).rejects.toThrow(/no model/i);
    expect(never).not.toHaveBeenCalled();
  });

  it('a failure to list models during the switch surfaces the original error', async () => {
    const { d } = deps(() => {
      throw new Error('list failed');
    }, { model: 'claude-haiku-5-5', chosenAt: 'x' });
    const call = vi.fn().mockRejectedValue(new Error('original'));
    await expect(modelChat(d, call)(MESSAGES)).rejects.toThrow('original');
  });
});

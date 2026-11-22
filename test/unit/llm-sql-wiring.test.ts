import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Forge-facing wiring with `@forge/sql` and `@forge/llm` faked: which statements and parameters go out,
 * and what the chat call sends. Real Forge SQL and LLM behaviour is checked on the development site.
 */

const statements: Array<{ query: string; params: unknown[] }> = [];
let nextRows: unknown = [];
vi.mock('@forge/sql', () => ({
  sql: {
    prepare: (query: string) => ({
      bindParams: (...params: unknown[]) => ({
        execute: async () => {
          statements.push({ query, params });
          return { rows: nextRows };
        },
      }),
    }),
  },
}));

const llmChat = vi.fn();
const llmList = vi.fn();
vi.mock('@forge/llm', () => ({ chat: (p: unknown) => llmChat(p), list: () => llmList() }));

const { sqlTranslationStore } = await import('../../src/db/translations-sql');
const { translationChat, MODEL_SETTING } = await import('../../src/llm/client');

const KEY = { toolId: 1, catalogRevision: 7, questionHash: 'a'.repeat(64) };

beforeEach(() => {
  statements.length = 0;
  nextRows = [];
  llmChat.mockReset();
  llmList.mockReset();
});

describe('sqlTranslationStore', () => {
  it('reads by tool, revision and hash, accepting a parsed or string JSON column', async () => {
    nextRows = [{ requirement_json: [{ key: 'web_frontend' }] }];
    expect(await sqlTranslationStore.get(KEY)).toEqual([{ key: 'web_frontend' }]);
    nextRows = [{ requirement_json: '[{"key":"web_frontend"}]' }];
    expect(await sqlTranslationStore.get(KEY)).toEqual([{ key: 'web_frontend' }]);
    nextRows = [];
    expect(await sqlTranslationStore.get(KEY)).toBeNull();
    expect(statements[0]).toMatchObject({ params: [1, 7, KEY.questionHash] });
    expect(statements[0]!.query).toMatch(/WHERE tool_id = \? AND catalog_revision = \? AND question_hash = \?/);
  });

  it('writes keys, values and model id with an insert that is safe to repeat', async () => {
    await sqlTranslationStore.put(KEY, [{ key: 'max_upload_gb', value: 3 }], 'claude-haiku-5-5');
    expect(statements[0]!.query).toMatch(/INSERT INTO translations .*ON DUPLICATE KEY UPDATE id = id/s);
    expect(statements[0]!.params).toEqual([1, 7, KEY.questionHash, '[{"key":"max_upload_gb","value":3}]', 'claude-haiku-5-5']);
  });
});

describe('translationChat', () => {
  const MESSAGES = [{ role: 'user' as const, content: '<question>q</question>' }];

  it('chooses from list() on first use, stores it, and sends model, messages and the token cap', async () => {
    nextRows = []; // no stored model
    llmList.mockResolvedValue({ models: [{ model: 'claude-sonnet-5-5', status: 'active' }, { model: 'claude-haiku-5-5', status: 'active' }] });
    llmChat.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"x":1}' } }], usage: { input_tokens: 10, output_tokens: 5 } });
    const reply = await translationChat()(MESSAGES);
    expect(reply).toEqual({ content: '{"x":1}', usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-haiku-5-5' });
    expect(llmChat).toHaveBeenCalledWith({ model: 'claude-haiku-5-5', messages: MESSAGES, max_completion_tokens: 400 });
    const save = statements.find((s) => s.query.startsWith('INSERT INTO app_settings'));
    expect(save?.params[0]).toBe(MODEL_SETTING);
    expect(JSON.parse(save?.params[1] as string)).toMatchObject({ model: 'claude-haiku-5-5' });
  });

  it('uses the stored model without listing', async () => {
    nextRows = [{ value_json: { model: 'claude-sonnet-5-5', chosenAt: 'x' } }];
    llmChat.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] });
    await translationChat()(MESSAGES);
    expect(llmList).not.toHaveBeenCalled();
    expect(llmChat.mock.calls[0]![0]).toMatchObject({ model: 'claude-sonnet-5-5' });
  });
});

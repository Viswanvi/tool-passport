import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory settings instead of Forge SQL; a fake @forge/llm that reports token usage. No network, no cost.
const settings = new Map<string, unknown>();
vi.mock('../../src/db/store', () => ({
  getSetting: vi.fn(async (name: string) => (settings.has(name) ? structuredClone(settings.get(name)) : null)),
  setSetting: vi.fn(async (name: string, value: unknown) => {
    settings.set(name, structuredClone(value));
  }),
  recordRun: vi.fn(async () => undefined),
}));
const chat = vi.fn();
vi.mock('@forge/llm', () => ({ chat: (...a: unknown[]) => chat(...a), list: vi.fn() }));

const { runBatch, budget, MAX_CALLS } = await import('../../src/experiments/e4');

const goodReply = {
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"capabilities":[{"key":"web_frontend"}],"unsupported":null,"restated":"x"}' } }],
  usage: { input_tokens: 4000, output_tokens: 100 },
};

describe('E4 budget guard (the human approved at most 100 calls / $3)', () => {
  beforeEach(() => {
    settings.clear();
    chat.mockReset();
    chat.mockResolvedValue(goodReply);
  });

  it('records each call and its cost from the reported usage', async () => {
    await runBatch('sonnet', 1);
    const b = await budget();
    expect(b.calls).toBe(1);
    expect(b.usd).toBeCloseTo((4000 * 3 + 100 * 15) / 1_000_000, 10);
  });

  it('stops at the call cap without calling the model again', async () => {
    settings.set('exp.e4.budget', { calls: MAX_CALLS - 1, inputTokens: 0, outputTokens: 0, usd: 0, log: [] });
    const res = await runBatch('sonnet', 5);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(res.stopped).toMatch(/Budget reached/);
    expect((await budget()).calls).toBe(MAX_CALLS);
  });

  it('stops at the spend cap before any call', async () => {
    settings.set('exp.e4.budget', { calls: 0, inputTokens: 0, outputTokens: 0, usd: 2.95, log: [] });
    const res = await runBatch('haiku', 5);
    expect(chat).not.toHaveBeenCalled();
    expect(res.stopped).toMatch(/Budget reached/);
    expect(res.ran).toHaveLength(0);
  });
});

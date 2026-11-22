import { describe, expect, it, vi } from 'vitest';
import {
  describeRequirement,
  normaliseQuestion,
  questionHash,
  translate,
  type CacheKey,
  type ChatFn,
  type TranslationContext,
  type TranslationStore,
} from '../../src/engine/translate';
import { DEMO_CATALOG, DEMO_EXAMPLES, DEMO_TOOL_NAME } from '../../src/seed/demo-catalog';

const ctx: TranslationContext = { toolName: DEMO_TOOL_NAME, catalog: DEMO_CATALOG, examples: DEMO_EXAMPLES };
const UPLOAD_3 = { capabilities: [{ key: 'max_upload_gb', value: 3 }], unsupported: null, restated: 'Upload a 3 GB file with patient names.' };

function model(reply: unknown = UPLOAD_3): ChatFn & { calls: () => number } {
  const mock = vi.fn().mockResolvedValue({ content: JSON.stringify(reply), model: 'claude-haiku-5-5' });
  return Object.assign((m: Parameters<ChatFn>[0]) => mock(m), { calls: () => mock.mock.calls.length });
}

/** An in-memory translations table: (tool, revision, hash) → stored JSON, as Forge SQL would hold it. */
function memoryStore() {
  const rows = new Map<string, { requirement: unknown; modelId: string | null }>();
  const id = (k: CacheKey) => `${k.toolId}|${k.catalogRevision}|${k.questionHash}`;
  const store: TranslationStore = {
    async get(k) {
      return rows.get(id(k))?.requirement ?? null;
    },
    async put(k, requirement, modelId) {
      if (!rows.has(id(k))) rows.set(id(k), { requirement: JSON.parse(JSON.stringify(requirement)), modelId });
    },
  };
  return { store, rows };
}

const bind = (store: TranslationStore, catalogRevision = 1) => ({ store, toolId: 1, catalogRevision });

describe('question hashing', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(normaliseQuestion('  Can I upload   a 3 GB file?? ')).toBe('can i upload a 3 gb file');
    expect(questionHash('Can I upload a 3 GB file?')).toBe(questionHash('can i upload a 3 gb file'));
    expect(questionHash('Can I upload a 3 GB file?')).not.toBe(questionHash('Can I upload a 4 GB file?'));
    expect(questionHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('translation cache', () => {
  it('a repeated question makes no model call and gives the same keys', async () => {
    const { store } = memoryStore();
    const chat = model();
    const first = await translate('Can I upload a 3 GB file?', ctx, chat, bind(store));
    const second = await translate('can i upload a 3 GB file', ctx, chat, bind(store));
    expect(first).toMatchObject({ status: 'ok', cached: false, attempts: 1 });
    expect(second).toMatchObject({ status: 'ok', cached: true, attempts: 0, requirement: [{ key: 'max_upload_gb', value: 3 }] });
    expect(chat.calls()).toBe(1);
  });

  it('stores keys, values and the model id only: no question text, no model wording', async () => {
    const { store, rows } = memoryStore();
    await translate('Can I upload a 3 GB file with patient names?', ctx, model(), bind(store));
    const stored = JSON.stringify([...rows.entries()]);
    expect(stored).not.toMatch(/patient|upload a 3/i);
    expect([...rows.values()]).toEqual([{ requirement: [{ key: 'max_upload_gb', value: 3 }], modelId: 'claude-haiku-5-5' }]);
  });

  it('on a hit, the restatement is rebuilt from catalog labels', async () => {
    const { store } = memoryStore();
    await translate('Can I upload a 3 GB file?', ctx, model(), bind(store));
    const hit = await translate('Can I upload a 3 GB file?', ctx, model(), bind(store));
    expect(hit).toMatchObject({ restated: 'Upload a file of a given size: 3' });
    expect(describeRequirement([{ key: 'web_frontend' }, { key: 'max_upload_gb', value: 2 }], DEMO_CATALOG)).toBe(
      'Build a custom web front end or dashboard; Upload a file of a given size: 2',
    );
  });

  it('a new catalog revision means a fresh translation', async () => {
    const { store } = memoryStore();
    const chat = model();
    await translate('Can I upload a 3 GB file?', ctx, chat, bind(store, 1));
    await translate('Can I upload a 3 GB file?', ctx, chat, bind(store, 2));
    expect(chat.calls()).toBe(2);
  });

  it('never caches unsupported, failed or empty results', async () => {
    const { store, rows } = memoryStore();
    await translate('Dark mode?', ctx, model({ capabilities: [], unsupported: 'dark mode', restated: '' }), bind(store));
    await translate('Anything?', ctx, model('not json'), bind(store));
    await translate('   ', ctx, model(), bind(store));
    await translate('q', ctx, (async () => {
      throw new Error('down');
    }) as ChatFn, bind(store));
    expect(rows.size).toBe(0);
  });

  it('a stored row that no longer fits the catalog is ignored and the model asked again', async () => {
    const { store, rows } = memoryStore();
    const key = { toolId: 1, catalogRevision: 1, questionHash: questionHash('Can I upload a 3 GB file?') };
    const poisoned: unknown[] = [
      [{ key: 'approved_by_manager' }],
      [{ key: 'max_upload_gb' }],
      [{ key: 'max_upload_gb', value: 'lots' }],
      'web_frontend',
      [],
      { capabilities: [{ key: 'web_frontend' }] },
    ];
    for (const bad of poisoned) {
      rows.clear();
      rows.set(`1|1|${key.questionHash}`, { requirement: bad, modelId: null });
      const chat = model();
      const r = await translate('Can I upload a 3 GB file?', ctx, chat, bind(store));
      expect(r, JSON.stringify(bad)).toMatchObject({ status: 'ok', cached: false, requirement: [{ key: 'max_upload_gb', value: 3 }] });
      expect(chat.calls()).toBe(1);
    }
  });

  it('a cache that fails to read or write never changes the answer', async () => {
    const broken: TranslationStore = {
      get: async () => {
        throw new Error('SQL down');
      },
      put: async () => {
        throw new Error('SQL down');
      },
    };
    const r = await translate('Can I upload a 3 GB file?', ctx, model(), bind(broken));
    expect(r).toMatchObject({ status: 'ok', cached: false, requirement: [{ key: 'max_upload_gb', value: 3 }] });
  });
});

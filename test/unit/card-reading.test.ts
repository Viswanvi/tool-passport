import { describe, expect, it } from 'vitest';
import type { SavedAsk } from '../../src/db/asks';
import { answerQuestion } from '../../src/engine/answer';
import { buildCard, readLabels } from '../../src/engine/card';
import { finishAsk, handleAsk, type AskHandlerDeps } from '../../src/resolvers/handlers';
import type { Card } from '../../src/engine/card';
import { askInput, DASHBOARD, demoWorld, depsFor, DEV, modelReplying, PRIYA, WEB, type World } from '../support/demo-world';

/** The card without the given fields. */
const without = (card: Card, ...keys: Array<keyof Card>) => Object.fromEntries(Object.entries(card).filter(([k]) => !keys.includes(k as keyof Card)));

/**
 * The reading step on the card (D58): what the question was read as, in the catalog's own labels, and whether the
 * model read it. The page shows it so the reading is visible; the verdict still comes from the rules alone.
 */

function askDeps(w: World): AskHandlerDeps {
  const base = depsFor(w, modelReplying(WEB));
  return {
    loadTool: async (id) => (id === w.tool.id ? w.tool : null),
    loadEnvironment: async (id) => w.environments.find((e) => e.id === id) ?? null,
    loadCatalog: async () => w.catalog,
    readGroups: async (accountId) => w.groups.get(accountId) ?? { ok: false },
    chat: () => base.chat,
    repo: base.repo,
    environments: base.environments,
    saveAsk: async (a: SavedAsk) => (a.askerAccountId ? 5 : null),
  };
}

describe('what the question was read as', () => {
  it("uses the catalog's labels, with a value and its short unit", () => {
    const w = demoWorld();
    expect(readLabels([{ key: 'web_frontend' }], w.catalog)).toEqual(['Build a custom web front end or dashboard']);
    expect(readLabels([{ key: 'max_upload_gb', value: 3 }], w.catalog)).toEqual(['Upload a file of a given size · 3 GB']);
  });

  it('a typed question is marked as read by the model; the card text never mentions it', async () => {
    const w = demoWorld();
    const r = await handleAsk({ toolId: 1, environmentId: DEV, question: DASHBOARD }, { accountId: PRIYA }, askDeps(w));
    expect(r).toMatchObject({ ok: true, card: { read: ['Build a custom web front end or dashboard'], readBy: 'model', verdict: 'not_ready' } });
    expect(JSON.stringify(without(r.card!, 'read', 'readBy'))).not.toMatch(/\b(AI|model)\b/i);
  });

  it('a Passport cell and a stored re-check are not marked as read by the model', async () => {
    const w = demoWorld();
    const input = askInput(w, DASHBOARD, DEV);
    const answer = await answerQuestion(input, depsFor(w, modelReplying(WEB)));
    expect(buildCard(answer, { toolName: w.tool.name, environment: input.environment, catalog: w.catalog })).toMatchObject({ readBy: null, read: ['Build a custom web front end or dashboard'] });
    const cell = await finishAsk(answer, { asker: PRIYA, tool: w.tool, environment: input.environment, catalog: w.catalog, question: 'q', source: 'passport' }, { saveAsk: async () => 1 });
    expect(cell).toMatchObject({ ok: true, card: { readBy: null } });
  });

  it('the reading never changes the verdict: the same keys give the same card whoever read them', async () => {
    const w = demoWorld();
    const input = askInput(w, DASHBOARD, DEV);
    const answer = await answerQuestion(input, depsFor(w, modelReplying(WEB)));
    const typed = await finishAsk(answer, { asker: PRIYA, tool: w.tool, environment: input.environment, catalog: w.catalog, question: 'q', source: 'ask' }, { saveAsk: async () => 1 });
    const cell = await finishAsk(answer, { asker: PRIYA, tool: w.tool, environment: input.environment, catalog: w.catalog, question: 'q', source: 'passport' }, { saveAsk: async () => 1 });
    expect(without(typed.card!, 'readBy')).toEqual(without(cell.card!, 'readBy'));
  });
});

import { describe, expect, it } from 'vitest';
import type { SavedAsk } from '../../src/db/asks';
import { answerRequirement } from '../../src/engine/answer';
import { buildCard } from '../../src/engine/card';
import type { Groups } from '../../src/engine/model';
import { handleAskKey, handlePassport, type PassportDeps } from '../../src/resolvers/passport-handlers';
import { demoWorld, depsFor, DEV, modelThrowing, PRIYA, PROD, SAM, type World } from '../support/demo-world';

/**
 * The Passport overview: every plain capability of a tool against every environment the person may pick, each
 * cell the verdict the Ask page would give for that capability, from the catalog key itself (no model call).
 * Clicking a cell asks that exact key, saved like any ask, so its card can raise requests.
 */

function deps(w: World, saved: SavedAsk[] = [], groupsRead: string[] = []) {
  const model = modelThrowing();
  const base = depsFor(w, model);
  const d: PassportDeps = {
    loadTool: async (id) => (id === w.tool.id ? w.tool : null),
    loadEnvironment: async (id) => w.environments.find((e) => e.id === id) ?? null,
    listEnvironments: async () => w.environments,
    loadCatalog: async () => w.catalog,
    readGroups: async (a): Promise<Groups> => {
      groupsRead.push(a);
      return w.groups.get(a) ?? { ok: false };
    },
    repo: base.repo,
    environments: base.environments,
    saveAsk: async (a) => {
      saved.push(a);
      return saved.length;
    },
  };
  return { d, model, saved, groupsRead };
}

describe('the Passport overview', () => {
  it('KS-DEV and KS-PROD for every plain capability, most checks first, each cell the Ask page verdict, no model call', async () => {
    const w = demoWorld();
    const { d, model } = deps(w);
    const r = await handlePassport({ toolId: 1 }, { accountId: PRIYA }, d);
    if (!r.ok) throw new Error(r.reason);
    expect(r.environments.map((e) => [e.name, e.version])).toEqual([
      ['KS-DEV', '13.2'],
      ['KS-PROD', '13.2'],
    ]);
    expect(r.rows[0]!.key).toBe('web_frontend');
    expect(r.rows.map((x) => x.key)).toContain('websockets');
    expect(r.rows.some((x) => x.key === 'max_upload_gb')).toBe(false);
    const web = r.rows[0]!;
    expect(web.cells.map((c) => [c.environmentId, c.title])).toEqual([
      [DEV, 'Not ready'],
      [PROD, 'No'],
    ]);
    for (const row of r.rows) {
      for (const cell of row.cells) {
        const env = w.environments.find((e) => e.id === cell.environmentId)!;
        const answer = await answerRequirement(
          { requirement: [{ key: row.key }], tool: w.tool, environment: env, asker: PRIYA, groups: w.groups.get(PRIYA)!, catalog: w.catalog },
          { repo: depsFor(w, modelThrowing()).repo, environments: depsFor(w, modelThrowing()).environments },
        );
        const card = buildCard(answer, { toolName: w.tool.name, environment: env, catalog: w.catalog });
        expect([row.key, cell.title, cell.lozenge, cell.reason]).toEqual([row.key, card.title, card.lozenge, card.reason]);
      }
    }
    expect(r.rows.find((x) => x.key === 'websockets')!.cells.map((c) => c.title)).toEqual(["Don't know yet", "Don't know yet"]);
    expect(model.calls).toBe(0);
  });

  it("reads each environment's record once, however many rows there are", async () => {
    const w = demoWorld();
    await handlePassport({ toolId: 1 }, { accountId: PRIYA }, deps(w).d);
    expect(w.reads.filter((x) => x === 'env:KS-DEV')).toHaveLength(1);
    expect(w.reads.filter((x) => x === 'env:KS-PROD')).toHaveLength(1);
  });

  it('shows only the environments this person may pick', async () => {
    const w = demoWorld();
    w.environments.find((e) => e.id === DEV)!.audienceGroup = 'kestrel-admins';
    const r = await handlePassport({ toolId: 1 }, { accountId: PRIYA }, deps(w).d);
    expect(r).toMatchObject({ ok: true, environments: [{ name: 'KS-PROD' }] });
    if (r.ok) for (const row of r.rows) expect(row.cells.map((c) => c.environmentId)).toEqual([PROD]);
  });

  it('checks as the signed-in person only; an account id in the payload is ignored', async () => {
    const w = demoWorld();
    const { d, groupsRead } = deps(w);
    await handlePassport({ toolId: 1, accountId: PRIYA }, { accountId: SAM }, d);
    expect(groupsRead).toEqual([SAM]);
    expect(await handlePassport({ toolId: 1 }, {}, d)).toMatchObject({ ok: false });
    expect(await handlePassport({ toolId: 99 }, { accountId: PRIYA }, d)).toMatchObject({ ok: false });
  });

  it("a cell that can't be checked says so, and never says Yes", async () => {
    const w = demoWorld();
    const { d } = deps(w);
    const broken: PassportDeps = { ...d, repo: { ...d.repo, facts: async () => Promise.reject(new Error('SQL timed out')) } };
    const r = await handlePassport({ toolId: 1 }, { accountId: PRIYA }, broken);
    if (!r.ok) throw new Error(r.reason);
    for (const row of r.rows) for (const c of row.cells) expect(c.title).not.toMatch(/^Yes/);
  });
});

describe('asking one cell', () => {
  it('asks that key in that environment with no model call, and saves it so the card can raise requests', async () => {
    const w = demoWorld();
    const { d, model, saved } = deps(w);
    const r = await handleAskKey({ toolId: 1, environmentId: DEV, key: 'web_frontend' }, { accountId: PRIYA }, d);
    expect(r).toMatchObject({ ok: true, askId: 1, card: { title: 'Not ready', action: { kind: 'request_fix' } } });
    expect(saved).toEqual([
      expect.objectContaining({ askerAccountId: PRIYA, toolId: 1, environmentId: DEV, questionText: 'Can I build a custom web front end or dashboard?', requirement: [{ key: 'web_frontend' }], verdict: 'not_ready' }),
    ]);
    expect(model.calls).toBe(0);
  });

  it('only plain capabilities of the catalog can be asked this way', async () => {
    const { d, saved } = deps(demoWorld());
    for (const key of ['max_upload_gb', 'custom_ui', 'frontend_build', 'no_such_key']) {
      expect(await handleAskKey({ toolId: 1, environmentId: DEV, key }, { accountId: PRIYA }, d)).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(saved).toEqual([]);
  });

  it('needs a signed-in person, and an environment outside their audience is refused, not saved', async () => {
    const w = demoWorld();
    const { d, saved } = deps(w);
    expect(await handleAskKey({ toolId: 1, environmentId: DEV, key: 'web_frontend' }, {}, d)).toMatchObject({ ok: false, error: 'not_signed_in' });
    w.environments.find((e) => e.id === DEV)!.audienceGroup = 'kestrel-admins';
    expect(await handleAskKey({ toolId: 1, environmentId: DEV, key: 'web_frontend' }, { accountId: PRIYA }, d)).toMatchObject({ ok: true, askId: null, card: { kind: 'refused' } });
    expect(saved).toEqual([]);
  });
});

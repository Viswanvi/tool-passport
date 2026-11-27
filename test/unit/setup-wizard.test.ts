import { describe, expect, it, vi } from 'vitest';
import { handleChooseModel, handleSetupStatus, type SetupStatusDeps } from '../../src/resolvers/setup-handlers';

/**
 * The setup wizard (spec F7: "service desk, request types, resolution mapping, Assets schema or registry mode,
 * model choice"). Setup shows each step as done or to do, read without side effects, and lets a Jira
 * administrator pick the model from the site's active list (spec section 13: never hard-coded).
 */

const MODELS = [
  { model: 'claude-haiku-5-5', status: 'active' },
  { model: 'claude-sonnet-5-5', status: 'active' },
  { model: 'claude-haiku-4-5', status: 'deprecated' },
  { model: 'other-model-1', status: 'active' },
];

function deps(over: Partial<SetupStatusDeps> = {}) {
  const saved: unknown[] = [];
  const d: SetupStatusDeps = {
    check: { isJiraAdmin: async () => true },
    requestSetup: async () => ({ serviceDeskId: '14', requestTypeIds: { fix: '320' } }),
    resolutionMap: async () => ({ Done: 'approved', Declined: 'declined' }),
    demoTool: async () => ({ id: 1, mode: 'assets' }),
    modelSetting: async () => null,
    listModels: async () => MODELS,
    lastTestRun: async () => '2026-11-23T11:39:46.000Z',
    saveModel: async (v) => {
      saved.push(v);
    },
    helpCenter: async () => ({ on: true, by: 'acct-admin', at: '2026-11-27T10:00:00.000Z' }),
    now: () => '2026-11-24T12:00:00.000Z',
    ...over,
  };
  return { d, saved };
}

describe('setup status', () => {
  it('reports each step: request type, approvals, demo data and mode, model and its choices, last test run', async () => {
    const { d, saved } = deps();
    expect(await handleSetupStatus({ accountId: 'acct-admin' }, d)).toEqual({
      ok: true,
      requests: { done: true },
      approvals: { done: true, approve: ['Done'], decline: ['Declined'] },
      demo: { done: true, mode: 'assets' },
      model: { current: 'claude-haiku-5-5', automatic: true, choices: ['claude-haiku-5-5', 'claude-sonnet-5-5'] },
      tests: { lastRun: '2026-11-23T11:39:46.000Z' },
      helpCenter: { on: true },
    });
    // Reading the status stores nothing.
    expect(saved).toEqual([]);
  });

  it('a new site shows every step still to do', async () => {
    const { d } = deps({ requestSetup: async () => null, resolutionMap: async () => null, demoTool: async () => null, lastTestRun: async () => null, helpCenter: async () => null });
    expect(await handleSetupStatus({ accountId: 'acct-admin' }, d)).toMatchObject({
      requests: { done: false },
      approvals: { done: false, approve: [], decline: [] },
      demo: { done: false, mode: null },
      tests: { lastRun: null },
      helpCenter: { on: false },
    });
  });

  it('a map that only declines is not done: nothing could ever approve', async () => {
    const { d } = deps({ resolutionMap: async () => ({ Declined: 'declined' }) });
    expect(await handleSetupStatus({ accountId: 'acct-admin' }, d)).toMatchObject({ approvals: { done: false } });
  });

  it('a choice made in setup is shown as chosen, not automatic', async () => {
    const { d } = deps({ modelSetting: async () => ({ model: 'claude-sonnet-5-5', chosenAt: 'x', by: 'setup' }) });
    expect(await handleSetupStatus({ accountId: 'acct-admin' }, d)).toMatchObject({ model: { current: 'claude-sonnet-5-5', automatic: false } });
  });

  it('a model the app stored by itself (first question, or a retirement switch) is still automatic', async () => {
    const { d } = deps({ modelSetting: async () => ({ model: 'claude-sonnet-5-5', chosenAt: 'x' }) });
    expect(await handleSetupStatus({ accountId: 'acct-admin' }, d)).toMatchObject({ model: { current: 'claude-sonnet-5-5', automatic: true } });
  });

  it('a model list that fails still shows the rest', async () => {
    const { d } = deps({ listModels: async () => Promise.reject(new Error('llm down')) });
    expect(await handleSetupStatus({ accountId: 'acct-admin' }, d)).toMatchObject({ ok: true, requests: { done: true }, model: { current: null, choices: [] } });
  });

  it('is for Jira administrators only', async () => {
    const requestSetup = vi.fn();
    const { d } = deps({ check: { isJiraAdmin: async () => false }, requestSetup });
    expect(await handleSetupStatus({ accountId: 'acct-priya' }, d)).toMatchObject({ ok: false });
    expect(requestSetup).not.toHaveBeenCalled();
  });
});

describe('choosing the model', () => {
  it('stores an active Claude model from the live list', async () => {
    const { d, saved } = deps();
    expect(await handleChooseModel({ model: 'claude-sonnet-5-5' }, { accountId: 'acct-admin' }, d)).toEqual({ ok: true, model: 'claude-sonnet-5-5' });
    expect(saved).toEqual([{ model: 'claude-sonnet-5-5', chosenAt: '2026-11-24T12:00:00.000Z', by: 'setup' }]);
  });

  it('refuses a deprecated, unknown or non-Claude model, a bad payload, and anyone who is not an administrator', async () => {
    const { d, saved } = deps();
    for (const model of ['claude-haiku-4-5', 'claude-made-up', 'other-model-1']) {
      expect(await handleChooseModel({ model }, { accountId: 'acct-admin' }, d)).toMatchObject({ ok: false });
    }
    expect(await handleChooseModel({}, { accountId: 'acct-admin' }, d)).toMatchObject({ ok: false });
    const notAdmin = deps({ check: { isJiraAdmin: async () => false } });
    expect(await handleChooseModel({ model: 'claude-sonnet-5-5' }, { accountId: 'acct-priya' }, notAdmin.d)).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
    expect(notAdmin.saved).toEqual([]);
  });
});

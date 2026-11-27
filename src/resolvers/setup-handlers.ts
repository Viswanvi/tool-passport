import { z } from 'zod';
import { chooseModel, chosenInSetup, claudeChoices, storedModel, type ModelSetting } from '../llm/model-choice';
import type { RequestSetup } from '../loop/requests';
import { approvalOutcome, type ResolutionMap } from '../loop/resolution';
import { mayAdminister, type WriteCheck } from '../registry/authorise';
import type { ResolverContext } from './handlers';
import { helpCenterChoice } from './help-handlers';

/**
 * The setup wizard's status and model step (spec F7: "service desk, request types, resolution mapping, Assets
 * schema or registry mode, model choice"; section 13: the model id comes from the live list, never hard-coded).
 * Jira administrators only, on the server. Reading the status stores nothing. No Forge imports.
 */

export interface SetupStatusDeps {
  check: WriteCheck;
  requestSetup(): Promise<RequestSetup | null>;
  resolutionMap(): Promise<ResolutionMap | null>;
  demoTool(): Promise<{ id: number; mode: 'assets' | 'registry' } | null>;
  modelSetting(): Promise<unknown>;
  /** The raw `list().models` reply. */
  listModels(): Promise<unknown>;
  lastTestRun(): Promise<string | null>;
  saveModel(v: ModelSetting): Promise<void>;
  /** The stored help-center choice (D57). */
  helpCenter(): Promise<unknown>;
  now?(): string;
}

type Refusal = { ok: false; reason: string };

export interface SetupStatus {
  ok: true;
  requests: { done: boolean };
  approvals: { done: boolean; approve: string[]; decline: string[] };
  demo: { done: boolean; mode: 'assets' | 'registry' | null };
  /** `automatic`: no administrator chose it here; the app picks (and stores) the first preferred active model itself. */
  model: { current: string | null; automatic: boolean; choices: string[] };
  tests: { lastRun: string | null };
  helpCenter: { on: boolean };
}

export async function handleSetupStatus(ctx: ResolverContext, deps: SetupStatusDeps): Promise<SetupStatus | Refusal> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok) return allowed;
  const [setup, map, demo, setting, lastRun, help] = await Promise.all([
    deps.requestSetup(),
    deps.resolutionMap(),
    deps.demoTool(),
    deps.modelSetting(),
    deps.lastTestRun(),
    deps.helpCenter(),
  ]);
  // A model list that can't be read hides only the model choices.
  const models = await deps.listModels().catch(() => null);
  const names = map ? Object.keys(map).sort() : [];
  const approve = names.filter((n) => approvalOutcome(n, map) === 'approved');
  const stored = storedModel(setting);
  return {
    ok: true,
    requests: { done: Boolean(setup?.requestTypeIds.fix) },
    approvals: { done: approve.length > 0, approve, decline: names.filter((n) => approvalOutcome(n, map) === 'declined') },
    demo: { done: demo !== null, mode: demo?.mode ?? null },
    model: { current: stored ?? (models ? chooseModel(models) : null), automatic: !chosenInSetup(setting), choices: models ? claudeChoices(models) : [] },
    tests: { lastRun },
    helpCenter: { on: helpCenterChoice(help) === true },
  };
}

const ChooseModel = z.object({ model: z.string().min(1).max(200) });

/** Only an active Claude model from the site's live list can be chosen. */
export async function handleChooseModel(payload: unknown, ctx: ResolverContext, deps: SetupStatusDeps): Promise<{ ok: true; model: string } | Refusal> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok) return allowed;
  const p = ChooseModel.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a model' };
  const choices = claudeChoices(await deps.listModels());
  if (!choices.includes(p.data.model)) return { ok: false, reason: `${p.data.model} is not an active model on this site` };
  await deps.saveModel({ model: p.data.model, chosenAt: (deps.now ?? (() => new Date().toISOString()))(), by: 'setup' });
  return { ok: true, model: p.data.model };
}

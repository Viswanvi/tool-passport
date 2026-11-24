import api, { route } from '@forge/api';
import Resolver from '@forge/resolver';
import { recentAsksFor, saveAsk } from '../db/asks';
import { sqlChangeRepo } from '../db/changes';
import { runMigrations } from '../db/migrations';
import { listEnvironments, listTools, loadCatalog, loadEnvironment, loadRegistry, loadTool, sqlEngineRepo } from '../db/repo';
import { sqlRequestRepo } from '../db/requests';
import { getSetting, setSetting } from '../db/store';
import { EVAL_QUESTIONS } from '../eval/questions';
import { sqlTranslationStore } from '../db/translations-sql';
import { labelChat, translationChat } from '../llm/client';
import { sqlLabelStore } from '../db/labels';
import { loopDeps, noteEnvironmentVersion, readRequestSetup, readResolutionMap, saveRequestSetup, saveResolutionMap } from '../loop/forge';
import { listDecisionNames, listDesks, usableRequestTypes } from '../loop/jsm-forge';
import { readGroups } from '../providers/forge';
import { ensureDemoRecords } from '../setup/assets-records';
import { forgeGroupsClient, forgeSetupClient } from '../setup/forge';
import { ensureDemoGroups } from '../setup/groups';
import { loadDemoData } from '../setup/load-demo';
import type { WriteCheck } from '../registry/authorise';
import { sqlRegistryWriter } from '../registry/write';
import { seedDemo } from '../seed/demo';
import { handleAsk, handleEnvironments, handleLoadDemo, handleTools, type AskHandlerDeps, type ResolverContext } from './handlers';
import { handleChanges, handleRecentAsks, handleReleaseNotes, handleStillTrue, type ChangeDeps } from './change-handlers';
import { handleCreateTool, handleEdit, handleToolDetails, type EditDeps } from './edit-handlers';
import { handleRunEval, type EvalDeps } from './eval-handlers';
import { handleMyTools, handleOpenQuestions, handlePublishAnswer, type OwnerDeps } from './owner-handlers';
import {
  handleAskOwner,
  handleRecheck,
  handleRequestApproval,
  handleRequestFix,
  handleRequestSetup,
  handleRequestTypes,
  handleResolutionSetup,
  handleSaveRequestSetup,
  handleSaveResolutionMap,
  type ResolutionSetupDeps,
  type SetupDeps,
} from './request-handlers';

/**
 * UI resolvers. Identity always comes from the Forge context (req.context.accountId), never the payload
 * (CLAUDE.md rule 3). The logic lives in handlers.ts; this file only wires Forge to it.
 */

const ctxOf = (context: { accountId?: string } | undefined): ResolverContext => ({ accountId: context?.accountId });

/** Shared with the Rovo action, which runs the same ask (src/rovo/forge.ts). */
export const askDeps: AskHandlerDeps = {
  loadTool,
  loadEnvironment,
  loadCatalog,
  readGroups,
  chat: translationChat,
  translations: sqlTranslationStore,
  repo: sqlEngineRepo,
  environments: loopDeps.environments,
  noteVersion: noteEnvironmentVersion,
  saveAsk,
  requests: sqlRequestRepo,
};

/** Jira administrator, read as the signed-in person: their own global permission, not the app's. */
const writeCheck: WriteCheck = {
  async isJiraAdmin() {
    const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return false;
    const body = (await res.json()) as { permissions?: { ADMINISTER?: { havePermission?: unknown } } };
    return body.permissions?.ADMINISTER?.havePermission === true;
  },
};

const resolver = new Resolver();

resolver.define('health', async () => ({ ok: true }));

resolver.define('ask', ({ payload, context }) => handleAsk(payload, ctxOf(context), askDeps));

resolver.define('tools', ({ context }) => handleTools(ctxOf(context), { listTools }));

resolver.define('environments', ({ payload, context }) =>
  handleEnvironments(payload, ctxOf(context), { listTools, loadTool, listEnvironments, loadCatalog, readGroups }),
);

resolver.define('loadDemo', ({ payload, context }) =>
  handleLoadDemo(payload, ctxOf(context), {
    check: writeCheck,
    // A minor-version upgrade fires no lifecycle event and the sweep may not have run yet (D27): bring the
    // tables up to date first. The runner applies only what this installation lacks.
    // Assets mode: the Assets records first (made if missing: as the app, else as this admin), then the app's own
    // records. Registry mode: no Assets at all.
    seed: async (actor, mode) => {
      await runMigrations();
      return loadDemoData(
        {
          ensureRecords: () => ensureDemoRecords(forgeSetupClient('app'), forgeSetupClient('user')),
          seed: (d) => seedDemo({ writer: sqlRegistryWriter, actor, ...d }),
          // The person loading plays the asker too, so they join kestrel-dev-builders (spec section 16).
          ensureGroups: () => ensureDemoGroups(forgeGroupsClient('app'), forgeGroupsClient('user'), actor),
        },
        mode,
      );
    },
  }),
);

// ---- the request loop (spec F4): the payload names the ask; the asker is the context's account ----

resolver.define('requestFix', ({ payload, context }) => handleRequestFix(payload, ctxOf(context), loopDeps));

resolver.define('requestApproval', ({ payload, context }) => handleRequestApproval(payload, ctxOf(context), loopDeps));

resolver.define('askOwner', ({ payload, context }) => handleAskOwner(payload, ctxOf(context), loopDeps));

// ---- tool owners (My tools): owner or Jira administrator, checked in each handler ----

const ownerDeps: OwnerDeps = {
  loop: loopDeps,
  writer: sqlRegistryWriter,
  check: writeCheck,
  listTools,
  listEnvironments,
  changes: sqlChangeRepo,
};

resolver.define('myTools', ({ context }) => handleMyTools(ctxOf(context), ownerDeps));

resolver.define('openQuestions', ({ payload, context }) => handleOpenQuestions(payload, ctxOf(context), ownerDeps));

resolver.define('publishAnswer', ({ payload, context }) => handlePublishAnswer(payload, ctxOf(context), ownerDeps));

// ---- owner editing (spec F1): owner or Jira administrator, checked in each handler; refusals audited ----

const editDeps: EditDeps = {
  writer: sqlRegistryWriter,
  check: writeCheck,
  loop: loopDeps,
  listEnvironments,
  listTools,
  loadRegistry,
  changes: sqlChangeRepo,
};

// ---- version changes (spec F6): the Changes screen and "Still true", owner or Jira administrator ----

const changeDeps: ChangeDeps = {
  loop: loopDeps,
  changes: sqlChangeRepo,
  writer: sqlRegistryWriter,
  check: writeCheck,
  listEnvironments,
  loadRegistry,
  labels: sqlLabelStore,
  labelChat,
};

resolver.define('changes', ({ payload, context }) => handleChanges(payload, ctxOf(context), changeDeps));

resolver.define('stillTrue', ({ payload, context }) => handleStillTrue(payload, ctxOf(context), changeDeps));

// Release-note labels (spec F9): one model call per paste, owner or Jira administrator only.
resolver.define('releaseNotes', ({ payload, context }) => handleReleaseNotes(payload, ctxOf(context), changeDeps));

resolver.define('recentAsks', ({ context }) => handleRecentAsks(ctxOf(context), { recentAsksFor, loadTool, loadEnvironment }));

resolver.define('toolDetails', ({ payload, context }) => handleToolDetails(payload, ctxOf(context), editDeps));

resolver.define('edit', ({ payload, context }) => handleEdit(payload, ctxOf(context), editDeps));

resolver.define('createTool', ({ payload, context }) => handleCreateTool(payload, ctxOf(context), editDeps));

resolver.define('recheck', ({ payload, context }) => handleRecheck(payload, ctxOf(context), loopDeps));

const setupDeps: SetupDeps = {
  check: writeCheck,
  desks: listDesks,
  usableRequestTypes,
  getSetup: readRequestSetup,
  saveSetup: saveRequestSetup,
};

resolver.define('requestSetup', ({ context }) => handleRequestSetup(ctxOf(context), setupDeps));

resolver.define('requestTypes', ({ payload, context }) => handleRequestTypes(payload, ctxOf(context), setupDeps));

resolver.define('saveRequestSetup', ({ payload, context }) => handleSaveRequestSetup(payload, ctxOf(context), setupDeps));

const resolutionDeps: ResolutionSetupDeps = {
  check: writeCheck,
  // On a site with no resolutions, the done statuses of the desk chosen under Requests (D41).
  decisionNames: async () => listDecisionNames((await readRequestSetup())?.serviceDeskId ?? null),
  getMap: readResolutionMap,
  saveMap: saveResolutionMap,
};

resolver.define('resolutionSetup', ({ context }) => handleResolutionSetup(ctxOf(context), resolutionDeps));

resolver.define('saveResolutionMap', ({ payload, context }) => handleSaveResolutionMap(payload, ctxOf(context), resolutionDeps));

// ---- Setup → Run tests: the 40-question set against the real model (Jira administrators only) ----

const EVAL_START = 'eval.lastStart';

const evalDeps: EvalDeps = {
  check: writeCheck,
  questions: EVAL_QUESTIONS,
  chat: translationChat,
  lastStart: async () => {
    const s = await getSetting<{ at?: unknown }>(EVAL_START);
    return typeof s?.at === 'string' ? s.at : null;
  },
  // Kept inside an object (store.ts: a stored bare string comes back already parsed).
  markStart: (at) => setSetting(EVAL_START, { at }),
};

resolver.define('runEval', ({ payload, context }) => handleRunEval(payload, ctxOf(context), evalDeps));

export const uiResolver = resolver.getDefinitions();

import api, { route } from '@forge/api';
import Resolver from '@forge/resolver';
import { saveAsk } from '../db/asks';
import { runMigrations } from '../db/migrations';
import { listEnvironments, listTools, loadCatalog, loadEnvironment, loadTool, sqlEngineRepo } from '../db/repo';
import { sqlRequestRepo } from '../db/requests';
import { sqlTranslationStore } from '../db/translations-sql';
import { translationChat } from '../llm/client';
import { loopDeps, noteEnvironmentVersion, readRequestSetup, saveRequestSetup } from '../loop/forge';
import { listDesks, usableRequestTypes } from '../loop/jsm-forge';
import { findPassportObjectKey, readGroups } from '../providers/forge';
import type { WriteCheck } from '../registry/authorise';
import { sqlRegistryWriter } from '../registry/write';
import { seedDemo } from '../seed/demo';
import { handleAsk, handleEnvironments, handleLoadDemo, handleTools, type AskHandlerDeps, type ResolverContext } from './handlers';
import { handleRecheck, handleRequestFix, handleRequestSetup, handleRequestTypes, handleSaveRequestSetup, type SetupDeps } from './request-handlers';

/**
 * UI resolvers. Identity always comes from the Forge context (req.context.accountId), never the payload
 * (CLAUDE.md rule 3). The logic lives in handlers.ts; this file only wires Forge to it.
 */

const ctxOf = (context: { accountId?: string } | undefined): ResolverContext => ({ accountId: context?.accountId });

const askDeps: AskHandlerDeps = {
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

resolver.define('loadDemo', ({ context }) =>
  handleLoadDemo(ctxOf(context), {
    check: writeCheck,
    // A minor-version upgrade fires no lifecycle event and the sweep may not have run yet (D27): bring the
    // tables up to date first. The runner applies only what this installation lacks.
    seed: async (actor) => {
      await runMigrations();
      return seedDemo({ writer: sqlRegistryWriter, findObjectKey: findPassportObjectKey, actor });
    },
  }),
);

// ---- the request loop (spec F4): the payload names the ask; the asker is the context's account ----

resolver.define('requestFix', ({ payload, context }) => handleRequestFix(payload, ctxOf(context), loopDeps));

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

export const uiResolver = resolver.getDefinitions();

import { z } from 'zod';
import { noteVersion } from '../change/detect';
import { sqlDetectRepo } from '../change/detect-sql';
import { loadAsk, saveAskResult } from '../db/asks';
import { loadCatalog, loadEnvironment, loadTool, sqlEngineRepo } from '../db/repo';
import { sqlRequestRepo } from '../db/requests';
import { getSetting, setSetting } from '../db/store';
import type { Environment, Tool } from '../engine/model';
import { forgeEnvironmentReader, readGroups } from '../providers/forge';
import { handleIssueEvent } from './events';
import { forgeJsm } from './jsm-forge';
import type { LoopDeps, RequestSetup } from './requests';

/** Forge wiring for the request loop: the resolvers, the issue trigger and the sweep share these. */

const SETUP_SETTING = 'requests.setup';
const Id = z.string().regex(/^\d{1,12}$/);
const SetupShape = z.object({
  serviceDeskId: Id,
  requestTypeIds: z.object({ fix: Id.optional(), approval: Id.optional(), question: Id.optional() }),
});

/** A stored setup that doesn't read cleanly counts as not set up: no request goes to a guessed desk. */
export async function readRequestSetup(): Promise<RequestSetup | null> {
  const parsed = SetupShape.safeParse(await getSetting<unknown>(SETUP_SETTING));
  return parsed.success ? parsed.data : null;
}

export async function saveRequestSetup(s: RequestSetup): Promise<void> {
  await setSetting(SETUP_SETTING, SetupShape.parse(s));
}

/** Version bookkeeping for every evaluation (spec section 11); answers never depend on it. */
export function noteEnvironmentVersion(tool: Tool, e: Environment, observed: string | null): Promise<unknown> {
  return noteVersion(
    { id: e.id, toolId: tool.id, provider: e.provider, granularity: tool.versionGranularity, lastSeenVersion: e.lastSeenVersion, lastSeenAt: e.lastSeenAt },
    observed,
    sqlDetectRepo,
  );
}

export const loopDeps: LoopDeps = {
  loadTool,
  loadEnvironment,
  loadCatalog,
  // As the app with the stored asker's id (D25, E6): works in triggers and the sweep with no user present.
  readGroups,
  repo: sqlEngineRepo,
  environments: forgeEnvironmentReader(),
  noteVersion: noteEnvironmentVersion,
  loadAsk,
  saveResult: saveAskResult,
  requests: sqlRequestRepo,
  jsm: forgeJsm,
  setup: readRequestSetup,
  log: (line) => console.log(line),
};

/** avi:jira:updated:issue. Every issue update on the site arrives here; most return at once. */
export async function onIssueEvent(event: unknown): Promise<void> {
  try {
    const out = await handleIssueEvent(event, loopDeps);
    if (out !== 'ignored' && out !== 'not_ours') {
      const key = (event as { issue?: { key?: unknown } } | null)?.issue?.key;
      console.log(`[issue-event] ${typeof key === 'string' ? key : '?'} ${out}`);
    }
  } catch (e) {
    // The sweep re-checks open requests, so a failure here is retried within five minutes.
    console.error(`[issue-event] failed: ${String(e).slice(0, 300)}`);
  }
}

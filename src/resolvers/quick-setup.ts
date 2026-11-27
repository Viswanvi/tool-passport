import { z } from 'zod';
import type { RequestSetup } from '../loop/requests';
import { approvalOutcome, type ResolutionMap } from '../loop/resolution';
import { mayAdminister, type WriteCheck } from '../registry/authorise';
import type { SeedResult } from '../seed/demo';
import type { ResolverContext } from './handlers';
import type { Option } from './request-handlers';

/**
 * One-click setup: the Setup page's first panel. It proposes, in words, what it would set for steps 1 to 3
 * (the service desk and request type, which resolutions decide an approval, the demo data) and sets it only
 * when a Jira administrator clicks. On the click the plan is worked out again here; the page sends only the
 * demo mode. It keeps whatever is already set, never chooses between two desks, and only a resolution named
 * Done can approve (D49): anything else is left to the administrator in step 2, so approvals stay off. With no
 * single desk yet it still loads the demo, so asking works at once, and says how to finish requests (D56).
 * No Forge imports.
 */

export interface QuickSetupDeps {
  check: WriteCheck;
  desks(): Promise<Option[]>;
  /** Request types of this desk that need nothing but a summary and a description; null if the desk is unknown. */
  usableRequestTypes(serviceDeskId: string): Promise<Option[] | null>;
  getSetup(): Promise<RequestSetup | null>;
  saveSetup(s: RequestSetup): Promise<void>;
  /** The resolutions Jira has, or the desk's done statuses on a site with none (D41). */
  decisionNames(serviceDeskId: string): Promise<{ by: 'resolution' | 'status'; names: Option[] }>;
  getMap(): Promise<ResolutionMap | null>;
  saveMap(map: Record<string, 'approved' | 'declined'>): Promise<void>;
  demoTool(): Promise<{ id: number; mode: 'assets' | 'registry' } | null>;
  seed(actor: string, mode: 'assets' | 'registry'): Promise<SeedResult>;
}

export interface QuickPlan {
  ok: true;
  /** True when one click would set something and nothing blocks it. */
  ready: boolean;
  requests: { state: 'done' | 'will_set' | 'blocked'; desk: string | null; requestType: string | null; reason?: string };
  approvals: { state: 'done' | 'will_set' | 'manual'; approve: string[]; decline: string[]; reason?: string };
  demo: { state: 'done' | 'will_load' };
}

type Refusal = { ok: false; reason: string };

export type QuickSetupReply =
  | {
      ok: true;
      did: Array<'requests' | 'approvals' | 'demo'>;
      seed?: SeedResult;
      /** Requests could not be set yet (no single desk): what to do, then click again. The demo loaded anyway. */
      later?: string;
    }
  | { ok: false; reason: string; did?: Array<'requests' | 'approvals' | 'demo'> };

/** The plan, plus what the click would write. */
interface Worked {
  plan: QuickPlan;
  setup: RequestSetup | null;
  map: Record<string, 'approved' | 'declined'> | null;
}

// The request type a new IT service desk offers for "anything else" (the judge guide's choice).
const PREFERRED_TYPE = /^get it help$/i;
const APPROVES = /^done$/i;
const DECLINES = /^declined$/i;

const blocked = (reason: string): QuickPlan['requests'] => ({ state: 'blocked', desk: null, requestType: null, reason });

async function workOut(deps: QuickSetupDeps): Promise<Worked> {
  const [current, desks, map, demo] = await Promise.all([deps.getSetup(), deps.desks(), deps.getMap(), deps.demoTool()]);

  // Step 1: requests. Keep a saved choice that still works; otherwise only a site's single desk is chosen.
  let requests: QuickPlan['requests'];
  let setup: RequestSetup | null = null;
  let deskId: string | null = null;
  const savedDesk = current?.requestTypeIds.fix ? desks.find((d) => d.id === current.serviceDeskId) : undefined;
  const savedType = savedDesk ? (await deps.usableRequestTypes(savedDesk.id))?.find((t) => t.id === current!.requestTypeIds.fix) : undefined;
  if (savedDesk && savedType) {
    requests = { state: 'done', desk: savedDesk.name, requestType: savedType.name };
    deskId = savedDesk.id;
  } else if (desks.length === 0) {
    requests = blocked(
      'No service desk yet. You can load the demo and ask now; to raise requests, create one (Spaces → + → Service management → Basic IT service management) and click Set it all up again.',
    );
  } else if (desks.length > 1) {
    requests = blocked('This site has more than one service desk: choose yours under 1. Requests.');
  } else {
    const desk = desks[0]!;
    const types = (await deps.usableRequestTypes(desk.id)) ?? [];
    const type = types.find((t) => PREFERRED_TYPE.test(t.name.trim())) ?? types[0];
    if (!type) {
      requests = blocked(`${desk.name} has no request type that needs only a summary and a description: add one, or choose under 1. Requests.`);
    } else {
      // Request types belong to a desk: a different desk starts a fresh map.
      const keep = current && current.serviceDeskId === desk.id ? current.requestTypeIds : {};
      setup = { serviceDeskId: desk.id, requestTypeIds: { ...keep, fix: type.id } };
      requests = { state: 'will_set', desk: desk.name, requestType: type.name };
      deskId = desk.id;
    }
  }

  // Step 2: approvals. A saved map that approves on something is kept as it is.
  const names = map ? Object.keys(map).sort() : [];
  const savedApprove = names.filter((n) => approvalOutcome(n, map) === 'approved');
  let approvals: QuickPlan['approvals'];
  let newMap: Worked['map'] = null;
  if (savedApprove.length) {
    approvals = { state: 'done', approve: savedApprove, decline: names.filter((n) => approvalOutcome(n, map) === 'declined') };
  } else if (!deskId) {
    approvals = { state: 'manual', approve: [], decline: [], reason: 'Set up requests first.' };
  } else {
    const { by, names: outcomes } = await deps.decisionNames(deskId);
    // Only resolutions: a done status (D41) can be reached without anyone deciding anything.
    const approve = by === 'resolution' ? outcomes.find((o) => APPROVES.test(o.name.trim())) : undefined;
    const decline = by === 'resolution' ? outcomes.find((o) => DECLINES.test(o.name.trim())) : undefined;
    if (approve) {
      newMap = { [approve.name]: 'approved', ...(decline ? { [decline.name]: 'declined' as const } : {}) };
      approvals = { state: 'will_set', approve: [approve.name], decline: decline ? [decline.name] : [] };
    } else {
      approvals = {
        state: 'manual',
        approve: [],
        decline: [],
        reason: 'No resolution named Done: add Done and Declined under Jira settings → Work items → Resolutions, or choose under 2. Approvals.',
      };
    }
  }

  const plan: QuickPlan = {
    ok: true,
    // Requests that can't be set yet don't hold the demo back: a judge can ask before making a service desk (D56).
    ready: requests.state === 'will_set' || approvals.state === 'will_set' || demo === null,
    requests,
    approvals,
    demo: { state: demo ? 'done' : 'will_load' },
  };
  return { plan, setup, map: newMap };
}

export async function handleQuickSetupPlan(ctx: ResolverContext, deps: QuickSetupDeps): Promise<QuickPlan | Refusal> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok) return allowed;
  try {
    return (await workOut(deps)).plan;
  } catch (e) {
    console.error(`[quickSetupPlan] failed: ${String(e).slice(0, 300)}`);
    return { ok: false, reason: "Couldn't read this site's service desks just now. Reload to try again." };
  }
}

const Apply = z.object({ mode: z.enum(['assets', 'registry']).default('assets') });

export async function handleQuickSetup(payload: unknown, ctx: ResolverContext, deps: QuickSetupDeps): Promise<QuickSetupReply> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok || !ctx.accountId) return { ok: false, reason: allowed.ok ? 'Not signed in' : allowed.reason };
  const p = Apply.safeParse(payload ?? {});
  if (!p.success) return { ok: false, reason: 'Choose Assets or registry mode' };
  const did: Array<'requests' | 'approvals' | 'demo'> = [];
  try {
    const { plan, setup, map } = await workOut(deps);
    const later = plan.requests.state === 'blocked' ? (plan.requests.reason ?? 'Set up requests under 1. Requests.') : undefined;
    // Nothing this click could set: say what is missing rather than "done".
    if (later && plan.demo.state === 'done') return { ok: false, reason: later };
    if (setup) {
      await deps.saveSetup(setup);
      did.push('requests');
    }
    if (map) {
      await deps.saveMap(map);
      did.push('approvals');
    }
    if (plan.demo.state === 'done') return { ok: true, did };
    const seed = await deps.seed(ctx.accountId, p.data.mode);
    if (!seed.ok) return { ok: false, reason: seed.reason, did };
    did.push('demo');
    return { ok: true, did, seed, ...(later ? { later } : {}) };
  } catch (e) {
    // Every write here is safe to repeat, and a second click skips what is already set.
    console.error(`[quickSetup] failed after ${did.join(',') || 'nothing'}: ${String(e).slice(0, 300)}`);
    return { ok: false, did, reason: `Setup stopped part way: ${String(e).slice(0, 200)}. Click again; it is safe to repeat.` };
  }
}

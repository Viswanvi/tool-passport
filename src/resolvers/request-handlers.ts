import { z } from 'zod';
import { raiseApproval, raiseFailure, raiseFix, raiseQuestion, recheckForAsker, type LoopDeps, type RaiseReply, type RecheckReply, type RequestSetup } from '../loop/requests';
import type { ResolutionMap } from '../loop/resolution';
import { mayAdminister, type WriteCheck } from '../registry/authorise';
import type { ResolverContext } from './handlers';

/**
 * Resolvers for the request loop and its setup. The asker is the Forge context's account (CLAUDE.md rule 3):
 * the payload names only the ask, and the loop checks that the ask is the caller's own. Request setup is for
 * Jira administrators, checked here on the server (rule 4).
 */

const AskRef = z.object({ askId: z.number().int().positive() });

async function raiseFor(kind: 'fix' | 'approval' | 'question', payload: unknown, ctx: ResolverContext, deps: LoopDeps): Promise<RaiseReply> {
  if (!ctx.accountId) return raiseFailure('not_signed_in');
  const p = AskRef.safeParse(payload);
  if (!p.success) return raiseFailure('bad_request');
  try {
    const raise = kind === 'fix' ? raiseFix : kind === 'approval' ? raiseApproval : raiseQuestion;
    const reply = await raise(p.data.askId, ctx.accountId, deps);
    console.log(`[request] ${kind} ${reply.ok ? `raised=${reply.raised.length}` : `error=${reply.error}`}`);
    return reply;
  } catch (e) {
    console.error(`[request] ${kind} failed: ${String(e).slice(0, 300)}`);
    return raiseFailure('try_again');
  }
}

export const handleRequestFix = (payload: unknown, ctx: ResolverContext, deps: LoopDeps) => raiseFor('fix', payload, ctx, deps);

export const handleRequestApproval = (payload: unknown, ctx: ResolverContext, deps: LoopDeps) => raiseFor('approval', payload, ctx, deps);

export const handleAskOwner = (payload: unknown, ctx: ResolverContext, deps: LoopDeps) => raiseFor('question', payload, ctx, deps);

export async function handleRecheck(payload: unknown, ctx: ResolverContext, deps: LoopDeps): Promise<RecheckReply> {
  if (!ctx.accountId) return { ok: false, error: 'not_signed_in' };
  const p = AskRef.safeParse(payload);
  if (!p.success) return { ok: false, error: 'bad_request' };
  try {
    return await recheckForAsker(p.data.askId, ctx.accountId, deps);
  } catch (e) {
    console.error(`[recheck] failed: ${String(e).slice(0, 300)}`);
    return { ok: false, error: 'try_again' };
  }
}

// ---- setup: which service desk and request type (the rest of the wizard is Phase 4) -------------------

export interface Option {
  id: string;
  name: string;
}

export interface SetupDeps {
  check: WriteCheck;
  desks(): Promise<Option[]>;
  /** Request types of this desk that need nothing but a summary and a description; null if the desk is unknown. */
  usableRequestTypes(serviceDeskId: string): Promise<Option[] | null>;
  getSetup(): Promise<RequestSetup | null>;
  saveSetup(s: RequestSetup): Promise<void>;
}

type Refusal = { ok: false; reason: string };

const Id = z.string().regex(/^\d{1,12}$/);
const DeskRef = z.object({ serviceDeskId: Id });
const SaveSetup = DeskRef.extend({ requestTypeId: Id });

async function admin(ctx: ResolverContext, check: WriteCheck): Promise<Refusal | null> {
  const a = await mayAdminister(ctx.accountId, check);
  return a.ok ? null : { ok: false, reason: a.reason };
}

export async function handleRequestSetup(ctx: ResolverContext, deps: SetupDeps): Promise<{ ok: true; current: RequestSetup | null; desks: Option[] } | Refusal> {
  const refused = await admin(ctx, deps.check);
  if (refused) return refused;
  const [current, desks] = await Promise.all([deps.getSetup(), deps.desks()]);
  return { ok: true, current, desks };
}

export async function handleRequestTypes(payload: unknown, ctx: ResolverContext, deps: SetupDeps): Promise<{ ok: true; types: Option[] } | Refusal> {
  const refused = await admin(ctx, deps.check);
  if (refused) return refused;
  const p = DeskRef.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a service desk' };
  const types = await deps.usableRequestTypes(p.data.serviceDeskId);
  return types ? { ok: true, types } : { ok: false, reason: 'That service desk was not found' };
}

export async function handleSaveRequestSetup(payload: unknown, ctx: ResolverContext, deps: SetupDeps): Promise<{ ok: true; setup: RequestSetup } | Refusal> {
  const refused = await admin(ctx, deps.check);
  if (refused) return refused;
  const p = SaveSetup.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a service desk and a request type' };
  // Checked again here: the page's list is not the control.
  const types = await deps.usableRequestTypes(p.data.serviceDeskId);
  if (!types) return { ok: false, reason: 'That service desk was not found' };
  if (!types.some((t) => t.id === p.data.requestTypeId)) return { ok: false, reason: 'Pick a request type that needs only a summary and a description' };
  const current = await deps.getSetup();
  // Request types belong to a desk: a different desk starts a fresh map.
  const keep = current && current.serviceDeskId === p.data.serviceDeskId ? current.requestTypeIds : {};
  const setup: RequestSetup = { serviceDeskId: p.data.serviceDeskId, requestTypeIds: { ...keep, fix: p.data.requestTypeId } };
  await deps.saveSetup(setup);
  return { ok: true, setup };
}

// ---- setup: which resolutions decide an approval (spec F4, section 14) --------------------------------

export interface ResolutionSetupDeps {
  check: WriteCheck;
  /** The resolutions Jira has. */
  resolutions(): Promise<Option[]>;
  getMap(): Promise<ResolutionMap | null>;
  saveMap(map: Record<string, 'approved' | 'declined'>): Promise<void>;
}

const SaveMap = z.object({ map: z.record(z.string().min(1).max(255), z.enum(['approved', 'declined'])) });

export async function handleResolutionSetup(
  ctx: ResolverContext,
  deps: ResolutionSetupDeps,
): Promise<{ ok: true; resolutions: Option[]; map: ResolutionMap | null } | Refusal> {
  const refused = await admin(ctx, deps.check);
  if (refused) return refused;
  const [resolutions, map] = await Promise.all([deps.resolutions(), deps.getMap()]);
  return { ok: true, resolutions, map };
}

/** Names not mapped are left out of the map, and so never decide anything. */
export async function handleSaveResolutionMap(payload: unknown, ctx: ResolverContext, deps: ResolutionSetupDeps): Promise<{ ok: true } | Refusal> {
  const refused = await admin(ctx, deps.check);
  if (refused) return refused;
  const p = SaveMap.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Map each resolution to Approved, Declined or nothing' };
  const known = new Set((await deps.resolutions()).map((r) => r.name));
  const unknown = Object.keys(p.data.map).filter((n) => !known.has(n));
  if (unknown.length) return { ok: false, reason: `Jira has no resolution named ${unknown.map((n) => `"${n}"`).join(', ')}` };
  await deps.saveMap(p.data.map);
  return { ok: true };
}

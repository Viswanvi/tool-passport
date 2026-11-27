import { z } from 'zod';
import { mayAdminister, type WriteCheck } from '../registry/authorise';
import type { ResolverContext } from './handlers';

/**
 * "Can I…?" in the service desk's help center (D57): people check before they raise a request, where they already
 * go for help. It stays off until a Jira administrator turns it on (Setup → 4. Help center, or Set it all up),
 * because a help center can face people outside the company. While it is on, signed-in people see it across the
 * help center (its home page and portal pages; the newer help center reports every one of them as `help_center`, so
 * one desk's portal can't be told from another's, seen live); anonymous visitors never do. What it can do goes
 * through the same handlers as the Ask page, as the person asking (their own groups, their own asks and requests),
 * so it shows nothing Ask wouldn't show them. No Forge imports.
 */

export const HELP_CENTER_SETTING = 'helpCenter';

export interface HelpCenterSetting {
  on: boolean;
  by: string;
  at: string;
}

export interface HelpDeps {
  setting(): Promise<unknown>;
}

// Forge's account id for a visitor who isn't signed in (unlicensed-access docs): never an asker.
const ANONYMOUS = 'unidentified';

/** The stored choice: on, off, or never chosen (null). Anything unreadable counts as never chosen, so it stays off. */
export function helpCenterChoice(v: unknown): boolean | null {
  if (!v || typeof v !== 'object') return null;
  const on = (v as { on?: unknown }).on;
  return typeof on === 'boolean' ? on : null;
}

export type HelpRefusal = 'not_signed_in' | 'off';

/** The box's first call: draw nothing, or the tools to ask about. */
export type HelpStartReply = { show: false } | { show: true; tools: Array<{ id: number; name: string }> };

/** May this person use the box? Checked on the server for every call the box makes. */
export async function helpCenterOpen(ctx: ResolverContext, deps: HelpDeps): Promise<{ ok: true } | { ok: false; reason: HelpRefusal }> {
  if (!ctx.accountId || ctx.accountId === ANONYMOUS) return { ok: false, reason: 'not_signed_in' };
  if (helpCenterChoice(await deps.setting()) !== true) return { ok: false, reason: 'off' };
  return { ok: true };
}

/** Runs `run` only while the box may be used; otherwise the caller's own "nothing here" reply. */
export async function inHelpCenter<T>(ctx: ResolverContext, deps: HelpDeps, refused: T, run: () => Promise<T>): Promise<T> {
  const open = await helpCenterOpen(ctx, deps);
  if (!open.ok) {
    console.log(`[help] refused=${open.reason}`);
    return refused;
  }
  return run();
}

// ---- Setup → 4. Help center: Jira administrators only ----

export interface HelpSetupDeps {
  check: WriteCheck;
  setting(): Promise<unknown>;
  save(v: HelpCenterSetting): Promise<void>;
  now?(): string;
}

type Refusal = { ok: false; reason: string };

export async function handleHelpCenterSetup(ctx: ResolverContext, deps: HelpSetupDeps): Promise<{ ok: true; on: boolean; chosen: boolean } | Refusal> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok) return allowed;
  const choice = helpCenterChoice(await deps.setting());
  return { ok: true, on: choice === true, chosen: choice !== null };
}

const SaveHelp = z.object({ on: z.boolean() });

export async function handleSaveHelpCenter(payload: unknown, ctx: ResolverContext, deps: HelpSetupDeps): Promise<{ ok: true; on: boolean } | Refusal> {
  const allowed = await mayAdminister(ctx.accountId, deps.check);
  if (!allowed.ok || !ctx.accountId) return { ok: false, reason: allowed.ok ? 'Not signed in' : allowed.reason };
  const p = SaveHelp.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Choose on or off' };
  await deps.save({ on: p.data.on, by: ctx.accountId, at: (deps.now ?? (() => new Date().toISOString()))() });
  return { ok: true, on: p.data.on };
}

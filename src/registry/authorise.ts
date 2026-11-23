/**
 * Who may write (spec section 14; CLAUDE.md rule 4): the tool's owner or a Jira administrator, checked on
 * the server for every write. Hiding a button is not the control. The account id always comes from the
 * Forge context, never from the payload.
 */

export interface WriteCheck {
  /** Whether the signed-in person is a Jira administrator (read in their own context). */
  isJiraAdmin(): Promise<boolean>;
}

export type Authorisation = { ok: true } | { ok: false; reason: string };

function needsConsent(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false;
  const o = e as { name?: unknown; status?: unknown; message?: unknown };
  return [o.name, o.status, o.message].some((v) => typeof v === 'string' && v.includes('NEEDS_AUTHENTICATION_ERR'));
}

export async function mayWriteTool(accountId: string | undefined, tool: { ownerAccountId: string } | null, check: WriteCheck): Promise<Authorisation> {
  if (!accountId) return { ok: false, reason: 'Not signed in' };
  if (tool && tool.ownerAccountId === accountId) return { ok: true };
  try {
    if (await check.isJiraAdmin()) return { ok: true };
  } catch (e) {
    // Forge shows its consent screen only if this error reaches the page (E6 lesson); anything else: refuse.
    if (needsConsent(e)) throw e;
  }
  return { ok: false, reason: 'Only the tool owner or a Jira administrator can change this' };
}

/** Creating a tool, or loading demo data, needs a Jira administrator. */
export async function mayAdminister(accountId: string | undefined, check: WriteCheck): Promise<Authorisation> {
  return mayWriteTool(accountId, null, check);
}

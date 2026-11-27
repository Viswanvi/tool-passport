import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  handleHelpCenterSetup,
  handleSaveHelpCenter,
  helpCenterOpen,
  inHelpCenter,
  type HelpCenterSetting,
  type HelpDeps,
  type HelpSetupDeps,
} from '../../src/resolvers/help-handlers';

/**
 * "Can I…?" in the help center (D57). Off until a Jira administrator turns it on; then shown across the help center
 * to signed-in people, never to anonymous visitors. Every call the box makes is checked again on the server, and the
 * box's resolver offers asking and the card's own actions only, because the portal module lets service desk
 * customers in.
 */

const ON: HelpCenterSetting = { on: true, by: 'admin-1', at: '2026-11-27T10:00:00.000Z' };

const deps = (setting: unknown = ON): HelpDeps => ({ setting: async () => setting });

describe('who may use the box', () => {
  it('a signed-in person, once an administrator has turned it on', async () => {
    expect(await helpCenterOpen({ accountId: 'acct-1' }, deps())).toEqual({ ok: true });
  });

  it('off until an administrator turns it on: never chosen, turned off, or unreadable', async () => {
    for (const setting of [null, { ...ON, on: false }, { on: 'yes' }, 'true', 1]) {
      expect(await helpCenterOpen({ accountId: 'acct-1' }, deps(setting))).toEqual({ ok: false, reason: 'off' });
    }
  });

  it('never someone not signed in, including the id Forge gives anonymous visitors', async () => {
    expect(await helpCenterOpen({}, deps())).toEqual({ ok: false, reason: 'not_signed_in' });
    expect(await helpCenterOpen({ accountId: 'unidentified' }, deps())).toEqual({ ok: false, reason: 'not_signed_in' });
  });

  it('a refused call runs nothing and gives the caller its own empty reply', async () => {
    const run = vi.fn(async () => ({ show: true }));
    expect(await inHelpCenter({ accountId: 'acct-1' }, deps(null), { show: false }, run)).toEqual({ show: false });
    expect(await inHelpCenter({ accountId: 'unidentified' }, deps(), { show: false }, run)).toEqual({ show: false });
    expect(run).not.toHaveBeenCalled();
    expect(await inHelpCenter({ accountId: 'acct-1' }, deps(), { show: false }, run)).toEqual({ show: true });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('Setup → 4. Help center', () => {
  function setupDeps(admin = true, stored: unknown = null) {
    const saved: HelpCenterSetting[] = [];
    const d: HelpSetupDeps = {
      check: { isJiraAdmin: async () => admin },
      setting: async () => stored,
      save: async (v) => {
        saved.push(v);
      },
      now: () => '2026-11-27T11:00:00.000Z',
    };
    return { d, saved };
  }

  it('shows whether it is on and whether anyone has chosen', async () => {
    expect(await handleHelpCenterSetup({ accountId: 'admin-1' }, setupDeps(true, null).d)).toEqual({ ok: true, on: false, chosen: false });
    expect(await handleHelpCenterSetup({ accountId: 'admin-1' }, setupDeps(true, ON).d)).toEqual({ ok: true, on: true, chosen: true });
    expect(await handleHelpCenterSetup({ accountId: 'admin-1' }, setupDeps(true, { ...ON, on: false }).d)).toEqual({ ok: true, on: false, chosen: true });
  });

  it('saves on or off as the administrator clicking, never an account from the payload', async () => {
    const { d, saved } = setupDeps();
    expect(await handleSaveHelpCenter({ on: true, by: 'someone-else', accountId: 'x' }, { accountId: 'admin-1' }, d)).toEqual({ ok: true, on: true });
    expect(saved).toEqual([{ on: true, by: 'admin-1', at: '2026-11-27T11:00:00.000Z' }]);
    expect(await handleSaveHelpCenter({ on: 'yes' }, { accountId: 'admin-1' }, d)).toMatchObject({ ok: false });
    expect(saved).toHaveLength(1);
  });

  it('is for Jira administrators only', async () => {
    const { d, saved } = setupDeps(false);
    expect(await handleHelpCenterSetup({ accountId: 'someone' }, d)).toMatchObject({ ok: false });
    expect(await handleSaveHelpCenter({ on: true }, { accountId: 'someone' }, d)).toMatchObject({ ok: false });
    expect(await handleSaveHelpCenter({ on: true }, {}, d)).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
  });
});

describe("the box's own resolver", () => {
  it('offers asking and the card actions only, each behind the help-center check', () => {
    const src = readFileSync('src/resolvers/index.ts', 'utf8');
    const helpPart = src.slice(src.indexOf('const help = new Resolver();'), src.indexOf('export const helpResolver'));
    const defined = [...helpPart.matchAll(/help\.define\('(\w+)'/g)].map((m) => m[1]).sort();
    expect(defined).toEqual(['ask', 'askOwner', 'environments', 'helpStart', 'recheck', 'requestApproval', 'requestFix']);
    // Every definition goes through inHelp(…), the server-side check.
    const calls = helpPart.split(/help\.define\(/).slice(1);
    for (const c of calls) expect(c).toMatch(/=>\s*\n?\s*inHelp/);
  });

  it('the portal module uses that resolver, lets service desk customers in, and never anonymous visitors', () => {
    const manifest = readFileSync('manifest.yml', 'utf8');
    const block = manifest.slice(manifest.indexOf('jiraServiceManagement:portalSubheader:'), manifest.indexOf('trigger:'));
    expect(block).toMatch(/function: help-resolver/);
    expect(block).toMatch(/unlicensedAccess:[^\n]*\n\s*- customer\s*\n/);
    expect(block).not.toMatch(/^\s*- (anonymous|unlicensed)\s*$/m);
    expect(manifest).toMatch(/key: help-resolver\s*\n\s*handler: index\.helpResolver/);
  });
});

import { z } from 'zod';
import { answerRequirement } from '../engine/answer';
import { canPick } from '../engine/audience';
import { buildCard, type LozengeAppearance } from '../engine/card';
import type { EnvRead, Environment, EnvironmentReader, Verdict } from '../engine/model';
import { finishAsk, orderedCapabilities, type AskHandlerDeps, type AskReply, type ResolverContext } from './handlers';

/**
 * The Passport overview: what this person can do with a tool, everywhere, on one screen. One row per plain
 * capability (one that needs no value), one column per environment the person may pick, and in each cell the
 * verdict the Ask page would give for exactly that capability: the same expand and evaluate, from the catalog
 * key itself, so no model is called. Identity and groups come from the Forge context. Each environment's record
 * is read once per screen. Clicking a cell asks that key (handleAskKey), saved like any ask. No Forge imports.
 */

export type PassportDeps = Pick<AskHandlerDeps, 'loadTool' | 'loadEnvironment' | 'loadCatalog' | 'readGroups' | 'repo' | 'environments' | 'saveAsk' | 'requests'> & {
  listEnvironments(toolId: number): Promise<Environment[]>;
};

export interface PassportCell {
  environmentId: number;
  verdict: Verdict | null;
  title: string;
  lozenge: LozengeAppearance;
  reason: string;
}

export interface PassportRow {
  key: string;
  label: string;
  cells: PassportCell[];
}

export type PassportReply =
  | { ok: true; tool: string; environments: Array<{ id: number; name: string; version: string | null }>; rows: PassportRow[]; checkedAt: string }
  | { ok: false; reason: string };

const ToolRef = z.object({ toolId: z.number().int().positive() });
const KeyRef = z.object({ toolId: z.number().int().positive(), environmentId: z.number().int().positive().nullable(), key: z.string().min(1).max(100) });

/** One read per environment for the whole screen: every cell in a column sees the same record. */
function readOnce(reader: EnvironmentReader): EnvironmentReader & { versions: Map<number, string | null> } {
  const reads = new Map<number, Promise<EnvRead>>();
  const versions = new Map<number, string | null>();
  return {
    versions,
    read(e: Environment) {
      let r = reads.get(e.id);
      if (!r) {
        r = reader.read(e).then((x) => {
          versions.set(e.id, x.ok ? x.version : null);
          return x;
        });
        reads.set(e.id, r);
      }
      return r;
    },
  };
}

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

export async function handlePassport(payload: unknown, ctx: ResolverContext, deps: PassportDeps): Promise<PassportReply> {
  const asker = ctx.accountId;
  if (!asker) return { ok: false, reason: 'Not signed in' };
  const p = ToolRef.safeParse(payload);
  if (!p.success) return { ok: false, reason: 'Pick a tool' };
  const tool = await deps.loadTool(p.data.toolId);
  if (!tool) return { ok: false, reason: 'That tool no longer exists' };
  const [all, catalog, groups] = await Promise.all([deps.listEnvironments(tool.id), deps.loadCatalog(tool), deps.readGroups(asker)]);
  const environments = all.filter((e) => canPick(e, groups).ok);
  const reader = readOnce(deps.environments);

  const rows: PassportRow[] = [];
  for (const k of orderedCapabilities(catalog)) {
    const cells = await Promise.all(
      environments.map(async (environment): Promise<PassportCell> => {
        try {
          const answer = await answerRequirement({ requirement: [{ key: k.key }], tool, environment, asker, groups, catalog }, { repo: deps.repo, environments: reader });
          const card = buildCard(answer, { toolName: tool.name, environment, catalog });
          return { environmentId: environment.id, verdict: card.verdict, title: card.title, lozenge: card.lozenge, reason: card.reason };
        } catch (e) {
          console.error(`[passport] a cell failed: ${String(e).slice(0, 200)}`);
          return { environmentId: environment.id, verdict: null, title: "Couldn't check", lozenge: 'default', reason: 'Something went wrong while checking. Open it to try again.' };
        }
      }),
    );
    rows.push({ key: k.key, label: k.label, cells });
  }
  // One line per screen; no account id. Every cell is from catalog keys, so there are no model calls to count.
  console.log(`[passport] rows=${rows.length} environments=${environments.length}`);
  return {
    ok: true,
    tool: tool.name,
    environments: environments.map((e) => ({ id: e.id, name: e.name, version: reader.versions.get(e.id) ?? null })),
    rows,
    checkedAt: new Date().toISOString(),
  };
}

/** One Passport cell, asked: that key in that environment, answered and saved like any ask, with no model call. */
export async function handleAskKey(payload: unknown, ctx: ResolverContext, deps: PassportDeps): Promise<AskReply> {
  const asker = ctx.accountId;
  if (!asker) return { ok: false, error: 'not_signed_in', card: null };
  const p = KeyRef.safeParse(payload);
  if (!p.success) return { ok: false, error: 'bad_request', card: null };
  const tool = await deps.loadTool(p.data.toolId);
  if (!tool) return { ok: false, error: 'not_found', card: null };
  const environment = p.data.environmentId === null ? null : await deps.loadEnvironment(p.data.environmentId);
  if (p.data.environmentId !== null && !environment) return { ok: false, error: 'not_found', card: null };
  const [groups, catalog] = await Promise.all([deps.readGroups(asker), deps.loadCatalog(tool)]);
  const key = catalog.keys.get(p.data.key);
  if (!key || key.kind !== 'capability' || key.requiresValue) return { ok: false, error: 'bad_request', card: null };
  try {
    const answer = await answerRequirement({ requirement: [{ key: key.key }], tool, environment, asker, groups, catalog }, { repo: deps.repo, environments: deps.environments });
    return await finishAsk(answer, { asker, tool, environment, catalog, question: `Can I ${lowerFirst(key.label)}?`, source: 'passport' }, deps);
  } catch (e) {
    console.error(`[passport] ask failed: ${String(e).slice(0, 300)}`);
    return { ok: false, error: 'try_again', card: null };
  }
}

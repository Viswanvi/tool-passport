import type { CapabilityLink, Effect } from '../engine/model';
import type { RegistryWriter } from '../registry/write';
import { DEMO_RECORDS } from '../setup/assets-records';
import { DEMO_CATALOG, DEMO_TOOL_NAME } from './demo-catalog';

/**
 * "Load demo data" (spec section 16), written through the same owner-write code a customer's owner uses
 * (CLAUDE.md rule 6). Safe to run again: every write is an upsert. Fictional names only.
 *
 * Phase 1 scope (DECISIONS D31): this writes the app's own records and links the two environments to Assets
 * objects that already exist in the passport schema (looked up by name, read-only). Creating the schema, the
 * objects and the kestrel-* groups is the Phase 4 seed, behind the same administrator check.
 *
 * The person who loads the data plays Marco: they own the tool and both environments and verify the facts.
 */

/** Routes name who handles a request; Phase 1 step 6 resolves them to a person. */
export const ROUTES = { environmentOwner: 'environment_owner', toolOwner: 'tool_owner' } as const;

export interface SeedDeps {
  writer: RegistryWriter;
  /** Assets mode: the Assets object key of the passport object with this name, or null. */
  findObjectKey(name: string): Promise<string | null>;
  /**
   * Registry mode (spec section 16, "Judge path without Assets"): no Assets at all; each environment carries the
   * section 16 values, recorded by the person loading and shown as "Recorded by owner".
   */
  registry?: { now(): string };
  actor: string;
}

export type SeedResult =
  | { ok: true; toolId: number; environments: Array<{ name: string; providerRef: string }>; counts: Record<string, number>; warnings?: string[] }
  | { ok: false; reason: string };

const ENVIRONMENTS = ['KS-DEV', 'KS-PROD'] as const;
type EnvName = (typeof ENVIRONMENTS)[number];

const LINKS: CapabilityLink[] = [
  { capabilityKey: 'web_frontend', actions: ['custom_ui'], readinessKeys: ['frontend_build'] },
  { capabilityKey: 'runtime_3_9', actions: [], readinessKeys: [] },
  { capabilityKey: 'community_app_framework', actions: ['community_app_framework'], readinessKeys: [] },
  { capabilityKey: 'max_upload_gb', actions: [], readinessKeys: ['uploads'] },
  { capabilityKey: 'scheduled_jobs', actions: [], readinessKeys: [] },
  { capabilityKey: 'single_sign_on', actions: [], readinessKeys: [] },
  { capabilityKey: 'websockets', actions: [], readinessKeys: [] },
];

// All owner-verified on 13.2. websockets has no fact: the known unknown.
const FACTS: Array<{ key: string; value: boolean | number; versionSensitive: boolean; quote: string | null }> = [
  { key: 'web_frontend', value: true, versionSensitive: true, quote: 'Yes, through the build workflow' },
  { key: 'runtime_3_9', value: true, versionSensitive: true, quote: 'Supported' },
  { key: 'community_app_framework', value: true, versionSensitive: true, quote: 'Supported' },
  { key: 'max_upload_gb', value: 2, versionSensitive: true, quote: 'Up to 2 GB per file' },
  { key: 'scheduled_jobs', value: true, versionSensitive: false, quote: null },
  { key: 'single_sign_on', value: true, versionSensitive: false, quote: null },
];

const RULES: Array<{ action: string; env: EnvName; effect: Effect; reason: string; approval: boolean }> = [
  { action: 'custom_ui', env: 'KS-DEV', effect: 'approval', reason: 'Needs design review', approval: true },
  { action: 'custom_ui', env: 'KS-PROD', effect: 'deny', reason: 'Not allowed in production', approval: false },
  { action: 'community_app_framework', env: 'KS-DEV', effect: 'deny', reason: 'Pending security review', approval: false },
  { action: 'community_app_framework', env: 'KS-PROD', effect: 'deny', reason: 'Pending security review', approval: false },
  { action: 'external_api_calls', env: 'KS-DEV', effect: 'approval', reason: 'Needs security approval', approval: true },
  { action: 'external_api_calls', env: 'KS-PROD', effect: 'approval', reason: 'Needs security approval', approval: true },
  { action: 'external_sharing', env: 'KS-DEV', effect: 'deny', reason: 'Not allowed', approval: false },
  { action: 'external_sharing', env: 'KS-PROD', effect: 'deny', reason: 'Not allowed', approval: false },
];

const ACCESS: Array<{ action: string; env: EnvName; group: string | null; grants: string | null }> = [
  { action: 'custom_ui', env: 'KS-DEV', group: 'kestrel-dev-builders', grants: 'Developer role in Kestrel' },
  { action: 'custom_ui', env: 'KS-PROD', group: 'kestrel-prod-deployers', grants: 'Deployer role in Kestrel' },
  { action: 'community_app_framework', env: 'KS-DEV', group: null, grants: null },
  { action: 'community_app_framework', env: 'KS-PROD', group: null, grants: null },
];

/** The section 16 values an environment's record holds, as the registry keeps them (no Name or Tool). */
function recordedFor(name: EnvName): Record<string, string[]> {
  const r = DEMO_RECORDS.find((d) => d.Name[0] === name)!;
  return { Version: r.Version!, 'Build environments': r['Build environments']!, 'Features enabled': r['Features enabled']! };
}

export async function seedDemo(deps: SeedDeps): Promise<SeedResult> {
  const { writer, actor } = deps;
  // Assets mode: check the objects first, so a missing one writes nothing. Registry mode looks nothing up.
  const refs = new Map<EnvName, string>();
  if (!deps.registry) {
    for (const name of ENVIRONMENTS) {
      const ref = await deps.findObjectKey(name);
      if (!ref) return { ok: false, reason: `No ${name} object in the Tool Passport Environments schema in Assets` };
      refs.set(name, ref);
    }
  }
  const recordedAt = deps.registry?.now();

  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

  const toolId = await writer.upsertTool({ name: DEMO_TOOL_NAME, vendor: 'Kestrel Labs', ownerAccountId: actor, versionGranularity: 'minor', defaultPolicy: 'none' });
  count('tools');
  const envIds = new Map<EnvName, number>();
  for (const name of ENVIRONMENTS) {
    const environment = recordedAt
      ? { provider: 'registry' as const, providerRef: null, recordedValues: { values: recordedFor(name), recordedAt, recordedBy: actor } }
      : { provider: 'assets' as const, providerRef: refs.get(name)!, recordedValues: null };
    envIds.set(name, await writer.upsertEnvironment({ toolId, name, ...environment, ownerAccountId: actor, audienceGroup: null }));
    count('environments');
  }
  for (const k of DEMO_CATALOG) {
    await writer.upsertCatalogKey(toolId, k);
    count('catalogKeys');
  }
  for (const l of LINKS) {
    await writer.upsertLink(toolId, l, actor);
    count('links');
  }
  for (const f of FACTS) {
    const factId = await writer.upsertFact({ toolId, environmentId: null, audienceGroup: null, factKey: f.key, versionSensitive: f.versionSensitive, source: 'owner' });
    await writer.upsertFactVersion({ factId, version: '13.2', value: f.value, quote: f.quote, verifiedBy: actor });
    count('facts');
  }
  for (const r of RULES) {
    await writer.upsertRule({
      toolId,
      environmentId: envIds.get(r.env)!,
      audienceGroup: null,
      actionKey: r.action,
      effect: r.effect,
      approvalRoute: r.approval ? ROUTES.toolOwner : null,
      reason: r.reason,
    });
    count('rules');
  }
  await writer.upsertReadinessKey({ toolId, key: 'frontend_build', providerAttribute: 'Build environments', match: 'has', expected: 'frontend', label: 'Frontend build', fixRoute: ROUTES.environmentOwner });
  await writer.upsertReadinessKey({ toolId, key: 'uploads', providerAttribute: 'Features enabled', match: 'has', expected: 'uploads', label: 'Uploads', fixRoute: ROUTES.environmentOwner });
  counts.readinessKeys = 2;
  for (const a of ACCESS) {
    await writer.upsertAccessMapping({
      toolId,
      environmentId: envIds.get(a.env)!,
      actionKey: a.action,
      groupName: a.group,
      grants: a.grants,
      source: a.group ? 'idp_synced' : 'manual',
      attestedBy: actor,
      grantRoute: a.group ? ROUTES.toolOwner : null,
    });
    count('accessMappings');
  }
  await writer.bumpRevision(toolId);
  await writer.audit(actor, 'load_demo', 'tool', String(toolId), counts);
  return { ok: true, toolId, environments: ENVIRONMENTS.map((name) => ({ name, providerRef: refs.get(name) ?? 'Recorded by owner' })), counts };
}

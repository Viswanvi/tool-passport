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

/**
 * Which checks decide each capability. The spec's seven (section 16) plus the ones a team building internal apps
 * actually worries about: company data, endpoints other systems call, exports, secrets, audit (D62). Policy and
 * access differ between KS-DEV and KS-PROD, so the Passport shows every kind of answer, each for a real reason.
 * embed_in_pages and mobile_access stay unlinked: what an owner hasn't covered yet.
 */
const LINKS: CapabilityLink[] = [
  { capabilityKey: 'web_frontend', actions: ['custom_ui'], readinessKeys: ['frontend_build'] },
  { capabilityKey: 'runtime_3_9', actions: [], readinessKeys: [] },
  { capabilityKey: 'community_app_framework', actions: ['community_app_framework'], readinessKeys: [] },
  { capabilityKey: 'max_upload_gb', actions: [], readinessKeys: ['uploads'] },
  { capabilityKey: 'scheduled_jobs', actions: [], readinessKeys: ['scheduling'] },
  { capabilityKey: 'single_sign_on', actions: [], readinessKeys: ['sso'] },
  { capabilityKey: 'websockets', actions: [], readinessKeys: [] },
  { capabilityKey: 'database_connections', actions: ['company_data'], readinessKeys: [] },
  { capabilityKey: 'api_endpoints', actions: ['public_api'], readinessKeys: [] },
  { capabilityKey: 'export_csv', actions: ['data_export'], readinessKeys: [] },
  { capabilityKey: 'email_notifications', actions: [], readinessKeys: [] },
  { capabilityKey: 'secrets_storage', actions: [], readinessKeys: [] },
  { capabilityKey: 'audit_logging', actions: [], readinessKeys: [] },
  { capabilityKey: 'role_based_access', actions: [], readinessKeys: [] },
  { capabilityKey: 'version_control_sync', actions: [], readinessKeys: [] },
  { capabilityKey: 'background_workers', actions: [], readinessKeys: [] },
  { capabilityKey: 'gpu_compute', actions: [], readinessKeys: [] },
  { capabilityKey: 'custom_domains', actions: [], readinessKeys: [] },
];

/**
 * All owner-verified on 13.2. websockets, export_csv and email_notifications are linked but have no fact yet: the
 * judge guide's sample docs page fills them in (Fill in from your docs), and websockets is also the Ask the owner
 * example. Version-sensitive facts are the ones an upgrade stops the app vouching for.
 */
const FACTS: Array<{ key: string; value: boolean | number; versionSensitive: boolean; quote: string | null }> = [
  { key: 'web_frontend', value: true, versionSensitive: true, quote: 'Yes, through the build workflow' },
  { key: 'runtime_3_9', value: true, versionSensitive: true, quote: 'Supported' },
  { key: 'community_app_framework', value: true, versionSensitive: true, quote: 'Supported' },
  { key: 'max_upload_gb', value: 2, versionSensitive: true, quote: 'Up to 2 GB per file' },
  { key: 'scheduled_jobs', value: true, versionSensitive: false, quote: null },
  { key: 'single_sign_on', value: true, versionSensitive: false, quote: null },
  { key: 'database_connections', value: true, versionSensitive: false, quote: 'Apps connect to company databases through managed connections' },
  { key: 'api_endpoints', value: true, versionSensitive: true, quote: 'Apps can publish REST endpoints for other systems to call' },
  { key: 'background_workers', value: true, versionSensitive: true, quote: 'Long tasks run on background workers' },
  { key: 'secrets_storage', value: true, versionSensitive: false, quote: 'Passwords and API keys are kept in the encrypted secrets store' },
  { key: 'audit_logging', value: true, versionSensitive: false, quote: 'Every change is written to the audit log' },
  { key: 'role_based_access', value: true, versionSensitive: false, quote: 'Apps can give each role its own permissions' },
  { key: 'version_control_sync', value: true, versionSensitive: false, quote: "Each app's code is kept in the company git server" },
  { key: 'gpu_compute', value: false, versionSensitive: false, quote: 'GPU machines are not available' },
  { key: 'custom_domains', value: false, versionSensitive: false, quote: "Every app lives under the studio's own address" },
];

// Approvals count for 30 days, then the answer asks for approval again (D52; not in spec section 16).
const APPROVAL_DAYS = 30;

const RULES: Array<{ action: string; env: EnvName; effect: Effect; reason: string; approval: boolean }> = [
  { action: 'custom_ui', env: 'KS-DEV', effect: 'approval', reason: 'Needs design review', approval: true },
  { action: 'custom_ui', env: 'KS-PROD', effect: 'deny', reason: 'Not allowed in production', approval: false },
  { action: 'community_app_framework', env: 'KS-DEV', effect: 'deny', reason: 'Pending security review', approval: false },
  { action: 'community_app_framework', env: 'KS-PROD', effect: 'deny', reason: 'Pending security review', approval: false },
  { action: 'external_api_calls', env: 'KS-DEV', effect: 'approval', reason: 'Needs security approval', approval: true },
  { action: 'external_api_calls', env: 'KS-PROD', effect: 'approval', reason: 'Needs security approval', approval: true },
  { action: 'external_sharing', env: 'KS-DEV', effect: 'deny', reason: 'Not allowed', approval: false },
  { action: 'external_sharing', env: 'KS-PROD', effect: 'deny', reason: 'Not allowed', approval: false },
  // Development uses test data; production holds customer data, so the same thing needs a review there (D62).
  { action: 'company_data', env: 'KS-DEV', effect: 'allow', reason: 'Test data only', approval: false },
  { action: 'company_data', env: 'KS-PROD', effect: 'approval', reason: 'Customer data needs a privacy review', approval: true },
  { action: 'public_api', env: 'KS-DEV', effect: 'allow', reason: 'Allowed in development', approval: false },
  { action: 'public_api', env: 'KS-PROD', effect: 'approval', reason: 'Needs a security review', approval: true },
  { action: 'data_export', env: 'KS-DEV', effect: 'allow', reason: 'Test data only', approval: false },
  { action: 'data_export', env: 'KS-PROD', effect: 'approval', reason: "Exports of customer data need the data owner's approval", approval: true },
];

const ACCESS: Array<{ action: string; env: EnvName; group: string | null; grants: string | null }> = [
  { action: 'custom_ui', env: 'KS-DEV', group: 'kestrel-dev-builders', grants: 'Developer role in Kestrel' },
  { action: 'custom_ui', env: 'KS-PROD', group: 'kestrel-prod-deployers', grants: 'Deployer role in Kestrel' },
  { action: 'community_app_framework', env: 'KS-DEV', group: null, grants: null },
  { action: 'community_app_framework', env: 'KS-PROD', group: null, grants: null },
  { action: 'company_data', env: 'KS-DEV', group: 'kestrel-dev-builders', grants: 'Developer role in Kestrel' },
  { action: 'company_data', env: 'KS-PROD', group: 'kestrel-dev-builders', grants: 'Developer role in Kestrel' },
  { action: 'public_api', env: 'KS-DEV', group: 'kestrel-dev-builders', grants: 'Developer role in Kestrel' },
  // Publishing an endpoint in production is a deployer's job: a builder gets "Not ready" and a path to access.
  { action: 'public_api', env: 'KS-PROD', group: 'kestrel-prod-deployers', grants: 'Deployer role in Kestrel' },
  { action: 'data_export', env: 'KS-DEV', group: 'kestrel-dev-builders', grants: 'Developer role in Kestrel' },
  { action: 'data_export', env: 'KS-PROD', group: 'kestrel-dev-builders', grants: 'Developer role in Kestrel' },
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
      approvalDays: r.approval ? APPROVAL_DAYS : null,
    });
    count('rules');
  }
  await writer.upsertReadinessKey({ toolId, key: 'frontend_build', providerAttribute: 'Build environments', match: 'has', expected: 'frontend', label: 'Frontend build', fixRoute: ROUTES.environmentOwner });
  await writer.upsertReadinessKey({ toolId, key: 'uploads', providerAttribute: 'Features enabled', match: 'has', expected: 'uploads', label: 'Uploads', fixRoute: ROUTES.environmentOwner });
  // Read from the same Assets attribute: scheduling is on in both environments, single sign-on only in KS-PROD.
  await writer.upsertReadinessKey({ toolId, key: 'scheduling', providerAttribute: 'Features enabled', match: 'has', expected: 'scheduling', label: 'Scheduling', fixRoute: ROUTES.environmentOwner });
  await writer.upsertReadinessKey({ toolId, key: 'sso', providerAttribute: 'Features enabled', match: 'has', expected: 'single sign-on', label: 'Single sign-on', fixRoute: ROUTES.environmentOwner });
  counts.readinessKeys = 4;
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

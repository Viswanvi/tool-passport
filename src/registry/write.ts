import { sql } from '@forge/sql';
import type { CatalogKey } from '../engine/catalog';
import type { CapabilityLink, Effect } from '../engine/model';
import type { Granularity } from '../engine/version';
import type { RecordedValues } from '../providers/registry';

/**
 * Owner writes (spec F1 / P0-1). Every statement is an upsert on a unique key, so a write can be repeated
 * (no transactions in Forge SQL). These functions do no permission check themselves: every caller is a
 * resolver that has already checked "tool owner or Jira administrator" on the server (`authorise.ts`).
 * Values stored as JSON follow the readers in db/repo.ts (facts: `{ "value": … }`, D30).
 */

export const scopeKey = (toolId: number, environmentId: number | null, audienceGroup: string | null, key: string): string =>
  `${toolId}|${environmentId ?? '*'}|${audienceGroup ?? '*'}|${key}`;

export interface ToolInput {
  name: string;
  vendor: string | null;
  ownerAccountId: string;
  versionGranularity: Granularity;
  defaultPolicy: 'none' | 'allow';
}

export interface EnvironmentInput {
  toolId: number;
  name: string;
  provider: 'assets' | 'registry';
  providerRef: string | null;
  ownerAccountId: string;
  audienceGroup: string | null;
  recordedValues: RecordedValues | null;
}

export interface FactInput {
  toolId: number;
  environmentId: number | null;
  audienceGroup: string | null;
  factKey: string;
  versionSensitive: boolean;
  source: 'owner' | 'published_question';
}

export interface FactVersionInput {
  factId: number;
  version: string;
  value: boolean | number | string;
  quote: string | null;
  verifiedBy: string;
}

export interface RuleInput {
  toolId: number;
  environmentId: number | null;
  audienceGroup: string | null;
  actionKey: string;
  effect: Effect;
  approvalRoute: string | null;
  reason: string | null;
}

export interface ReadinessKeyInput {
  toolId: number;
  key: string;
  providerAttribute: string;
  match: 'has' | 'eq' | 'gte';
  expected: string;
  label: string;
  fixRoute: string | null;
}

export interface AccessMappingInput {
  toolId: number;
  environmentId: number;
  actionKey: string;
  groupName: string | null;
  grants: string | null;
  source: 'idp_synced' | 'manual';
  attestedBy: string;
  grantRoute: string | null;
}

/** Everything the owner can write. The SQL implementation is below; tests use an in-memory one. */
export interface RegistryWriter {
  upsertTool(t: ToolInput): Promise<number>;
  upsertEnvironment(e: EnvironmentInput): Promise<number>;
  upsertCatalogKey(toolId: number, k: CatalogKey): Promise<void>;
  upsertLink(toolId: number, link: CapabilityLink, setBy: string): Promise<void>;
  upsertFact(f: FactInput): Promise<number>;
  upsertFactVersion(v: FactVersionInput): Promise<void>;
  upsertRule(r: RuleInput): Promise<void>;
  upsertReadinessKey(rk: ReadinessKeyInput): Promise<void>;
  upsertAccessMapping(m: AccessMappingInput): Promise<void>;
  /** Every write changes what a translation may rely on, so the cache key moves on (spec section 10). */
  bumpRevision(toolId: number): Promise<void>;
  audit(actor: string, action: string, entity: string, entityId: string | null, after: unknown): Promise<void>;
}

async function run(query: string, ...params: unknown[]): Promise<void> {
  await sql.prepare(query).bindParams(...params).execute();
}

async function idOf(query: string, ...params: unknown[]): Promise<number> {
  const res = await sql.prepare<{ id: unknown }>(query).bindParams(...params).execute();
  const v = res.rows[0]?.id;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`No id after upsert: ${query.slice(0, 60)}`);
  return n;
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

export const sqlRegistryWriter: RegistryWriter = {
  async upsertTool(t) {
    await run(
      `INSERT INTO tools (name, vendor, owner_account_id, version_granularity, default_policy) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE vendor = VALUES(vendor), owner_account_id = VALUES(owner_account_id),
         version_granularity = VALUES(version_granularity), default_policy = VALUES(default_policy)`,
      t.name, t.vendor, t.ownerAccountId, t.versionGranularity, t.defaultPolicy,
    );
    return idOf('SELECT id FROM tools WHERE name = ?', t.name);
  },

  async upsertEnvironment(e) {
    await run(
      `INSERT INTO environments (tool_id, name, provider, provider_ref, owner_account_id, audience_group, recorded_values)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE provider = VALUES(provider), provider_ref = VALUES(provider_ref), owner_account_id = VALUES(owner_account_id),
         audience_group = VALUES(audience_group), recorded_values = VALUES(recorded_values)`,
      e.toolId, e.name, e.provider, e.providerRef, e.ownerAccountId, e.audienceGroup, json(e.recordedValues),
    );
    return idOf('SELECT id FROM environments WHERE tool_id = ? AND name = ?', e.toolId, e.name);
  },

  async upsertCatalogKey(toolId, k) {
    const valueType = k.valueType === 'text' ? 'string' : k.valueType;
    await run(
      `INSERT INTO catalog_keys (tool_id, key_name, kind, label, value_type, comparison, requires_value, synonyms, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE kind = VALUES(kind), label = VALUES(label), value_type = VALUES(value_type), comparison = VALUES(comparison),
         requires_value = VALUES(requires_value), synonyms = VALUES(synonyms), unit = VALUES(unit)`,
      toolId, k.key, k.kind, k.label, valueType, k.comparison, k.requiresValue, json(k.synonyms), k.unit ?? null,
    );
  },

  async upsertLink(toolId, link, setBy) {
    await run(
      `INSERT INTO capability_links (tool_id, capability_key, actions, readiness_keys, set_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE actions = VALUES(actions), readiness_keys = VALUES(readiness_keys), set_by = VALUES(set_by), set_at = CURRENT_TIMESTAMP`,
      toolId, link.capabilityKey, json(link.actions), json(link.readinessKeys), setBy,
    );
  },

  async upsertFact(f) {
    const scope = scopeKey(f.toolId, f.environmentId, f.audienceGroup, f.factKey);
    await run(
      `INSERT INTO facts (tool_id, environment_id, audience_group, fact_key, version_sensitive, status, source, scope_key)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
       ON DUPLICATE KEY UPDATE version_sensitive = VALUES(version_sensitive), status = 'active', source = VALUES(source)`,
      f.toolId, f.environmentId, f.audienceGroup, f.factKey, f.versionSensitive, f.source, scope,
    );
    return idOf('SELECT id FROM facts WHERE scope_key = ?', scope);
  },

  async upsertFactVersion(v) {
    await run(
      `INSERT INTO fact_versions (fact_id, version, value_json, quote, verified_by, status) VALUES (?, ?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), quote = VALUES(quote), verified_by = VALUES(verified_by),
         verified_at = CURRENT_TIMESTAMP, status = 'active'`,
      v.factId, v.version, JSON.stringify({ value: v.value }), v.quote, v.verifiedBy,
    );
  },

  async upsertRule(r) {
    await run(
      `INSERT INTO rules (tool_id, environment_id, audience_group, action_key, effect, approval_route, reason, status, scope_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
       ON DUPLICATE KEY UPDATE effect = VALUES(effect), approval_route = VALUES(approval_route), reason = VALUES(reason),
         status = 'active', revision = revision + 1`,
      r.toolId, r.environmentId, r.audienceGroup, r.actionKey, r.effect, r.approvalRoute, r.reason,
      scopeKey(r.toolId, r.environmentId, r.audienceGroup, r.actionKey),
    );
  },

  async upsertReadinessKey(rk) {
    await run(
      `INSERT INTO readiness_keys (tool_id, key_name, provider_attribute, match_kind, expected, label, fix_route) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE provider_attribute = VALUES(provider_attribute), match_kind = VALUES(match_kind), expected = VALUES(expected),
         label = VALUES(label), fix_route = VALUES(fix_route)`,
      rk.toolId, rk.key, rk.providerAttribute, rk.match, rk.expected, rk.label, rk.fixRoute,
    );
  },

  async upsertAccessMapping(m) {
    await run(
      `INSERT INTO access_mappings (tool_id, environment_id, action_key, group_name, grants, source, attested_by, grant_route)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE group_name = VALUES(group_name), grants = VALUES(grants), source = VALUES(source),
         attested_by = VALUES(attested_by), attested_at = CURRENT_TIMESTAMP, grant_route = VALUES(grant_route)`,
      m.toolId, m.environmentId, m.actionKey, m.groupName, m.grants, m.source, m.attestedBy, m.grantRoute,
    );
  },

  async bumpRevision(toolId) {
    await run('UPDATE tools SET catalog_revision = catalog_revision + 1 WHERE id = ?', toolId);
  },

  async audit(actor, action, entity, entityId, after) {
    await run('INSERT INTO audit_log (actor_account_id, action, entity, entity_id, after_json) VALUES (?, ?, ?, ?, ?)', actor, action, entity, entityId, json(after));
  },
};

import { sql } from '@forge/sql';
import type { CatalogKey } from '../engine/catalog';
import type {
  AccessMappingRow,
  ApprovalGrantRow,
  CapabilityLink,
  Catalog,
  EngineRepo,
  Environment,
  FactRow,
  FactVersionRow,
  ReadinessKeyRow,
  RuleRow,
  Tool,
} from '../engine/model';
import type { Granularity } from '../engine/version';
import { DEMO_EXAMPLES } from '../seed/demo-catalog';
import { fromJsonColumn, limitClause } from './store';

/**
 * Forge SQL reads for the engine (spec section 10 tables; `EngineRepo` in engine/model.ts). Enum-like
 * columns are VARCHAR (D11), so every row is checked as it is read: a row with a value this code doesn't
 * know throws, and the engine turns that into Not verified with Re-check. A bad row is never guessed at.
 */

type Row = Record<string, unknown>;

async function select(query: string, ...params: unknown[]): Promise<Row[]> {
  const res = await sql.prepare<Row>(query).bindParams(...params).execute();
  return (res.rows ?? []) as Row[];
}

class BadRow extends Error {
  constructor(table: string, column: string, value: unknown) {
    super(`Unreadable ${table}.${column}: ${JSON.stringify(value)?.slice(0, 80)}`);
  }
}

export function id(v: unknown, table: string, column: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n)) throw new BadRow(table, column, v);
  return n;
}
export const idOrNull = (v: unknown, t: string, c: string) => (v === null || v === undefined ? null : id(v, t, c));

export function text(v: unknown, table: string, column: string): string {
  if (typeof v !== 'string') throw new BadRow(table, column, v);
  return v;
}
export const textOrNull = (v: unknown, t: string, c: string) => (v === null || v === undefined ? null : text(v, t, c));

/** MySQL BOOLEAN is TINYINT(1): accept true/false and 1/0. */
export function bool(v: unknown, table: string, column: string): boolean {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  throw new BadRow(table, column, v);
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], table: string, column: string): T {
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  throw new BadRow(table, column, v);
}

/** TIMESTAMP columns may arrive as strings or Dates; keep strings exactly as stored (E7 baselines rely on it). */
export function time(v: unknown, table: string, column: string): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return text(v, table, column);
}

/**
 * `fact_versions.value_json` holds `{ "value": <boolean | number | string> }`. Wrapping keeps a stored string
 * from being read as JSON a second time (JSON columns may arrive parsed or as text, store.ts). D30.
 */
export function factValue(v: unknown): unknown {
  const parsed = fromJsonColumn<unknown>(v);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.hasOwn(parsed, 'value')) {
    throw new BadRow('fact_versions', 'value_json', v);
  }
  return (parsed as { value: unknown }).value;
}

const STATUS = ['active', 'retired'] as const;

function factRow(r: Row): FactRow {
  return {
    id: id(r.id, 'facts', 'id'),
    toolId: id(r.tool_id, 'facts', 'tool_id'),
    environmentId: idOrNull(r.environment_id, 'facts', 'environment_id'),
    audienceGroup: textOrNull(r.audience_group, 'facts', 'audience_group'),
    factKey: text(r.fact_key, 'facts', 'fact_key'),
    versionSensitive: bool(r.version_sensitive, 'facts', 'version_sensitive'),
    status: oneOf(r.status, STATUS, 'facts', 'status'),
  };
}

function factVersionRow(r: Row): FactVersionRow {
  return {
    id: id(r.id, 'fact_versions', 'id'),
    factId: id(r.fact_id, 'fact_versions', 'fact_id'),
    version: text(r.version, 'fact_versions', 'version'),
    value: factValue(r.value_json),
    quote: textOrNull(r.quote, 'fact_versions', 'quote'),
    verifiedBy: text(r.verified_by, 'fact_versions', 'verified_by'),
    verifiedAt: time(r.verified_at, 'fact_versions', 'verified_at') ?? '',
    status: oneOf(r.status, STATUS, 'fact_versions', 'status'),
  };
}

function ruleRow(r: Row): RuleRow {
  return {
    id: id(r.id, 'rules', 'id'),
    toolId: id(r.tool_id, 'rules', 'tool_id'),
    environmentId: idOrNull(r.environment_id, 'rules', 'environment_id'),
    audienceGroup: textOrNull(r.audience_group, 'rules', 'audience_group'),
    actionKey: text(r.action_key, 'rules', 'action_key'),
    effect: oneOf(r.effect, ['allow', 'deny', 'approval'] as const, 'rules', 'effect'),
    approvalRoute: textOrNull(r.approval_route, 'rules', 'approval_route'),
    reason: textOrNull(r.reason, 'rules', 'reason'),
    revision: id(r.revision, 'rules', 'revision'),
    status: oneOf(r.status, STATUS, 'rules', 'status'),
  };
}

const FACT_COLUMNS = 'id, tool_id, environment_id, audience_group, fact_key, version_sensitive, status';
const VERSION_COLUMNS = 'id, fact_id, version, value_json, quote, verified_by, verified_at, status';

export const sqlEngineRepo: EngineRepo = {
  async facts(toolId, key) {
    return (await select(`SELECT ${FACT_COLUMNS} FROM facts WHERE tool_id = ? AND fact_key = ?`, toolId, key)).map(factRow);
  },

  async activeVersion(factId, version) {
    const rows = await select(`SELECT ${VERSION_COLUMNS} FROM fact_versions WHERE fact_id = ? AND version = ? AND status = 'active'`, factId, version);
    return rows[0] ? factVersionRow(rows[0]) : null;
  },

  async latestVersion(factId) {
    const rows = await select(
      `SELECT ${VERSION_COLUMNS} FROM fact_versions WHERE fact_id = ? AND status = 'active' ORDER BY verified_at DESC, id DESC ${limitClause(1)}`,
      factId,
    );
    return rows[0] ? factVersionRow(rows[0]) : null;
  },

  async verifiedVersions(factId) {
    const rows = await select("SELECT version FROM fact_versions WHERE fact_id = ? AND status = 'active' ORDER BY verified_at, id", factId);
    return rows.map((r) => text(r.version, 'fact_versions', 'version'));
  },

  async rules(toolId, action) {
    return (await select(`SELECT ${RULE_COLUMNS} FROM rules WHERE tool_id = ? AND action_key = ?`, toolId, action)).map(ruleRow);
  },

  async approvalGrant(asker, toolId, environmentId, action) {
    const rows = await select(
      `SELECT id, asker_account_id, tool_id, environment_id, action_key, request_key, status, decided_at FROM approval_grants
       WHERE asker_account_id = ? AND tool_id = ? AND environment_id = ? AND action_key = ? ORDER BY id DESC ${limitClause(1)}`,
      asker,
      toolId,
      environmentId,
      action,
    );
    const r = rows[0];
    if (!r) return null;
    const grant: ApprovalGrantRow = {
      id: id(r.id, 'approval_grants', 'id'),
      askerAccountId: text(r.asker_account_id, 'approval_grants', 'asker_account_id'),
      toolId: id(r.tool_id, 'approval_grants', 'tool_id'),
      environmentId: id(r.environment_id, 'approval_grants', 'environment_id'),
      actionKey: text(r.action_key, 'approval_grants', 'action_key'),
      requestKey: text(r.request_key, 'approval_grants', 'request_key'),
      status: oneOf(r.status, ['pending', 'approved', 'declined'] as const, 'approval_grants', 'status'),
      decidedAt: time(r.decided_at, 'approval_grants', 'decided_at'),
    };
    return grant;
  },

  async readinessKey(toolId, key) {
    const rows = await select(`SELECT ${READINESS_COLUMNS} FROM readiness_keys WHERE tool_id = ? AND key_name = ?`, toolId, key);
    return rows[0] ? readinessRow(rows[0]) : null;
  },

  async accessMapping(toolId, environmentId, action) {
    const rows = await select(`SELECT ${ACCESS_COLUMNS} FROM access_mappings WHERE tool_id = ? AND environment_id = ? AND action_key = ?`, toolId, environmentId, action);
    return rows[0] ? accessRow(rows[0]) : null;
  },
};

const RULE_COLUMNS = 'id, tool_id, environment_id, audience_group, action_key, effect, approval_route, reason, revision, status';
const READINESS_COLUMNS = 'id, tool_id, key_name, provider_attribute, match_kind, expected, label, fix_route';
const ACCESS_COLUMNS = 'id, tool_id, environment_id, action_key, group_name, grants, source, attested_by, attested_at, grant_route';

function readinessRow(r: Row): ReadinessKeyRow {
  return {
    id: id(r.id, 'readiness_keys', 'id'),
    toolId: id(r.tool_id, 'readiness_keys', 'tool_id'),
    key: text(r.key_name, 'readiness_keys', 'key_name'),
    providerAttribute: text(r.provider_attribute, 'readiness_keys', 'provider_attribute'),
    match: oneOf(r.match_kind, ['has', 'eq', 'gte'] as const, 'readiness_keys', 'match_kind'),
    expected: text(r.expected, 'readiness_keys', 'expected'),
    label: text(r.label, 'readiness_keys', 'label'),
    fixRoute: textOrNull(r.fix_route, 'readiness_keys', 'fix_route'),
  };
}

function accessRow(r: Row): AccessMappingRow {
  return {
    id: id(r.id, 'access_mappings', 'id'),
    toolId: id(r.tool_id, 'access_mappings', 'tool_id'),
    environmentId: id(r.environment_id, 'access_mappings', 'environment_id'),
    actionKey: text(r.action_key, 'access_mappings', 'action_key'),
    groupName: textOrNull(r.group_name, 'access_mappings', 'group_name'),
    grants: textOrNull(r.grants, 'access_mappings', 'grants'),
    source: oneOf(r.source, ['idp_synced', 'manual'] as const, 'access_mappings', 'source'),
    attestedBy: text(r.attested_by, 'access_mappings', 'attested_by'),
    attestedAt: time(r.attested_at, 'access_mappings', 'attested_at') ?? '',
    grantRoute: textOrNull(r.grant_route, 'access_mappings', 'grant_route'),
  };
}

/** Everything the owner records for a tool, for My tools (spec section 15). Read-only. */
export async function loadRegistry(toolId: number): Promise<{
  facts: Array<FactRow & { versions: FactVersionRow[] }>;
  rules: RuleRow[];
  readinessKeys: ReadinessKeyRow[];
  accessMappings: AccessMappingRow[];
}> {
  const facts = (await select(`SELECT ${FACT_COLUMNS} FROM facts WHERE tool_id = ? ORDER BY fact_key, id`, toolId)).map(factRow);
  const versions = facts.length
    ? (await select(`SELECT ${VERSION_COLUMNS} FROM fact_versions WHERE fact_id IN (${facts.map(() => '?').join(', ')}) ORDER BY verified_at, id`, ...facts.map((f) => f.id))).map(factVersionRow)
    : [];
  const [rules, readinessKeys, accessMappings] = await Promise.all([
    select(`SELECT ${RULE_COLUMNS} FROM rules WHERE tool_id = ? ORDER BY action_key, id`, toolId).then((rows) => rows.map(ruleRow)),
    select(`SELECT ${READINESS_COLUMNS} FROM readiness_keys WHERE tool_id = ? ORDER BY key_name`, toolId).then((rows) => rows.map(readinessRow)),
    select(`SELECT ${ACCESS_COLUMNS} FROM access_mappings WHERE tool_id = ? ORDER BY environment_id, action_key`, toolId).then((rows) => rows.map(accessRow)),
  ]);
  return { facts: facts.map((f) => ({ ...f, versions: versions.filter((v) => v.factId === f.id) })), rules, readinessKeys, accessMappings };
}

// ---- loaders used by the resolvers ------------------------------------------------------------------

export async function loadTool(toolId: number): Promise<Tool | null> {
  const rows = await select('SELECT id, name, owner_account_id, version_granularity, default_policy, catalog_revision FROM tools WHERE id = ?', toolId);
  const r = rows[0];
  if (!r) return null;
  return {
    id: id(r.id, 'tools', 'id'),
    name: text(r.name, 'tools', 'name'),
    ownerAccountId: text(r.owner_account_id, 'tools', 'owner_account_id'),
    versionGranularity: oneOf<Granularity>(r.version_granularity, ['major', 'minor', 'exact'], 'tools', 'version_granularity'),
    defaultPolicy: oneOf(r.default_policy, ['none', 'allow'] as const, 'tools', 'default_policy'),
    catalogRevision: id(r.catalog_revision, 'tools', 'catalog_revision'),
  };
}

const ENVIRONMENT_COLUMNS = 'id, tool_id, name, provider, provider_ref, owner_account_id, audience_group, last_seen_version, last_seen_at, recorded_values';

export async function loadEnvironment(environmentId: number): Promise<Environment | null> {
  const rows = await select(`SELECT ${ENVIRONMENT_COLUMNS} FROM environments WHERE id = ?`, environmentId);
  return rows[0] ? environmentRow(rows[0]) : null;
}

export async function listEnvironments(toolId: number): Promise<Environment[]> {
  return (await select(`SELECT ${ENVIRONMENT_COLUMNS} FROM environments WHERE tool_id = ? ORDER BY name`, toolId)).map(environmentRow);
}

export async function listTools(): Promise<Array<{ id: number; name: string }>> {
  const rows = await select('SELECT id, name FROM tools ORDER BY name');
  return rows.map((r) => ({ id: id(r.id, 'tools', 'id'), name: text(r.name, 'tools', 'name') }));
}

function environmentRow(r: Row): Environment {
  return {
    id: id(r.id, 'environments', 'id'),
    toolId: id(r.tool_id, 'environments', 'tool_id'),
    name: text(r.name, 'environments', 'name'),
    provider: oneOf(r.provider, ['assets', 'registry'] as const, 'environments', 'provider'),
    providerRef: textOrNull(r.provider_ref, 'environments', 'provider_ref'),
    ownerAccountId: text(r.owner_account_id, 'environments', 'owner_account_id'),
    audienceGroup: textOrNull(r.audience_group, 'environments', 'audience_group'),
    lastSeenVersion: textOrNull(r.last_seen_version, 'environments', 'last_seen_version'),
    lastSeenAt: time(r.last_seen_at, 'environments', 'last_seen_at'),
    recordedValues: r.recorded_values ?? null,
  };
}

function stringList(v: unknown): string[] | null {
  let parsed: unknown;
  try {
    parsed = fromJsonColumn<unknown>(v);
  } catch {
    return null;
  }
  return Array.isArray(parsed) && parsed.every((s) => typeof s === 'string') ? (parsed as string[]) : null;
}

/** catalog_keys.value_type is 'string' | 'number' | 'boolean' (migration comment); the engine says 'text'. */
function valueType(v: unknown): CatalogKey['valueType'] {
  if (v === null || v === undefined || v === 'boolean') return 'boolean';
  if (v === 'number') return 'number';
  if (v === 'string' || v === 'text') return 'text';
  throw new BadRow('catalog_keys', 'value_type', v);
}

/**
 * The tool's catalog at its current revision: keys with their fixed comparisons, and capability links. A link
 * whose lists can't be read counts as not recorded (Not verified), never as "needs nothing". The worked
 * examples are the demo tool's, for every tool (spec section 13, prompt rule 6).
 */
export async function loadCatalog(tool: Tool): Promise<Catalog> {
  const keyRows = await select(
    'SELECT key_name, kind, label, value_type, comparison, requires_value, synonyms, unit FROM catalog_keys WHERE tool_id = ? ORDER BY id',
    tool.id,
  );
  const keys = new Map<string, CatalogKey>();
  for (const r of keyRows) {
    const key: CatalogKey = {
      key: text(r.key_name, 'catalog_keys', 'key_name'),
      kind: oneOf(r.kind, ['capability', 'action', 'readiness'] as const, 'catalog_keys', 'kind'),
      label: text(r.label, 'catalog_keys', 'label'),
      valueType: valueType(r.value_type),
      comparison: oneOf(r.comparison, ['has', 'eq', 'gte', 'lte'] as const, 'catalog_keys', 'comparison'),
      requiresValue: bool(r.requires_value, 'catalog_keys', 'requires_value'),
      synonyms: stringList(r.synonyms) ?? [],
    };
    const unit = textOrNull(r.unit, 'catalog_keys', 'unit');
    keys.set(key.key, unit ? { ...key, unit } : key);
  }
  const linkRows = await select('SELECT capability_key, actions, readiness_keys FROM capability_links WHERE tool_id = ?', tool.id);
  const links = new Map<string, CapabilityLink>();
  for (const r of linkRows) {
    const capabilityKey = text(r.capability_key, 'capability_links', 'capability_key');
    links.set(capabilityKey, { capabilityKey, actions: stringList(r.actions), readinessKeys: stringList(r.readiness_keys) });
  }
  return { revision: tool.catalogRevision, keys, links, examples: DEMO_EXAMPLES };
}

/** Attribute names the tool's readiness keys read: the only environment attributes a provider returns. */
export async function mappedAttributes(toolId: number): Promise<string[]> {
  const rows = await select('SELECT DISTINCT provider_attribute FROM readiness_keys WHERE tool_id = ?', toolId);
  return rows.map((r) => text(r.provider_attribute, 'readiness_keys', 'provider_attribute'));
}

import { migrationRunner } from '@forge/sql';

/**
 * Forge SQL schema (spec section 10).
 *
 * Forge SQL has no transactions and no foreign keys, so every statement is safe to repeat
 * (IF NOT EXISTS) and relations are enforced in code. Columns the spec types as ENUM are
 * VARCHAR here and validated in code, and the reserved words `key` and `match` are renamed
 * (`key_name`, `match_kind`); see docs/DECISIONS.md D11-D13.
 *
 * Migration names are permanent: the runner records them per installation. Never edit a
 * shipped statement; add a new migration instead.
 */
export interface Migration {
  name: string;
  ddl: string;
}

/** The 17 tables named in spec section 10. Tests check every one is created. */
export const SPEC_TABLES = [
  'tools',
  'environments',
  'catalog_keys',
  'capability_links',
  'facts',
  'fact_versions',
  'rules',
  'readiness_keys',
  'access_mappings',
  'approval_grants',
  'requests',
  'asks',
  'changes',
  'recheck_items',
  'release_labels',
  'translations',
  'audit_log',
] as const;

export const MIGRATIONS: Migration[] = [
  {
    name: 'v001_tools',
    ddl: `CREATE TABLE IF NOT EXISTS tools (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  vendor VARCHAR(255) NULL,
  owner_account_id VARCHAR(128) NOT NULL,
  version_granularity VARCHAR(8) NOT NULL DEFAULT 'minor',  -- major | minor | exact
  default_policy VARCHAR(8) NOT NULL DEFAULT 'none',         -- none | allow; none = missing rule is Not verified
  catalog_revision INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_tool_name (name)
)`,
  },
  {
    name: 'v002_environments',
    ddl: `CREATE TABLE IF NOT EXISTS environments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(16) NOT NULL,                -- assets | registry
  provider_ref VARCHAR(255) NULL,               -- Assets object key/id for provider = assets
  owner_account_id VARCHAR(128) NOT NULL,
  audience_group VARCHAR(255) NULL,             -- null = everyone may pick it
  last_seen_version VARCHAR(32) NULL,
  last_seen_at TIMESTAMP NULL,
  recorded_values JSON NULL,                    -- registry environments only
  last_checked_at TIMESTAMP NULL,
  UNIQUE KEY one_env_name (tool_id, name)
)`,
  },
  {
    name: 'v003_catalog_keys',
    ddl: `CREATE TABLE IF NOT EXISTS catalog_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  key_name VARCHAR(128) NOT NULL,               -- spec: key (reserved word)
  kind VARCHAR(16) NOT NULL,                    -- capability | action | readiness
  label VARCHAR(255) NOT NULL,
  value_type VARCHAR(16) NULL,                  -- string | number | boolean
  comparison VARCHAR(8) NOT NULL,               -- has | eq | gte | lte; fixed here, never by the model
  requires_value BOOLEAN NOT NULL DEFAULT FALSE,
  synonyms JSON NULL,
  UNIQUE KEY one_key (tool_id, key_name)
)`,
  },
  {
    name: 'v004_capability_links',
    ddl: `CREATE TABLE IF NOT EXISTS capability_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  capability_key VARCHAR(128) NOT NULL,
  actions JSON NULL,                            -- [] = owner says none; NULL = not recorded (Not verified)
  readiness_keys JSON NULL,                     -- same convention
  set_by VARCHAR(128) NOT NULL,
  set_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_link (tool_id, capability_key)
)`,
  },
  {
    name: 'v005_facts',
    ddl: `CREATE TABLE IF NOT EXISTS facts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  environment_id BIGINT NULL,                   -- null = every environment
  audience_group VARCHAR(255) NULL,             -- null = everyone
  fact_key VARCHAR(128) NOT NULL,
  version_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active | retired
  source VARCHAR(24) NOT NULL,                  -- owner | published_question
  scope_key VARCHAR(512) NOT NULL,              -- tool|env-or-*|group-or-*|key, so nulls can't slip past uniqueness
  UNIQUE KEY one_fact_per_scope (scope_key)
)`,
  },
  {
    name: 'v006_fact_versions',
    ddl: `CREATE TABLE IF NOT EXISTS fact_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fact_id BIGINT NOT NULL,
  version VARCHAR(32) NOT NULL,                 -- normalised to the tool's granularity, e.g. 13.2
  value_json JSON NOT NULL,
  quote TEXT NULL,
  verified_by VARCHAR(128) NOT NULL,
  verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active | retired
  UNIQUE KEY one_per_version (fact_id, version)
)`,
  },
  {
    name: 'v007_rules',
    ddl: `CREATE TABLE IF NOT EXISTS rules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  environment_id BIGINT NULL,
  audience_group VARCHAR(255) NULL,
  action_key VARCHAR(128) NOT NULL,
  effect VARCHAR(16) NOT NULL,                  -- allow | deny | approval
  approval_route VARCHAR(255) NULL,
  reason VARCHAR(512) NULL,
  revision INT NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- not in the spec's table list, but mostSpecific() filters retired rows
  KEY rules_by_action (tool_id, action_key)
)`,
  },
  {
    name: 'v008_readiness_keys',
    ddl: `CREATE TABLE IF NOT EXISTS readiness_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  key_name VARCHAR(128) NOT NULL,               -- spec: key (reserved word)
  provider_attribute VARCHAR(255) NOT NULL,     -- the Assets attribute (or registry field) that shows it
  match_kind VARCHAR(8) NOT NULL,               -- spec: match (reserved word); has | eq | gte
  expected VARCHAR(255) NOT NULL,
  label VARCHAR(255) NOT NULL,
  fix_route VARCHAR(255) NULL,
  UNIQUE KEY one_readiness_key (tool_id, key_name)
)`,
  },
  {
    name: 'v009_access_mappings',
    ddl: `CREATE TABLE IF NOT EXISTS access_mappings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  environment_id BIGINT NOT NULL,
  action_key VARCHAR(128) NOT NULL,
  group_name VARCHAR(255) NULL,                 -- null = owner says no access is needed
  grants VARCHAR(255) NULL,                     -- e.g. "Developer role in Kestrel"
  source VARCHAR(16) NOT NULL,                  -- idp_synced | manual
  attested_by VARCHAR(128) NOT NULL,
  attested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  grant_route VARCHAR(255) NULL,
  UNIQUE KEY one_mapping (tool_id, environment_id, action_key)
)`,
  },
  {
    name: 'v010_approval_grants',
    ddl: `CREATE TABLE IF NOT EXISTS approval_grants (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  asker_account_id VARCHAR(128) NOT NULL,
  tool_id BIGINT NOT NULL,
  environment_id BIGINT NOT NULL,
  action_key VARCHAR(128) NOT NULL,
  request_key VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | approved | declined
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_grant_per_request (request_key),
  KEY grants_by_asker (asker_account_id, tool_id, environment_id, action_key)
)`,
  },
  {
    name: 'v011_requests',
    ddl: `CREATE TABLE IF NOT EXISTS requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,                    -- fix | approval | question
  ask_id BIGINT NOT NULL,
  tool_id BIGINT NOT NULL,                      -- not in the spec's table list; publishAnswer() finds open questions by tool
  environment_id BIGINT NULL,                   -- not in the spec's table list; openRequest() filters by environment
  asker_account_id VARCHAR(128) NOT NULL,
  owner_account_id VARCHAR(128) NOT NULL,
  request_key VARCHAR(32) NULL,
  target VARCHAR(255) NOT NULL,
  requirement_hash VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  open_key VARCHAR(512) NULL,                   -- kind|env|target|asker while open, NULL once closed: one open request per person, kind and target without transactions
  resolved_at TIMESTAMP NULL,
  rechecked_at TIMESTAMP NULL,
  result JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_request_key (request_key),
  UNIQUE KEY one_open_request (open_key)
)`,
  },
  {
    name: 'v012_asks',
    ddl: `CREATE TABLE IF NOT EXISTS asks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  asker_account_id VARCHAR(128) NOT NULL,
  tool_id BIGINT NOT NULL,
  environment_id BIGINT NULL,
  question_text TEXT NULL,                      -- deleted after 30 days
  requirement_json JSON NULL,
  verdict VARCHAR(24) NULL,
  evidence_json JSON NULL,                      -- fact version ids used
  model_id VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  may_have_changed BOOLEAN NOT NULL DEFAULT FALSE,
  KEY asks_by_asker (asker_account_id, created_at)
)`,
  },
  {
    name: 'v013_changes',
    ddl: `CREATE TABLE IF NOT EXISTS changes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  environment_id BIGINT NOT NULL,
  baseline_at TIMESTAMP NOT NULL,               -- when from_version was first seen
  from_version VARCHAR(32) NOT NULL,
  to_version VARCHAR(32) NOT NULL,
  origin VARCHAR(16) NOT NULL,                  -- detected | recorded
  status VARCHAR(16) NOT NULL DEFAULT 'open',   -- open | listed | failed
  attempts INT NOT NULL DEFAULT 0,
  owner_notified_at TIMESTAMP NULL,
  error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_change (environment_id, baseline_at, to_version)
)`,
  },
  {
    name: 'v014_recheck_items',
    ddl: `CREATE TABLE IF NOT EXISTS recheck_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  change_id BIGINT NOT NULL,
  kind VARCHAR(8) NOT NULL,                     -- fact | ask
  ref_id BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  UNIQUE KEY one_item (change_id, kind, ref_id)
)`,
  },
  {
    name: 'v015_release_labels',
    ddl: `CREATE TABLE IF NOT EXISTS release_labels (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  change_id BIGINT NOT NULL,
  fact_id BIGINT NOT NULL,
  label VARCHAR(16) NOT NULL,                   -- still_true | changed | removed | cant_tell
  quote TEXT NULL,
  model_id VARCHAR(128) NULL,
  UNIQUE KEY one_label (change_id, fact_id)
)`,
  },
  {
    name: 'v016_translations',
    ddl: `CREATE TABLE IF NOT EXISTS translations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tool_id BIGINT NOT NULL,
  catalog_revision INT NOT NULL,
  question_hash VARCHAR(64) NOT NULL,           -- holds no question text
  requirement_json JSON NOT NULL,
  model_id VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_translation (tool_id, catalog_revision, question_hash)
)`,
  },
  {
    name: 'v017_audit_log',
    ddl: `CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_account_id VARCHAR(128) NOT NULL,       -- the app writes as 'app'
  action VARCHAR(64) NOT NULL,
  entity VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,
  },
  {
    // Not in the spec's table list: the spec reads settings.serviceDeskId, requestTypes,
    // resolutionMap and model() without saying where they live (DECISIONS D14).
    name: 'v018_app_settings',
    ddl: `CREATE TABLE IF NOT EXISTS app_settings (
  name VARCHAR(64) PRIMARY KEY,
  value_json JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`,
  },
  {
    // Phase 0 only. Dropped by a later migration once the experiments are written up.
    name: 'v019_experiment_runs',
    ddl: `CREATE TABLE IF NOT EXISTS experiment_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  experiment VARCHAR(8) NOT NULL,
  context VARCHAR(32) NOT NULL,
  ok BOOLEAN NOT NULL,
  summary VARCHAR(512) NOT NULL,
  detail JSON NULL,
  ran_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
  KEY runs_by_experiment (experiment, ran_at)
)`,
  },
];

// The runner is a module-level singleton that accumulates enqueued statements, so the list is
// enqueued exactly once per process; run() then applies only what this installation lacks.
let enqueued = false;

export async function runMigrations(): Promise<string[]> {
  if (!enqueued) {
    for (const m of MIGRATIONS) migrationRunner.enqueue(m.name, m.ddl);
    enqueued = true;
  }
  return migrationRunner.run();
}

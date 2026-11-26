import type { CatalogChoice, CatalogKey, WorkedExample } from './catalog';
import type { Granularity } from './version';

/**
 * Domain types the engine works on (spec sections 5, 10 and 11). Plain data, camelCase versions of the
 * Forge SQL rows; the repository maps columns to these. No Forge imports anywhere in `src/engine/`.
 */

export interface Tool {
  id: number;
  name: string;
  ownerAccountId: string;
  versionGranularity: Granularity;
  /** 'none': a missing policy rule is Not verified. 'allow': the owner set an explicit default. */
  defaultPolicy: 'none' | 'allow';
  catalogRevision: number;
}

export interface Environment {
  id: number;
  toolId: number;
  name: string;
  provider: 'assets' | 'registry';
  providerRef: string | null;
  ownerAccountId: string;
  /** null: everyone may pick it. Otherwise only members of this group. */
  audienceGroup: string | null;
  lastSeenVersion: string | null;
  lastSeenAt: string | null;
  /** Registry environments only: the owner's recorded values, as stored (validated by the registry provider). */
  recordedValues: unknown;
}

/** Which policy actions, readiness keys and access a capability needs. null = not recorded (Not verified). */
export interface CapabilityLink {
  capabilityKey: string;
  actions: string[] | null;
  readinessKeys: string[] | null;
}

export interface Catalog {
  revision: number;
  keys: Map<string, CatalogKey>;
  links: Map<string, CapabilityLink>;
  examples: WorkedExample[];
}

/** Shared by facts and rules: the scope that decides which row is most specific. */
export interface Scoped {
  id: number;
  environmentId: number | null;
  audienceGroup: string | null;
  status: 'active' | 'retired';
}

export interface FactRow extends Scoped {
  toolId: number;
  factKey: string;
  versionSensitive: boolean;
}

export interface FactVersionRow {
  id: number;
  factId: number;
  version: string;
  /** Parsed `value_json`: true/false for 'has' keys, a number for gte/lte keys, a string or number for eq. */
  value: unknown;
  quote: string | null;
  verifiedBy: string;
  verifiedAt: string;
  status: 'active' | 'retired';
}

export type Effect = 'allow' | 'deny' | 'approval';

export interface RuleRow extends Scoped {
  toolId: number;
  actionKey: string;
  effect: Effect;
  approvalRoute: string | null;
  reason: string | null;
  revision: number;
  /** Approval rules only: how many days an approval counts after it was decided. Null or absent: it doesn't lapse. */
  approvalDays?: number | null;
}

export interface ReadinessKeyRow {
  id: number;
  toolId: number;
  key: string;
  providerAttribute: string;
  match: 'has' | 'eq' | 'gte';
  expected: string;
  label: string;
  fixRoute: string | null;
}

export interface AccessMappingRow {
  id: number;
  toolId: number;
  environmentId: number;
  actionKey: string;
  /** null: the owner records that no access is needed. */
  groupName: string | null;
  grants: string | null;
  source: 'idp_synced' | 'manual';
  attestedBy: string;
  attestedAt: string;
  grantRoute: string | null;
}

export interface ApprovalGrantRow {
  id: number;
  askerAccountId: string;
  toolId: number;
  environmentId: number;
  actionKey: string;
  requestKey: string;
  status: 'pending' | 'approved' | 'declined';
  decidedAt: string | null;
}

/** Group membership as read at answer time. `ok: false` means it couldn't be read. */
export type Groups = { ok: true; names: string[] } | { ok: false; reason?: string };

/**
 * What a provider returns for one environment. `values` holds every attribute the record defines, with an
 * empty list when it has no value; an attribute that doesn't exist is left out (absent ≠ empty, spec 11).
 */
export type EnvRead =
  | {
      ok: true;
      source: 'assets' | 'registry';
      values: Record<string, string[]>;
      version: string | null;
      readAt: string;
      /** When the record itself last changed, if the provider knows. */
      recordUpdatedAt: string | null;
    }
  | { ok: false; reason: 'unreachable' | 'not_found' | 'forbidden'; detail?: string };

// ---- Checks and results ------------------------------------------------------------------------------

export type Check =
  | { dimension: 'capability'; key: string; value?: number | string | boolean }
  | { dimension: 'unlinked'; key: string }
  | { dimension: 'policy'; action: string }
  | { dimension: 'access'; action: string }
  | { dimension: 'environment'; key: string };

export type CheckStatus = 'pass' | 'fail' | 'missing' | 'approval' | 'unknown';

/** What would settle a Not verified check (spec section 5, verdict rule 2). */
export type Settle = 'ask_owner' | 'recheck';

/** The evidence label on a result (spec section 5, "What each label proves"). Account ids, never names. */
export type Label =
  | { kind: 'owner_verified'; version: string; by: string; at: string; quote: string | null }
  | { kind: 'policy_rule'; ruleId: number; revision: number; effect: Effect; reason: string | null }
  | { kind: 'default_policy' }
  /** `until`: when the approval stops counting, if the rule limits it. */
  | { kind: 'approved'; requestKey: string; at: string | null; until?: string | null }
  | { kind: 'declined'; requestKey: string; at: string | null }
  /** An approval that counted once and has run out (or whose decision time can't be read): approval is needed again. */
  | { kind: 'approval_expired'; requestKey: string; expiredAt: string | null; ruleId: number; revision: number; reason: string | null }
  | { kind: 'assets_record'; attribute: string; readAt: string; changedAt: string | null }
  | { kind: 'recorded_by_owner'; attribute: string; readAt: string; changedAt: string | null }
  | { kind: 'mapped_access'; group: string; grants: string | null; source: 'idp_synced' | 'manual'; by: string }
  | { kind: 'no_access_needed'; by: string }
  | { kind: 'not_verified'; missing: string };

export interface CheckResult {
  check: Check;
  status: CheckStatus;
  label: Label;
  /** Not verified only: what would settle it. */
  settle?: Settle;
  /** Missing or approval: who or what fixes it (fix_route, approval_route, grant_route). */
  route?: string | null;
  /** Approval only: a request already raised for this person. */
  pending?: { requestKey: string } | null;
  /** Capability only: the fact version used, saved with the ask as evidence. */
  factVersionId?: number;
  /** Capability only: the owner's recorded value that was compared. */
  found?: unknown;
  /** Plain words for what was checked, when the stored row names it (a readiness key's label). */
  subject?: string;
  /** Missing only: what would make it pass, from the owner's records ('Build environments needs to include "frontend"'). */
  needs?: string;
}

export type Verdict = 'yes' | 'yes_with_approval' | 'not_ready' | 'no' | 'dont_know';

export type Outcome =
  | { verdict: 'no'; because: CheckResult[]; results: CheckResult[] }
  | { verdict: 'dont_know'; unknown: CheckResult[]; alsoMissing: CheckResult[]; results: CheckResult[] }
  | { verdict: 'not_ready'; fixes: CheckResult[]; next: CheckResult[]; results: CheckResult[] }
  | { verdict: 'yes_with_approval'; approvals: CheckResult[]; results: CheckResult[] }
  | { verdict: 'yes'; results: CheckResult[] };

// ---- What the engine reads (passed in; Forge SQL and providers implement these) -----------------------

export interface EngineRepo {
  facts(toolId: number, key: string): Promise<FactRow[]>;
  /** The active verification of this fact for exactly this (normalised) version. */
  activeVersion(factId: number, version: string): Promise<FactVersionRow | null>;
  /** The most recent active verification, any version. */
  latestVersion(factId: number): Promise<FactVersionRow | null>;
  /** Versions with an active verification, for the "verified on 13.2" message. */
  verifiedVersions(factId: number): Promise<string[]>;
  rules(toolId: number, action: string): Promise<RuleRow[]>;
  /** The newest grant for this person, tool, environment and action. */
  approvalGrant(asker: string, toolId: number, environmentId: number, action: string): Promise<ApprovalGrantRow | null>;
  readinessKey(toolId: number, key: string): Promise<ReadinessKeyRow | null>;
  accessMapping(toolId: number, environmentId: number, action: string): Promise<AccessMappingRow | null>;
}

export interface EnvironmentReader {
  read(environment: Environment): Promise<EnvRead>;
}

export type { CatalogChoice, CatalogKey };

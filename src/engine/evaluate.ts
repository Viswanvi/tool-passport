import type {
  Catalog,
  CatalogKey,
  Check,
  CheckResult,
  EngineRepo,
  Environment,
  EnvironmentReader,
  EnvRead,
  FactVersionRow,
  Groups,
  Label,
  Outcome,
  ReadinessKeyRow,
  Settle,
  Tool,
} from './model';
import { knownGroups, mostSpecific } from './select';
import { combine } from './verdict';
import { normaliseVersion } from './version';

/**
 * The four checks plus `unlinked` (spec section 11, `evaluate`), failing safe: every missing input is Not
 * verified (spec section 5, list 1-8), never a pass and never a fail. Comparisons come from the catalog,
 * never from the model. A read that throws becomes Not verified with Re-check, so no outage becomes a Yes.
 */

export interface EvalContext {
  tool: Tool;
  environment: Environment | null;
  asker: string;
  groups: Groups;
  catalog: Catalog;
}

export interface EvalDeps {
  repo: EngineRepo;
  environments: EnvironmentReader;
  /** Version bookkeeping (change/detect.ts). Answers never depend on it: versions are compared at read time. */
  noteVersion?: (environment: Environment, observed: string | null) => Promise<unknown>;
}

interface Ctx extends EvalContext {
  env: EnvRead | null;
  repo: EngineRepo;
}

export async function evaluate(checks: Check[], ctx: EvalContext, deps: EvalDeps): Promise<Outcome> {
  const env = ctx.environment ? await readEnvironment(ctx.environment, deps.environments) : null;
  if (env?.ok && ctx.environment && deps.noteVersion) {
    try {
      await deps.noteVersion(ctx.environment, env.version);
    } catch {
      // Bookkeeping only; the sweep notices the version on its next run.
    }
  }
  const x: Ctx = { ...ctx, env, repo: deps.repo };
  const results: CheckResult[] = [];
  for (const c of checks) results.push(await runCheck(c, x));
  return combine(results);
}

async function readEnvironment(environment: Environment, reader: EnvironmentReader): Promise<EnvRead> {
  try {
    return await reader.read(environment);
  } catch (e) {
    return { ok: false, reason: 'unreachable', detail: String(e).slice(0, 200) };
  }
}

async function runCheck(c: Check, x: Ctx): Promise<CheckResult> {
  try {
    switch (c.dimension) {
      case 'unlinked':
        return notVerified(c, 'Requirements for this capability are not recorded', 'ask_owner');
      case 'capability':
        return await capability(c, x);
      case 'policy':
        return await policy(c, x);
      case 'environment':
        return await readiness(c, x);
      case 'access':
        return await access(c, x);
    }
  } catch {
    return notVerified(c, 'A stored record could not be read just now', 'recheck');
  }
}

// ---- results ------------------------------------------------------------------------------------------

function notVerified(check: Check, missing: string, settle: Settle): CheckResult {
  return { check, status: 'unknown', label: { kind: 'not_verified', missing }, settle };
}

function result(check: Check, status: 'pass' | 'fail', label: Label, extra: Partial<CheckResult> = {}): CheckResult {
  return { check, status, label, ...extra };
}

/** Not verified because the environment's record couldn't be read; what settles it depends on why. */
function envNotRead(c: Check, env: EnvRead | null, environment: Environment, what: string): CheckResult {
  const reason = env && !env.ok ? env.reason : 'unreachable';
  if (reason === 'not_found') return notVerified(c, `The record for ${environment.name} was not found`, 'ask_owner');
  if (reason === 'forbidden') return notVerified(c, `The app is not allowed to read the record for ${environment.name}`, 'ask_owner');
  return notVerified(c, `${what} could not be read just now`, 'recheck');
}

const noEnvironment = (c: Check) => notVerified(c, 'This check needs an environment', 'ask_owner');

// ---- capability: "Can it" -----------------------------------------------------------------------------

async function capability(c: Extract<Check, { dimension: 'capability' }>, x: Ctx): Promise<CheckResult> {
  const key = x.catalog.keys.get(c.key);
  if (!key) return notVerified(c, 'This key is no longer in the catalog', 'ask_owner');
  const pick = mostSpecific(await x.repo.facts(x.tool.id, c.key), x.environment?.id ?? null, x.groups);
  if ('unknown' in pick) return notVerified(c, pick.unknown, pick.why === 'groups' ? 'recheck' : 'ask_owner');
  const fact = pick.row;
  if (!fact) return notVerified(c, 'No verified answer yet', 'ask_owner');

  if (!x.environment) {
    const latest = await x.repo.latestVersion(fact.id);
    return latest ? judge(latest, key, c) : notVerified(c, 'No verified answer yet', 'ask_owner');
  }
  if (!x.env || !x.env.ok) return envNotRead(c, x.env, x.environment, `The version of ${x.environment.name}`);
  if (!fact.versionSensitive) {
    const latest = await x.repo.latestVersion(fact.id);
    return latest ? judge(latest, key, c) : notVerified(c, 'No verified answer yet', 'ask_owner');
  }
  const wanted = normaliseVersion(x.env.version, x.tool.versionGranularity);
  if (!wanted) return notVerified(c, `The version of ${x.environment.name} could not be read from its record`, 'ask_owner');
  const fv = await x.repo.activeVersion(fact.id, wanted);
  if (!fv) {
    const versions = await x.repo.verifiedVersions(fact.id);
    const on = versions.length ? `Verified on ${versions.join(', ')}` : 'Not verified on any version';
    return notVerified(c, `${on}; ${x.environment.name} runs ${wanted}`, 'ask_owner');
  }
  return judge(fv, key, c);
}

function judge(fv: FactVersionRow, key: CatalogKey, c: Extract<Check, { dimension: 'capability' }>): CheckResult {
  const outcome = compare(key, fv.value, c.value);
  if (outcome === 'bad_stored') return notVerified(c, `The recorded answer for "${key.label}" can't be compared`, 'ask_owner');
  if (outcome === 'bad_asked') return notVerified(c, `The question didn't give a usable value for "${key.label}"`, 'ask_owner');
  const label: Label = { kind: 'owner_verified', version: fv.version, by: fv.verifiedBy, at: fv.verifiedAt, quote: fv.quote };
  return result(c, outcome ? 'pass' : 'fail', label, { factVersionId: fv.id, found: fv.value });
}

/**
 * The catalog's comparison applied to the owner's stored value and the asked value. `gte`: the tool's
 * recorded limit must be at least what was asked (limit 2 GB, asked 3 GB → fail); `lte` the reverse.
 * Anything of the wrong type is not compared at all.
 */
export function compare(key: CatalogKey, stored: unknown, asked: unknown): boolean | 'bad_stored' | 'bad_asked' {
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  switch (key.comparison) {
    case 'has':
      return typeof stored === 'boolean' ? stored : 'bad_stored';
    case 'gte':
    case 'lte':
      if (!isNum(stored)) return 'bad_stored';
      if (!isNum(asked)) return 'bad_asked';
      return key.comparison === 'gte' ? stored >= asked : stored <= asked;
    case 'eq':
      if (asked === undefined || asked === null) return 'bad_asked';
      if (key.valueType === 'number') {
        if (!isNum(stored)) return 'bad_stored';
        return isNum(asked) ? stored === asked : 'bad_asked';
      }
      if (key.valueType === 'boolean') {
        if (typeof stored !== 'boolean') return 'bad_stored';
        return typeof asked === 'boolean' ? stored === asked : 'bad_asked';
      }
      if (typeof stored !== 'string') return 'bad_stored';
      return typeof asked === 'string' ? norm(stored) === norm(asked) : 'bad_asked';
    default:
      return 'bad_stored';
  }
}

const norm = (s: string) => s.trim().toLowerCase();

// ---- policy: "Allowed" --------------------------------------------------------------------------------

async function policy(c: Extract<Check, { dimension: 'policy' }>, x: Ctx): Promise<CheckResult> {
  if (!x.environment) return noEnvironment(c);
  const pick = mostSpecific(await x.repo.rules(x.tool.id, c.action), x.environment.id, x.groups);
  if ('unknown' in pick) return notVerified(c, pick.unknown, pick.why === 'groups' ? 'recheck' : 'ask_owner');
  const rule = pick.row;
  if (!rule) {
    if (x.tool.defaultPolicy === 'allow') return result(c, 'pass', { kind: 'default_policy' });
    return notVerified(c, 'No policy recorded for this action', 'ask_owner');
  }
  const label: Label = { kind: 'policy_rule', ruleId: rule.id, revision: rule.revision, effect: rule.effect, reason: rule.reason };
  switch (rule.effect) {
    case 'deny':
      return result(c, 'fail', label);
    case 'allow':
      return result(c, 'pass', label);
    case 'approval': {
      const grant = await x.repo.approvalGrant(x.asker, x.tool.id, x.environment.id, c.action);
      if (grant?.status === 'approved') return result(c, 'pass', { kind: 'approved', requestKey: grant.requestKey, at: grant.decidedAt });
      if (grant?.status === 'declined') return result(c, 'fail', { kind: 'declined', requestKey: grant.requestKey, at: grant.decidedAt });
      return { check: c, status: 'approval', label, route: rule.approvalRoute, pending: grant ? { requestKey: grant.requestKey } : null };
    }
    default:
      // effect is a VARCHAR in Forge SQL (D11); an unknown value must not be read as allow.
      return notVerified(c, 'The policy rule for this action is not readable', 'ask_owner');
  }
}

// ---- environment: "Ready" -----------------------------------------------------------------------------

async function readiness(c: Extract<Check, { dimension: 'environment' }>, x: Ctx): Promise<CheckResult> {
  if (!x.environment) return noEnvironment(c);
  if (!x.env || !x.env.ok) return envNotRead(c, x.env, x.environment, `The record for ${x.environment.name}`);
  const rk = await x.repo.readinessKey(x.tool.id, c.key);
  if (!rk) return notVerified(c, 'No setting recorded for this requirement', 'ask_owner');
  const named = (r: CheckResult): CheckResult => ({ ...r, subject: rk.label });
  // Absent is not the same as empty: the provider leaves out only attributes that don't exist.
  if (!Object.hasOwn(x.env.values, rk.providerAttribute)) {
    return named(notVerified(c, `${rk.providerAttribute} not found for ${x.environment.name}`, 'ask_owner'));
  }
  const values = x.env.values[rk.providerAttribute];
  const label: Label =
    x.env.source === 'assets'
      ? { kind: 'assets_record', attribute: rk.providerAttribute, readAt: x.env.readAt, changedAt: x.env.recordUpdatedAt }
      : { kind: 'recorded_by_owner', attribute: rk.providerAttribute, readAt: x.env.readAt, changedAt: x.env.recordUpdatedAt };
  const m = matches(values, rk);
  if (m === 'unreadable') return named(notVerified(c, `${rk.providerAttribute} for ${x.environment.name} can't be compared with "${rk.expected}"`, 'ask_owner'));
  return named(m ? result(c, 'pass', label) : { check: c, status: 'missing', label, route: rk.fixRoute, needs: needsText(rk) });
}

/** What the owner's readiness key asks for, in words for the fix request. */
function needsText(rk: Pick<ReadinessKeyRow, 'providerAttribute' | 'match' | 'expected'>): string {
  if (rk.match === 'has') return `${rk.providerAttribute} needs to include "${rk.expected}"`;
  if (rk.match === 'eq') return `${rk.providerAttribute} needs to be "${rk.expected}"`;
  return `${rk.providerAttribute} needs to be at least ${rk.expected}`;
}

export function matches(values: unknown, rk: Pick<ReadinessKeyRow, 'match' | 'expected'>): boolean | 'unreadable' {
  if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) return 'unreadable';
  const list = values as string[];
  switch (rk.match) {
    case 'has':
      return list.some((v) => norm(v) === norm(rk.expected));
    case 'eq':
      return list.length === 1 && norm(list[0]!) === norm(rk.expected);
    case 'gte': {
      const expected = Number(rk.expected);
      if (!Number.isFinite(expected)) return 'unreadable';
      if (list.length === 0) return false;
      if (list.length > 1) return 'unreadable';
      const n = Number(list[0]!.trim());
      return Number.isFinite(n) && list[0]!.trim() !== '' ? n >= expected : 'unreadable';
    }
    default:
      return 'unreadable';
  }
}

// ---- access: "Mapped access" --------------------------------------------------------------------------

async function access(c: Extract<Check, { dimension: 'access' }>, x: Ctx): Promise<CheckResult> {
  if (!x.environment) return noEnvironment(c);
  const m = await x.repo.accessMapping(x.tool.id, x.environment.id, c.action);
  if (!m) return notVerified(c, 'No access mapping recorded', 'ask_owner');
  // The owner's explicit "no access needed" is the only way to pass without a group.
  if (m.groupName == null) return result(c, 'pass', { kind: 'no_access_needed', by: m.attestedBy });
  const names = knownGroups(x.groups);
  if (names === null) return notVerified(c, 'Group membership could not be read', 'recheck');
  const label: Label = { kind: 'mapped_access', group: m.groupName, grants: m.grants, source: m.source, by: m.attestedBy };
  return names.includes(m.groupName)
    ? result(c, 'pass', label)
    : { check: c, status: 'missing', label, route: m.grantRoute, needs: `membership of ${m.groupName}${m.grants ? `, which gives ${m.grants}` : ''}` };
}

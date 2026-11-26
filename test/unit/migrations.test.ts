import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/sql', () => ({ migrationRunner: { enqueue: vi.fn(), run: vi.fn() }, sql: {} }));

const { MIGRATIONS, RETIRED_MIGRATIONS, RUNNER_DDL, SPEC_TABLES } = await import('../../src/db/migrations');

const tableOf = (ddl: string) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(ddl)?.[1];

describe('Forge SQL migrations', () => {
  it('creates every table named in spec section 10', () => {
    const created = MIGRATIONS.map((m) => tableOf(m.ddl));
    for (const t of SPEC_TABLES) expect(created).toContain(t);
  });

  it('only uses idempotent statements (no transactions in Forge SQL)', () => {
    for (const m of MIGRATIONS) {
      expect(m.ddl.trimStart()).toMatch(/^(CREATE TABLE IF NOT EXISTS|DROP TABLE IF EXISTS|ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS|CREATE UNIQUE INDEX IF NOT EXISTS) /);
    }
  });

  it('never creates the Phase 0 experiment log and never reuses a retired name', () => {
    expect(MIGRATIONS.map((m) => tableOf(m.ddl))).not.toContain('experiment_runs');
    const names = MIGRATIONS.map((m) => m.name);
    for (const retired of RETIRED_MIGRATIONS) {
      expect(names).not.toContain(retired);
      // A new name never shares a retired one's number either.
      expect(names.map((n) => n.slice(0, 4))).not.toContain(retired.slice(0, 4));
    }
  });

  it('creates on a new installation what the retired migrations added on older ones (D54)', () => {
    const ddl = (t: string) => MIGRATIONS.find((m) => tableOf(m.ddl) === t)?.ddl ?? '';
    expect(ddl('catalog_keys')).toMatch(/\bunit VARCHAR\(128\) NULL,/);
    expect(ddl('rules')).toMatch(/\bscope_key VARCHAR\(512\) NULL,/);
    expect(ddl('rules')).toMatch(/UNIQUE KEY one_rule_per_scope \(scope_key\)/);
    expect(ddl('requests')).toMatch(/\bportal_url VARCHAR\(512\) NULL,/);
    // v025 adds the same column to older installations; on a new one it is already there.
    expect(ddl('rules')).toMatch(/\bapproval_days INT NULL,/);
    expect(MIGRATIONS.find((m) => m.name === 'v025_rules_approval_days')?.ddl).toBe('ALTER TABLE rules ADD COLUMN IF NOT EXISTS approval_days INT NULL');
  });

  it('has unique, ordered, permanent migration names', () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
    for (const n of names) expect(n).toMatch(/^v\d{3}_[a-z_]+$/);
  });

  it('stays under the Forge SQL limit of 25 DDL requests per minute, with room for a second run that minute', () => {
    // A fresh install's first run spends one request per migration plus the runner's own two; Load demo data right
    // after runs the runner again (two more). Limit: developer.atlassian.com/platform/forge/limits-sql/.
    expect(MIGRATIONS.length + RUNNER_DDL + RUNNER_DDL).toBeLessThanOrEqual(25);
  });

  it('never uses foreign keys (unsupported) or the reserved column names key and match', () => {
    for (const m of MIGRATIONS) {
      expect(m.ddl).not.toMatch(/FOREIGN KEY|REFERENCES/i);
      expect(m.ddl).not.toMatch(/^\s+(key|match)\s+VARCHAR/im);
    }
  });

  it('spells nullable scopes out in facts.scope_key so uniqueness cannot be bypassed by NULLs', () => {
    const facts = MIGRATIONS.find((m) => tableOf(m.ddl) === 'facts');
    expect(facts?.ddl).toMatch(/UNIQUE KEY one_fact_per_scope \(scope_key\)/);
  });

  it('keys version changes to a baseline so detection is safe to repeat', () => {
    const changes = MIGRATIONS.find((m) => tableOf(m.ddl) === 'changes');
    expect(changes?.ddl).toMatch(/UNIQUE KEY one_change \(environment_id, baseline_at, to_version\)/);
  });
});

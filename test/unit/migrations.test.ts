import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/sql', () => ({ migrationRunner: { enqueue: vi.fn(), run: vi.fn() }, sql: {} }));

const { MIGRATIONS, SPEC_TABLES } = await import('../../src/db/migrations');

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

  it('never creates the Phase 0 experiment log, and drops it where it exists', () => {
    expect(MIGRATIONS.map((m) => tableOf(m.ddl))).not.toContain('experiment_runs');
    expect(MIGRATIONS.some((m) => m.ddl === 'DROP TABLE IF EXISTS experiment_runs')).toBe(true);
    expect(MIGRATIONS.map((m) => m.name)).not.toContain('v019_experiment_runs');
  });

  it('has unique, ordered, permanent migration names', () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
    for (const n of names) expect(n).toMatch(/^v\d{3}_[a-z_]+$/);
  });

  it('stays under the Forge SQL DDL limit of 25 statements per minute', () => {
    expect(MIGRATIONS.length).toBeLessThan(25);
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

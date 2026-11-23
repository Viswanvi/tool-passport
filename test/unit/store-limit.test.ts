import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/sql', () => ({ sql: {} }));

const { limitClause, fromJsonColumn } = await import('../../src/db/store');

describe('fromJsonColumn (Forge SQL returns JSON columns parsed, docs say strings)', () => {
  it('accepts an already-parsed object', () => {
    expect(fromJsonColumn({ a: 1 })).toEqual({ a: 1 });
  });
  it('parses a JSON string', () => {
    expect(fromJsonColumn('{"a":1}')).toEqual({ a: 1 });
  });
  it('a JSON string value that arrives already parsed is returned as that string (seen on Forge SQL)', () => {
    expect(fromJsonColumn('e814c5c1-5d62-496f-9b4c-78c6d67a7401')).toBe('e814c5c1-5d62-496f-9b4c-78c6d67a7401');
    expect(fromJsonColumn('"quoted"')).toBe('quoted');
  });
  it('maps null and undefined to null', () => {
    expect(fromJsonColumn(null)).toBeNull();
    expect(fromJsonColumn(undefined)).toBeNull();
  });
});

describe('limitClause (Forge SQL rejects a bound LIMIT parameter)', () => {
  it('inlines a whole number', () => {
    expect(limitClause(30)).toBe('LIMIT 30');
  });

  it('clamps to 1..1000 and truncates fractions', () => {
    expect(limitClause(0)).toBe('LIMIT 1');
    expect(limitClause(-5)).toBe('LIMIT 1');
    expect(limitClause(5000)).toBe('LIMIT 1000');
    expect(limitClause(7.9)).toBe('LIMIT 7');
  });

  it('never lets anything but digits through', () => {
    expect(limitClause(Number('1; DROP TABLE tools'))).toBe('LIMIT 1');
    expect(limitClause(NaN)).toBe('LIMIT 1');
  });
});

/**
 * The checks the false-Yes cases make, without a test framework, so the same cases run in the build (vitest)
 * and in the app (Setup → Tests). Each throws an Error naming what differed; `like` follows vitest's
 * toMatchObject: every expected field must be present and match, lists must have the same length.
 */

const show = (v: unknown): string => (v === undefined ? 'undefined' : JSON.stringify(v) ?? String(v));

export function ok(condition: boolean, what: string): void {
  if (!condition) throw new Error(what);
}

export function same(actual: unknown, expected: unknown, what: string): void {
  if (!Object.is(actual, expected)) throw new Error(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}

function mismatch(actual: unknown, expected: unknown, path: string): string | null {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: expected a list, got ${show(actual)}`;
    if (actual.length !== expected.length) return `${path}: expected ${expected.length} items, got ${actual.length}`;
    for (let i = 0; i < expected.length; i++) {
      const m = mismatch(actual[i], expected[i], `${path}[${i}]`);
      if (m) return m;
    }
    return null;
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return `${path}: expected an object, got ${show(actual)}`;
    for (const [key, value] of Object.entries(expected)) {
      if (!(key in actual)) return `${path}.${key}: missing`;
      const m = mismatch((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
      if (m) return m;
    }
    return null;
  }
  return Object.is(actual, expected) ? null : `${path}: expected ${show(expected)}, got ${show(actual)}`;
}

export function like(actual: unknown, expected: unknown, what: string): void {
  const m = mismatch(actual, expected, what);
  if (m) throw new Error(m);
}

export function throws(fn: () => unknown, what: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${what}: expected it to refuse, but it returned`);
}

export function includes(text: string, part: string, what: string): void {
  if (!text.includes(part)) throw new Error(`${what}: expected ${show(text)} to contain ${show(part)}`);
}

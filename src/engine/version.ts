/** Version normalisation at the tool's granularity (spec sections 10 and 16: 13.2.1 counts as 13.2 at minor). */

export type Granularity = 'major' | 'minor' | 'exact';

/** "13.2.1" → "13.2" at minor granularity. Anything without a leading number is not a version (null). */
export function normaliseVersion(observed: string | null | undefined, granularity: Granularity): string | null {
  if (observed === null || observed === undefined) return null;
  const v = observed.trim().replace(/^v(?=\d)/i, '');
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  if (!m) return null;
  if (granularity === 'major') return m[1] ?? null;
  if (granularity === 'minor') return `${m[1]}.${m[2] ?? '0'}`;
  return v;
}

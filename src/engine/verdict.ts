import type { CheckResult, Outcome } from './model';

/**
 * The five verdict rules (spec section 5), applied in this order: any fail → No; anything not verified →
 * Don't know yet (missing items listed under it); anything missing → Not ready (approvals listed next); an
 * approval needed → Yes, with approval; otherwise Yes.
 */
export function combine(results: CheckResult[]): Outcome {
  // A Yes needs at least one check that passed; an empty list would otherwise fall through to Yes.
  if (results.length === 0) throw new Error('combine() needs at least one check');
  const of = (s: CheckResult['status']) => results.filter((r) => r.status === s);
  if (of('fail').length) return { verdict: 'no', because: of('fail'), results };
  if (of('unknown').length) return { verdict: 'dont_know', unknown: of('unknown'), alsoMissing: of('missing'), results };
  if (of('missing').length) return { verdict: 'not_ready', fixes: of('missing'), next: of('approval'), results };
  if (of('approval').length) return { verdict: 'yes_with_approval', approvals: of('approval'), results };
  // Defensive: every status above is handled, so anything left must be a pass to say Yes.
  if (!results.every((r) => r.status === 'pass')) throw new Error('combine() got an unknown status');
  return { verdict: 'yes', results };
}

import type { CatalogChoice } from './catalog';
import type { Catalog, Check, Environment } from './model';

/**
 * Picking the checks (spec section 11, `expand`). Code, not the model, decides which checks run: every
 * capability gets its capability check, and with an environment chosen, the policy, access and readiness
 * checks its recorded links name. A link that isn't recorded becomes an `unlinked` check (Not verified).
 */
export function expand(requirement: CatalogChoice[], catalog: Catalog, environment: Environment | null): Check[] {
  const checks: Check[] = [];
  for (const cap of requirement) {
    checks.push(cap.value === undefined ? { dimension: 'capability', key: cap.key } : { dimension: 'capability', key: cap.key, value: cap.value });
    if (!environment) continue; // "Any environment": capability only, and the card says the rest wasn't checked
    const link = catalog.links.get(cap.key);
    if (!link || link.actions == null || link.readinessKeys == null) {
      checks.push({ dimension: 'unlinked', key: cap.key });
      continue;
    }
    for (const action of link.actions) checks.push({ dimension: 'policy', action }, { dimension: 'access', action });
    for (const key of link.readinessKeys) checks.push({ dimension: 'environment', key });
  }
  return dedupe(checks);
}

function checkId(c: Check): string {
  switch (c.dimension) {
    case 'capability':
      return `capability|${c.key}|${c.value === undefined ? '' : JSON.stringify(c.value)}`;
    case 'unlinked':
    case 'environment':
      return `${c.dimension}|${c.key}`;
    case 'policy':
    case 'access':
      return `${c.dimension}|${c.action}`;
  }
}

/** Two capabilities linked to the same action need its policy and access checked once. */
export function dedupe(checks: Check[]): Check[] {
  const seen = new Set<string>();
  return checks.filter((c) => {
    const id = checkId(c);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

import type { QuickPlan, QuickSetupReply } from '../resolvers/quick-setup';

/**
 * What one-click setup built, in words (D61): read from the server's own reply, the counts the demo load wrote and
 * the steps it saved, so the Setup page shows what is now on this site rather than a promise. No Forge imports.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function builtLines(reply: Extract<QuickSetupReply, { ok: true }>, plan: QuickPlan | null): string[] {
  const lines: string[] = [];
  const seed = reply.seed?.ok ? reply.seed : null;
  if (seed) {
    const c = seed.counts;
    const n = (k: string) => c[k] ?? 0;
    const envs = seed.environments.map((e) => e.name).join(' and ');
    const inAssets = seed.environments.every((e) => e.providerRef !== 'Recorded by owner');
    lines.push(
      inAssets
        ? `Assets: ${envs} as records in the Tool Passport Environments schema (${seed.environments.map((e) => e.providerRef).join(', ')})${n('assetsRecordsCreated') ? ', made now' : ''}. Version, setup and features are read from there on every check.`
        : `${envs}: their version, setup and features recorded by you, the owner (registry mode, no Assets).`,
    );
    lines.push(`Kestrel Studio, with you as its owner: ${plural(n('catalogKeys'), 'catalog entry', 'catalog entries')}, the only words the AI may map a question to.`);
    lines.push(`${plural(n('links'), 'capability', 'capabilities')} linked to the checks that decide them.`);
    lines.push(`${plural(n('facts'), 'verified fact')}, each tied to the tool version it was checked on.`);
    lines.push(`${plural(n('rules'), 'policy rule')}, ${plural(n('readinessKeys'), 'setup check')} and ${plural(n('accessMappings'), 'access mapping')}.`);
    if (!seed.warnings?.length) {
      lines.push(
        n('groupsCreated')
          ? `${plural(n('groupsCreated'), 'group')} made (kestrel-dev-builders, kestrel-prod-deployers)${n('addedToGroup') ? ', and you joined kestrel-dev-builders' : ''}.`
          : `Groups kestrel-dev-builders and kestrel-prod-deployers in place${n('addedToGroup') ? '; you joined kestrel-dev-builders' : ''}.`,
      );
    }
  }
  if (reply.did.includes('requests') && plan?.requests.desk) lines.push(`Requests: fixes, approvals and questions go to ${plan.requests.desk} as “${plan.requests.requestType}”, private to the asker.`);
  if (reply.did.includes('approvals') && plan?.approvals.approve.length) lines.push(`Approvals: resolution “${plan.approvals.approve.join('” or “')}” approves; anything else leaves the approval pending.`);
  if (reply.did.includes('helpCenter')) lines.push('Help center: “Can I…?” is on for signed-in people.');
  return lines;
}

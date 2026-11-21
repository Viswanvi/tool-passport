import Resolver from '@forge/resolver';

/**
 * UI resolvers. Identity always comes from the Forge context (req.context.accountId), never the
 * payload (CLAUDE.md rule 3). Phase 1 adds ask, re-check and the owner's edits.
 */
const resolver = new Resolver();

resolver.define('health', async () => ({ ok: true }));

export const uiResolver = resolver.getDefinitions();

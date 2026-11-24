import { listEnvironments, listTools } from '../db/repo';
import { loopDeps } from '../loop/forge';
import { askDeps } from '../resolvers';
import { rovoAskOwner, rovoCheck, type RovoDeps } from './actions';

/**
 * Forge handlers for the two Rovo actions in manifest.yml. Forge calls each with (payload, context): the
 * action's inputs, and the invocation context whose `principal.accountId` is the person talking to the agent.
 * The logic, and the identity rule, live in actions.ts.
 */

const deps: RovoDeps = { ask: askDeps, listTools, listEnvironments, loop: loopDeps };

export const rovoCheckReadiness = (payload: unknown, context: unknown) => rovoCheck(payload, context, deps);

export const rovoAskToolOwner = (payload: unknown, context: unknown) => rovoAskOwner(payload, context, deps);

import { describe, it } from 'vitest';
import { SAFETY_CASES } from '../../src/safety/cases';

/**
 * The false-Yes suite (spec section 19; CLAUDE.md rule 1). The cases live in src/safety/cases.ts so that the
 * build runs exactly the list Setup → Tests runs in the app. Every case removes one input from a world where
 * the answer is Yes and must then end in something other than Yes or Yes, with approval; see that file for the
 * two cases with a different bar (D28).
 */

describe('false-Yes suite', () => {
  for (const c of SAFETY_CASES) it(`${c.group} · ${c.title}`, () => c.run());
});

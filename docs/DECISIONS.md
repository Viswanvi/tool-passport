# Decisions and deviations from the spec

Every deviation from `docs/tool-passport-v2.1.md`, with the reason and the evidence. Newest last.

| # | Date | Decision | Reason | Evidence / approved by |
| --- | --- | --- | --- | --- |
| D1 | 2026-11-20 | TypeScript (strict) instead of the spec's `.js` file names; `test/safety/false-yes.test.ts`, `seed/demo.ts`, etc. | `CLAUDE.md` tech choices | Kickoff review item E, approved |
| D2 | 2026-11-20 | Read every "Nov 19" in the spec as Nov 23 (Assets decision). Phase 1 still starts Nov 24 | Setup finished Nov 20 | `CLAUDE.md` schedule note; kickoff item F |
| D3 | 2026-11-20 | `ENVIRONMENT.md` note corrected: the app-side Assets read is E1, not E5 | Spec section 7 numbering | Kickoff item G, approved |
| D4 | 2026-11-20 | E1 creates the *Tool Passport Environments* schema and KS-DEV / KS-PROD objects through the Assets API as the app, instead of the Phase 4 wizard or by hand. If writes fail, the human creates them by hand | E1 needs a fictional schema now; this also answers cut rule 1 ("do writes work?") | Kickoff item H, approved |
| D5 | 2026-11-20 | `rovo:agent` and `action` stay out of the manifest until Phase 2. `llm` and every P0 scope go into the first Phase 0 deploy | Rovo is P1 (E8 is Phase 2). Adding `llm` forces a major version upgrade that an admin approves, so do it once, early, on the dev site | Forge docs, llm module page ("will trigger a major version upgrade"); kickoff item I |
| D6 | 2026-11-20 | E4 in Phase 0 is a pilot: draft catalog (~25 keys) + 20 questions + forced error, empty and unsupported cases. Full 40-question set in Phase 2. E4 runs last; no LLM call (including `list()`) until the human approves the cost | The set is written in Phases 1-2; no payment method on the Developer Space yet | Kickoff item C and approval note 3 |
| D7 | 2026-11-20 | E8 moves to Phase 2 (decision Dec 7); E9 moves to Phase 4 | E8 needs the Rovo action, E9 the full judge path | Kickoff item D, approved |
| D8 | 2026-11-20 | `@forge/react` and `@forge/bridge` pinned to stable releases instead of the `-next` prereleases `forge create` installed | Prerelease packages shouldn't ship to judges | Kickoff item L |
| D9 | 2026-11-20 | `.claude/skills/**/evals/` untracked and git-ignored; `check-prereqs.sh` skips `evals/fixtures` in the token scan | Forge skill test fixtures contain a fake Atlassian token; keep it off any remote | Approval note 4. Note: the root commit `6693b75` on `master` still contains those files |
| D10 | 2026-11-20 | `.claude/skills` content left otherwise unchanged and tracked | Project-local Forge skills are part of the dev setup | - |

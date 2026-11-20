# Status

"Verified" = ran it and saw it work, with the command and key output below. Everything else is "untested".

## Phase 0 (scaffold and experiments), started 2026-11-20

### Works (verified)

- `bash scripts/check-prereqs.sh` (Git Bash): `Result: 18 passed, 0 warnings, 0 failed` (DECISIONS D9).
- `npx tsc --noEmit` exit 0; `npx eslint "src/**/*.{ts,tsx}" "test/**/*.ts"` exit 0;
  `npx vitest run`: `Tests 16 passed (16)`.
- `forge lint`: no issues. `forge eligibility -e development`: 3.0.0 eligible for Runs on Atlassian; every later
  deploy (3.1.0-3.3.0) printed the same eligibility line.
- `forge install --upgrade --site one-atlas-oibs.atlassian.net --product jira -e development` (approved by the human):
  `Upgrade complete!`; `forge install list`: version 3, Up-to-date.
- Forge SQL: all 19 migrations applied by the upgrade event (`[lifecycle] migrations applied: v001_tools …
  v019_experiment_runs`, 18:32:40 UTC).
- Scheduled trigger: ticks at 18:36:00 and 18:41:00 UTC (E10 running).
- E1 as the admin, via the built-in browser signed in as the human: setup and reads; see `docs/experiments.md`.

### Not done / untested

- E1 for an employee without an Assets role (needs Sam). E5, E6 (need Sam). E2 (needs the fresh site).
- E10 two-hour verdict (window ends about 20:36 UTC).
- E3 "who changed it" (needs an edit to KS-DEV). Absent-vs-empty attributes in AQL replies.
- E4 (last; needs a payment method and the human's cost approval). E7 after the Assets decision.

### Next

- When Sam exists: Sam opens Apps → Tool Passport and clicks "E1 · Read as me" (user context and, on the next sweep,
  impersonation as a non-admin). Then E6 and E5.
- When the fresh developer site exists: E2, including the app-context read there (the docs say the app needs an
  Assets role; the demo site didn't require one).

### Waiting on the human

- Second account (Sam): Jira + JSM customer access only, no Assets role, not an agent on TPD.
- Free Atlassian Cloud developer site (E2, E8, E9, fresh-site checks).
- Payment method on the Developer Space, then cost approval, before any LLM call (E4).
- Before any push to a remote: the root commit `6693b75` still contains the skill eval fixtures (fake token);
  decide whether to rewrite it (DECISIONS D9).

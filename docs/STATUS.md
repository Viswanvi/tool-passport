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
- E10 PASS: `149 ticks, max gap 5 min, gaps over 10 min: 0` (2026-11-20 18:36 to 2026-11-21 06:56 UTC).
- E1 PASS on the demo site via the app context, including for Sam (no Assets role); user context and impersonation
  return 403 for Sam. Details and design implications in `docs/experiments.md`.
- Sam invited (Jira User only) and renamed "Sam" by the human; JSM Customer role added 2026-11-21 (needed for
  `raiseOnBehalfOf`); recorded in `docs/ENVIRONMENT.md`.
- `forge install --upgrade` to 4.0.0 (approved): `Upgrade complete!`, scopes `manage:servicedesk-customer`,
  `read:group:jira`, `write:group:jira` added.
- E6 PASS: groups for admin (89) and Sam (1) as the user, as the app, and from the sweep (app and impersonation).
- E5 raise: the app raised TPD-1 and TPD-2 for Sam (`Sam raised this request via API`) and assigned them to the admin;
  resolved TPD-1 as Done and TPD-2 as Declined in the browser as the admin.

### Not done / untested

- E5 PASS once events flowed (1-2 s); changes made under 4.0.0 (07:27-07:30) were never processed, unexplained.
- E2 (needs the fresh site), including the app-context Assets read there.
- Demo group creation: 401 "scope does not match" with `write:group:jira`; right scope set still unknown (Phase 4).
- E3 "who changed it" (needs an edit to KS-DEV). Absent-vs-empty attributes in AQL replies.
- E4 (last; needs a payment method and the human's cost approval). E7 after the Assets decision.

### Next

- E2 on the fresh developer site; then E4 last (pricing check and the human's cost approval before any LLM call);
  then STOP for the Assets decision (Nov 23).
- When the fresh developer site exists: E2, including the app-context read there (the docs say the app needs an
  Assets role; the demo site didn't require one).

### Waiting on the human

- Second account (Sam): Jira + JSM customer access only, no Assets role, not an agent on TPD.
- Free Atlassian Cloud developer site (E2, E8, E9, fresh-site checks).
- Payment method on the Developer Space, then cost approval, before any LLM call (E4).
- Before any push to a remote: the root commit `6693b75` still contains the skill eval fixtures (fake token);
  decide whether to rewrite it (DECISIONS D9).

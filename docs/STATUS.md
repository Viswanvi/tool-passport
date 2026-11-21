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
- E5 PASS once events flowed (1-2 s); changes made under 4.0.0 (07:27-07:30) were never processed, unexplained.
- Fresh free developer site `toolpassport.atlassian.net` created by the human (Cloud Standard developer bundle).
  `forge install --site toolpassport.atlassian.net --product jira -e development --confirm-scopes --non-interactive`
  (approved): `√ Install in Jira complete!`; status panel there: `Migrations: ok`.
- E2 PASS: Assets on by default (workspace 200, `/jira/assets` with "Create a schema", no upgrade prompt). As the app:
  schema, type, 4 attributes and 2 objects created (201), and the AQL read returned `ok: KS-DEV v13.2, KS-PROD v13.2`
  with no Assets role granted; the first sweep there (18:36:30, no user) logged `[E1] sweep:app ok: KS-DEV v13.2,
  KS-PROD v13.2`. The new site has 0 service desks.

- E4 pilot built, nothing run: `npx tsc` exit 0, eslint exit 0, `npx vitest run`: `Tests 38 passed (38)` (adds
  `e4-translate` and `e4-budget` tests with a fake model). `forge lint`: no issues. `forge deploy -e development`:
  4.2.0 deployed, "eligible for the Runs on Atlassian program". `@forge/llm` 1.0.10 pinned. The human approved up to $3
  of LLM spend and added a payment method.
- E4 PASS (pilot), app 4.3.0 (deploy: "eligible for the Runs on Atlassian program"): `list()` ok (11 models with
  credit pricing); `claude-sonnet-5-5` and `claude-haiku-5-5` each `answerableExact 20/20, unsupportedMarked 3/3,
  empty true, forcedError true, retries []`. Budget: `calls 49, inputTokens 90980, outputTokens 2465, usd 0.1292`.

### Not done / untested
- Demo group creation: 401 "scope does not match" with `write:group:jira`; right scope set still unknown (Phase 4).
- E3 "who changed it" (needs an edit to KS-DEV). Absent-vs-empty attributes in AQL replies.
- E4 (last; needs a payment method and the human's cost approval). E7 after the Assets decision.

- On the fresh site: a non-admin employee (not invited there, to keep it fresh).

### Next

- STOP: E1, E2, E4, E5 and E6 are done. The human decides the Assets read path (or registry-first) by Nov 23.
- After the decision: E7, finish E3 ("who changed it" after an edit), Phase 0 sign-off (remove the experiment panel
  and code, drop `experiment_runs`, lint, eligibility, decide on `allowImpersonation`).

### Waiting on the human

- The Assets decision (Nov 23).
- Before any push to a remote: the root commit `6693b75` still contains the skill eval fixtures (fake token);
  decide whether to rewrite it (DECISIONS D9).

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

- Assets decision taken by the human 2026-11-22: read Assets as the app (D25).
- E7 PASS (one row per transition), app 4.5.0: `npx vitest run` `Tests 45 passed (45)`; panel run on the demo site:
  9/9 checks (3 parallel detections → 1 row, crash → finished with no extra row, rollback and repeat upgrade → 1 row
  each). Rollback verdicts move to Phase 3.
- E3 PASS with the bonus: after editing KS-DEV's Version 13.2 → 13.2.1 as the admin, the app-context read (#432)
  returned 2 history entries with `affectedAttribute`, `oldValue`, `newValue` and `actor.key`; Version set back to 13.2.

### Phase 0 sign-off (2026-11-22, approved by the human: "Yes, clean up")

What changed (DECISIONS D27): `allowImpersonation` removed (scopes now a plain list); experiment panel, resolvers,
code and tests removed; `v020_drop_experiment_runs` added; reusable parts kept (`src/change/detect*.ts`,
`src/engine/translate.ts`, `src/engine/catalog.ts`, `src/seed/demo-catalog.ts`, `test/eval/questions.json`).

Results, verbatim:
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx eslint "src/**/*.{ts,tsx}" "test/**/*.ts"`: exit 0.
- `npx vitest run`: `Test Files 4 passed (4)`, `Tests 40 passed (40)` (migrations, store-limit, detect, translate).
  The false-Yes safety suite doesn't exist yet: it is Phase 1 step 1.
- `forge lint`: `No issues found.`
- `forge deploy -e development`: 4.6.0, then 4.7.0: "eligible for the Runs on Atlassian program". Removing
  `allowImpersonation` was a minor version, so no `forge install --upgrade` was needed; `forge install list`: both
  installs (demo site, toolpassport) version 4, `Up-to-date`.
- `forge eligibility -e development`: `The version of your app [4.7.0] that's deployed to [development] is eligible
  for the Runs on Atlassian program.`
- `bash scripts/check-prereqs.sh`: `Result: 18 passed, 0 warnings, 0 failed`.
- Demo site app page after the deploy: shows only the heading and the Phase 1 placeholder; the app's requests 200.
- First 4.7.0 sweep, both installations (`forge logs`, 2026-11-21 19:46:30-31 UTC):
  `[sweep] migrations applied: v020_drop_experiment_runs` and `[sweep] cleared Phase 0 experiment settings`, twice.

Security self-review against spec section 14 (what exists after Phase 0):

| Risk | Status now |
| --- | --- |
| False Yes from missing data | No verdict code exists yet. Phase 1 starts with the false-Yes suite |
| Non-owner writes | No write resolver exists (only `health`) |
| Request pretends to be someone else | No resolver accepts an account id; the removed E5 code took identity from the context only |
| Environment data shown to the wrong people | No read path is exposed. With D25 (read as the app), mapped attributes + passport schema + audience groups must be enforced in code in Phase 1 |
| Model infers permission | `translate` sends only the catalog, worked examples and the question; returns keys only (E4 injection cases passed). Injection cases go into the false-Yes suite |
| Approval nobody gave / question leaks | Not built (Phase 2) |
| App changes environments | No Assets write call remains in `src/` (path builders only); writes come back only in `setup/` and `seed/` |
| Data kept too long | Nothing about people is stored yet |
| Data leaves Atlassian | No `permissions.external`; `forge eligibility`: eligible |

### Not done / untested

- Demo group creation: 401 "scope does not match" with `write:group:jira`; right scope set still unknown (Phase 4).
- Absent-vs-empty attributes in AQL replies (before the Assets provider is built).
- On the fresh site: a non-admin employee (not invited there, to keep it fresh). That site now has the test schema
  and the dev app, so E9 (Phase 4) needs it cleaned or another fresh site.
- E5's unexplained window of missed issue events (07:27-07:30 on 2026-11-21): covered by the mandatory sweep re-check.

### Waiting on the human

- Before any push to a remote: the root commit `6693b75` still contains the skill eval fixtures (fake token);
  decide whether to rewrite it (DECISIONS D9).

## Phase 1 (answer engine and moment 1), started 2026-11-22 on branch `phase-1`

Started two days early at the human's request ("Start Phase1").

### Works (verified)

- Step 1, safety suite first: `test/safety/false-yes.test.ts` (all 13 spec cases, plus the audience control and
  "every Not verified says why"; 43 tests). Each case starts from a world where the answer is Yes, asserts that,
  then removes one input. Against stub engine modules: `Tests 42 failed | 1 passed (43)` (the one pass was the
  stub's throw on an empty list).
- Step 2, pure engine in `src/engine/` (no Forge imports: `@forge` matches in `src/engine/*.ts`: 0):
  `model.ts` (types), `version.ts` (normalise, moved from `change/detect.ts`), `select.ts` (`mostSpecific`,
  `knownGroups`), `expand.ts`, `evaluate.ts` (four checks plus `unlinked`), `verdict.ts` (`combine`),
  `audience.ts` (`canPick`), `answer.ts` (pipeline: audience → translate → expand → evaluate);
  `src/loop/resolution.ts` (`approvalOutcome`, unmapped never approves). Rules where the spec was silent: D28.
- `npx vitest run test/safety`: `Tests 43 passed (43)`.
- `npx vitest run`: `Test Files 7 passed (7)`, `Tests 121 passed (121)`. New: `test/unit/engine.test.ts`
  (`combine` every pairing and empty list, `mostSpecific`, `expand`, comparisons, `canPick`) and
  `test/unit/evaluate.test.ts` (the three demo moments end to end with a fake model: KS-DEV Not ready, KS-PROD No;
  fix → Yes, with approval → Yes; 3 GB No, KS-DEV on 14.0 Don't know yet while KS-PROD stays No, rollback restores).
- Mutation check: making an empty group list count as "in no groups" turned the suite red
  (`Tests 1 failed | 42 passed (43)`, case 3); restored, green again.
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx eslint "src/**/*.{ts,tsx}" "test/**/*.ts"`: exit 0.
  `forge lint`: `No issues found.`

### Not done / untested

- Nothing deployed: the engine isn't wired to a resolver yet, so nothing changed on either site.
- Steps 3-7: translation cache and model choice, providers (Assets as the app, registry, groups) and the SQL
  repository, Ask resolver + card + Ask page, guided fix loop, eval set to 20 (24 pilot questions exist).
- Demo seed (Phase 4) must add facts and links for the action keys `external_api_calls` and `external_sharing`,
  or those questions answer Don't know yet (D28 h).

### Next

- Step 3: translation cache (keyed by tool, catalog revision and question hash; no question text stored) and
  `llm/client.ts` model choice from `list()` with a preference list.

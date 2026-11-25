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
- Step 3, translation cache and model choice (D29), tests written first (red: `normaliseQuestion is not a
  function`, `Cannot find module '../../src/llm/model-choice'`):
  - `src/engine/translate.ts`: cache by tool, catalog revision and question hash; hits make no model call; a
    cached row is re-checked against the catalog; no question text or model wording stored.
  - `src/llm/model-choice.ts`: `chooseModel` (preference list from E4), `currentModel`, `modelChat` (switches
    once if the stored model has retired). `src/llm/client.ts` wires `@forge/llm` `list()`/`chat()` and
    `app_settings`; `src/db/translations-sql.ts` is the `translations` table store.
  - `npx vitest run`: `Test Files 10 passed (10)`, `Tests 146 passed (146)`; safety suite 45 (two cache cases
    added). Mutation check: letting a cached row skip the catalog re-check turned 2 tests red (one safety, one
    cache); restored, green. tsc exit 0, eslint exit 0, `forge lint`: `No issues found.`

- Step 4, providers and the SQL repository (D30):
  - `src/providers/assets.ts` (one passport object by Key, mapped attributes plus Version, absent vs empty from
    the type's definitions, record time), `registry.ts`, `index.ts` (one `read(environment)`), `groups.ts`;
    `forge.ts` wires them as the app (`api.asApp()`), read-only. `src/db/repo.ts`: the engine's `EngineRepo`
    on Forge SQL with strict row checks, plus `loadTool`, `loadEnvironment`, `loadCatalog`, `mappedAttributes`.
  - `npx vitest run`: `Test Files 12 passed (12)`, `Tests 169 passed (169)` (adds `providers.test.ts` 15,
    `repo-sql.test.ts` 8). Tests were written before the code, but no red run was recorded for this step;
    mutation check instead: treating an undefined attribute as empty turned 2 provider tests red; restored, green.
  - Real API, read-only, in the browser as the admin on the demo site (`docs/experiments.md` E1, "Answered
    2026-11-22"): AQL by `Key = "TPENV-4679"` returns exactly that object with `objectKey`, `objectType.id`,
    `updated`; AQL leaves out attributes with no value (0 empty lists across 14 schemas) while
    `objectTypeAttributes` lists all of the type's attributes (16/16, 15/15, 27/27).
  - Assets writes: the only POST in `src/providers` is the AQL search (a read); create paths in
    `assets-api.ts` are builders with no caller.
  - tsc exit 0, eslint exit 0, `forge lint`: `No issues found.` `forge deploy -e development`: 4.8.0, "eligible
    for the Runs on Atlassian program" (minor: no scope or module change).
  - Migration v021 (`ALTER TABLE catalog_keys ADD COLUMN IF NOT EXISTS unit …`) on real Forge SQL, both
    installations (`forge logs`, 2026-11-22 03:31:30-31 UTC): `[sweep] migrations applied: v021_catalog_key_unit`,
    twice, no errors.

- Step 5, Ask resolver, card and Ask page, plus "Load demo data" (D31):
  - Code: `src/engine/card.ts` (card model), `src/resolvers/handlers.ts` (ask, tools, environments, loadDemo;
    identity from the context, zod payloads, Try again on any error), `src/registry/write.ts` +
    `authorise.ts`, `src/seed/demo.ts`, `src/db/asks.ts`, `src/frontend/index.tsx` (Ask page, card, setup page).
  - Tests first for the card (red: `Cannot find module '../../src/engine/card'`). `npx vitest run`:
    `Test Files 15 passed (15)`, `Tests 199 passed (199)` (adds `card.test.ts` 14, `seed.test.ts` 4,
    `resolvers.test.ts` 10; the seed test runs the loaded data through the real engine: KS-DEV Not ready,
    KS-PROD No, 3 GB No, 1 GB Yes, websockets Don't know yet). tsc exit 0, eslint exit 0, `forge lint`:
    `No issues found.`
  - `forge deploy -e development`: 4.9.0, 4.10.0, 4.11.0, each "eligible for the Runs on Atlassian program"
    (minor versions; no scope or module change).
  - **Live on the demo site, in the browser as the admin (2026-11-23):**
    - Setup page → Load demo data (4.9.0): `Demo data not loaded … Unexpected token 'e', "e814c5c1-5"... is not
      valid JSON` (stored workspace id read back already parsed; nothing was written because objects are looked
      up first). Fixed in 4.10.0 (D31 h). Second click: `Demo data loaded · tools: 1 · environments: 2 ·
      catalogKeys: 25 · links: 7 · facts: 6 · rules: 8 · readinessKeys: 2 · accessMappings: 4 · KS-DEV →
      TPENV-4679 · KS-PROD → TPENV-4680`. This verified the admin check, the Name lookup in Assets, the owner
      write layer and migrations v022/v023 on real Forge SQL (the sweep also logged `[sweep] migrations applied:
      v022_rules_scope_key, v023_rules_scope_unique` at 05:41:31 for the other installation).
    - Ask, Kestrel Studio, KS-DEV, "Can I build a custom web dashboard?": **Not ready**, `KS-DEV · 13.2`,
      "You're not in kestrel-dev-builders, which gives Developer role in Kestrel.", chips `Mapped access ·
      kestrel-dev-builders`, `Assets record · read 11:11 AM`, `Owner-verified · 13.2`, "next: Needs design
      review", I checked: web front end · custom ui policy · access for custom ui · Frontend build. Access is
      Missing because the group doesn't exist on the demo site (E6: group creation needs a scope we don't have).
    - Same question, KS-PROD: **No**, "Policy for KS-PROD: Not allowed in production." Log: `[ask]
      state=checked verdict=no cached=true model=-` (translation cache hit, no model call).
    - "Can I upload a 3 GB file?", KS-PROD: **No**, "Upload a file of a given size: the recorded limit on 13.2 is
      2 GB; you asked for 3 GB." Log: `[ask] state=checked verdict=no cached=false model=claude-haiku-5-5`.
    - So, verified on the real platform: model choice from `list()` (Haiku 5.5 stored), `translationChat`,
      `sqlTranslationStore`, `sqlEngineRepo` and loaders, the Assets provider and group reader as the app.
  - **LLM calls in Phase 1 so far: 1 `list()` + 2 chat calls on `claude-haiku-5-5`** (the first KS-DEV ask ran
    before the log line existed; at most one retry possible there). At ~2,000 input / 50 output tokens per call,
    about $0.003.

- Step 6, guided fix (D32):
  - Code: `src/loop/requests.ts` (Request the fix, Re-check, routing, request text, the card's open requests),
    `src/loop/events.ts` (resolution from the changelog, read-back, re-check and comment, the sweep's share),
    `src/loop/jsm-forge.ts` (desk calls as the app), `src/loop/forge.ts` (wiring, `onIssueEvent`),
    `src/db/requests.ts` (open-key claim, status compare-and-set), `src/db/asks.ts` (`loadAsk`,
    `saveAskResult`), `src/resolvers/request-handlers.ts` (requestFix, recheck, request setup),
    `answerRequirement` in `src/engine/answer.ts`, migration v024 (`requests.portal_url`), page changes.
  - Tests first (red: `Cannot find module '../../src/loop/events'`, no tests ran). `npx vitest run`:
    `Test Files 17 passed (17)`, `Tests 241 passed (241)` (adds `fix-loop.test.ts` 32, `requests-sql.test.ts` 10).
    Mutation checks: dropping the "ask belongs to the caller" check turned 2 tests red; ignoring the read-back
    (trusting the event alone) turned 2 red; both restored, green. tsc exit 0, eslint exit 0, `forge lint`:
    `No issues found.`
  - `forge deploy -e development`: 4.12.0, then 4.13.0 (fix below), each "eligible for the Runs on Atlassian
    program". Migration v024 on real Forge SQL, both installations: `[sweep] migrations applied:
    v024_requests_portal_url` at 08:46:30 UTC (twice).
  - Bug found live in 4.12.0: the question box placeholder showed `Can I â€¦ ?`. Cause: a PowerShell
    rewrite (`Get-Content -Raw`) had re-saved four files with the wrong text encoding (`·`, `→`, `…` garbled in
    the page, a user-facing message in `requests.ts`, and two test comments). Repaired as UTF-8 and checked
    (`â|Ã|Â` in src and test: 0 matches; test files differ from HEAD only by the intended edits); 4.13.0 shows
    `Can I … ?`.
  - **Live on the demo site, in the browser as the admin (2026-11-23, UTC):**
    - Setup → Requests: desk list loaded (as the app), Tool Passport Desk (TPD) → usable request types listed
      (Get IT help first) → Save: `Fix requests go to Tool Passport Desk (TPD) as "Get IT help".`
    - Ask, KS-DEV, "Can I build a custom web dashboard?": Not ready, now with a **Request the fix** button. Log:
      `[ask] state=checked verdict=not_ready cached=true model=-`.
    - Request the fix (08:50:29): `[request] fix raised=2`. The card turned to `Fix requested (TPD-3) from <owner>
      · view request` and `Fix requested (TPD-4) from <owner> · view request`, with Re-check. TPD-3 = access,
      TPD-4 = setup. TPD-4 in Jira: summary `Fix needed in KS-DEV: Frontend build`, "raised this request via
      API" for the asker, assignee the owner, request type Get IT help, description: `Missing: Frontend build.
      Build environments needs to include "frontend". Evidence: Assets record TPENV-4679, read 2026-11-23 08:50
      UTC. What they want to do: Build a custom web front end or dashboard.` No question text. The admin raising
      for themselves needed no extra Customer role.
    - Sweep at 08:51:31: `[sweep] requests looked=2 rechecked=0 failed=0` (both open, not resolved: only looked).
    - As Marco: KS-DEV (TPENV-4679) Build environments set to `standard, frontend` in Assets; TPD-4 resolved as
      Done. Log 08:52:24: `[issue-event] TPD-4 rechecked` (about 2 s after resolving). TPD-4 got a public comment
      from tool-passport: `Tool Passport checked again after this request was resolved. Answer now: Not ready.
      You're not in kestrel-dev-builders, which gives Developer role in Kestrel.` (right: the frontend build is
      fixed; access, TPD-3, is still open).
    - Ask again: Not ready, reason access, and only `Fix requested (TPD-3)`: the frontend check now passes and a
      new ask finds the open request. The "view request" link is
      `https://one-atlas-oibs.atlassian.net/servicedesk/customer/portal/14/TPD-3`.
  - **The fix loop reaches "Yes, with approval" (Phase 1 sign-off item), live, 2026-11-23:**
    - With the human's go-ahead ("Yes, create it"), group `kestrel-dev-builders` was created in Atlassian
      Administration (org one-atlas-oibs) with the admin as its only member and no app access ("Group Created").
    - The Ask card was open on `Fix requested (TPD-3)`. Without any click it turned to **Yes, with approval**,
      `KS-DEV · 13.2`, "Allowed in KS-DEV with approval: Needs design review.", chips `Policy rule · Needs design
      re…`, `Owner-verified · 13.2`, `Mapped access · kestrel-de…`, "Next step: request approval.": the
      10-second re-check (polling) verified, and the new group membership was read as the app.
    - TPD-3 resolved as Done. Log 08:59:42: `[issue-event] TPD-3 rechecked`. Comment from tool-passport:
      `Tool Passport checked again after this request was resolved. Answer now: Yes, with approval. Allowed in
      KS-DEV with approval: Needs design review. Next step: request approval in Tool Passport.`
    - Sweep log lines between: `[sweep] requests looked=1 rechecked=0 failed=0` (08:56:29, TPD-3 open).
  - Demo data set back for moment 1: KS-DEV Build environments back to `standard` in Assets. Ask again: **Not
    ready**, "Frontend build isn't set up in KS-DEV.", chips `Assets record · read 02:31 PM`, `Owner-verified ·
    13.2`, `Mapped access · kestrel-de…`, **Request the fix**, "next: Needs design review": the spec's moment 1
    card (section 15) word for word, now that the admin is in kestrel-dev-builders.
  - **LLM calls in step 6: 0** (every ask was a translation cache hit). Phase 1 total stays 1 `list()` + 2 chat.

- Step 7, the first 20 eval questions (D33):
  - `test/eval/questions.json` now has the spec's five groups with targets (20 + 6 + 6 + 5 + 3 = 40) and
    the complete plain group first: the pilot's 18 plain questions plus `p16` (data kept 90 days →
    `data_retention_days: 90`) and `p17` (another team's system calls my app as an API → `api_endpoints`).
    The pilot's outside (3 + the blank question) and injection (2) questions are kept for Phase 2.
  - `test/unit/eval-set.test.ts` (5 tests, offline, no model call): groups and targets, plain group first
    and complete with one or two keys each and 18 distinct keys, unique ids and questions, every expected
    key and value accepted unchanged by the catalog, a perfect model reply scores as a pass through
    `translate`. Mutation check: making p16's value the string "90" turned it red; restored, green.
  - `npx vitest run`: `Test Files 18 passed (18)`, `Tests 246 passed (246)`. tsc exit 0, eslint exit 0.
  - **Not run against the real model** (0 LLM calls): no eval runner exists in the app (the E4 runner was
    removed at Phase 0 sign-off). The pilot ran 18 of the 20 exact on `claude-haiku-5-5` with essentially
    today's prompt; `p16`, `p17` and the ≥ 90% bar on the current prompt are untested until the Phase 2 run.

### Phase 1 sign-off (2026-11-23, approved by the human: "Approve sign-off")

Sign-off bar (CLAUDE.md): moment 1 on the development site by Nov 26 → **met Nov 23** (step 5; the spec's exact
card since step 6); the fix loop reaches Yes, with approval by Nov 30 → **met Nov 23** (step 6); safety suite
100%; unit tests green.

Results, verbatim:
- `bash scripts/check-prereqs.sh`: `Result: 18 passed, 0 warnings, 0 failed`.
- `npx vitest run test/safety`: `Test Files 1 passed (1)`, `Tests 45 passed (45)`.
- `npx vitest run`: `Test Files 18 passed (18)`, `Tests 247 passed (247)` (adds a purge test found missing
  in the review below; its first run failed only because the test's fake SQL lacked `execute()` without
  `bindParams`, which the real `SqlStatement` has: `execute(): Promise<APIResponse>`).
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx eslint "src/**/*.{ts,tsx}" "test/**/*.ts"`: exit 0.
- `forge lint`: `No issues found.`
- `forge eligibility -e development`: `The version of your app [4.13.0] that's deployed to [development] is
  eligible for the Runs on Atlassian program.`
- `forge install list`: toolpassport and one-atlas-oibs, development, version 4, `Up-to-date`.
- Deployed 4.13.0 = committed code: `git diff --stat bae8d9a HEAD -- src manifest.yml package.json` is empty.
- `forge logs -e development --since 2h`: no `purge`, `failed` or `ERROR` lines.

Security self-review against spec section 14 (what exists after Phase 1; code searches run on 2026-11-23):

| Risk | Control in the code now | Proven by |
| --- | --- | --- |
| A false Yes from missing data | Missing input is Not verified in every check; `combine()` throws on an empty list; empty and unsupported translations stop before evaluation; a stored ask whose keys no longer fit the catalog is Don't know yet | Safety suite 45/45 (13 spec cases, audience, every Not verified says why); mutation checks in steps 1, 3, 4, 6 |
| Someone other than the owner writes | Write resolvers today: `loadDemo`, `saveRequestSetup` (and `requestSetup`/`requestTypes` reads): Jira administrator, checked on the server (`mayAdminister`). No owner edit forms yet (My tools, Phase 2). `ask`, `requestFix`, `recheck` write only the caller's own asks and requests | `resolvers.test.ts` (loadDemo as a non-admin), `fix-loop.test.ts` "request setup (Jira administrators only)" |
| A request pretends to be someone else | 10 resolvers; payload schemas `AskPayload`, `ToolPayload`, `AskRef {askId}`, `DeskRef`/`SaveSetup`: none takes an account id (search for `payload.accountId`/`asker`: 0). A fix request is rebuilt from the stored ask, re-evaluated on the server, for its own asker only | `resolvers.test.ts`, `fix-loop.test.ts` "take the asker from the Forge context" (an account id in the payload is ignored; another person's ask id is not_found) |
| Environment data shown to the wrong people | Assets read as the app (D25), only mapped attributes plus Version, only objects of the passport schema and type (AQL); audience groups enforced on the server in `environments`, `ask` and every re-check | `providers.test.ts`; safety case 14 |
| The model infers permission from wording | The model gets the catalog, worked examples and the question only; its keys are checked against the catalog; access comes only from mapped groups, policy only from rules | Safety case 13, incl. "the model is never shown facts, rules, environment values or groups" |
| An approval nobody gave | `approvalOutcome`: an unmapped resolution never approves. Approval requests aren't built (Phase 2); the event path returns `not_handled` for them | Safety case 12; `fix-loop.test.ts` "leaves approval and question requests to their own loop" |
| One asker's question leaks to another | Each asker gets their own request (the open key includes the asker); raised on behalf of the asker only; no participant call anywhere (search for `participant`: 0); request text holds no question text; the card lists only the caller's requests | `fix-loop.test.ts` (Sam's fix is his own request); live TPD-3/TPD-4. The spec's full privacy test (Priya and Sam asking the same unknown) belongs to Ask the owner, Phase 2 |
| The app changes environments | Providers are read-only; the Assets create path builders in `assets-api.ts` have no caller (search: definitions only); the demo seed links existing objects and writes no Assets data | Code search |
| Rovo acts without the user meaning it | Not built (P1; keep-or-drop decision Dec 7) | — |
| Data kept longer than needed | The sweep clears question text after 30 days (text only); translations keep keys, values and model id; requests and their desk text hold no question text; no emails or display names stored (search for `emailAddress`/`displayName`: 0); log lines carry states, counts and request keys, not question text or account ids | `requests-sql.test.ts` (purge statement), `translate-cache.test.ts`; the purge itself is untested live (no ask is 30 days old yet) |
| Data leaves Atlassian | No `permissions.external`, no remotes (manifest search: 0) | `forge eligibility`: eligible (above) |

### Not done / untested

- Untested live (unit-tested): the sweep re-checking a missed event, the Customer-role message (D23), taking
  over a stopped raise, a failed comment finished by the sweep.
- Demo site state after the test: group `kestrel-dev-builders` exists with the admin in it (made by hand, not by
  the app: E6); TPD-3 and TPD-4 resolved; KS-DEV back to `standard`. Reset demo arrives in Phase 4.
- Untested live: `noteVersion` from the Ask path (setting KS-DEV's baseline; errors there are swallowed by
  design), the sweep's 30-day question purge, "Any environment".
- No demo data on the fresh site (toolpassport), on purpose (E9 must start fresh).
- The eval set has never run on today's prompt: planned once, for all 40, in Phase 2 step 3 (D33 d).
- Demo seed (Phase 4) must add facts and links for the action keys `external_api_calls` and `external_sharing`,
  or those questions answer Don't know yet (D28 h).

### Waiting on the human

- Still open from Phase 0: before any push, decide whether to rewrite root commit `6693b75` (D9). Branches
  `phase-0` and `phase-1` are local only; nothing has been merged or pushed.

### Next

- Phase 2 (planned Dec 1-7, can start early): approvals through the same request loop with resolution
  mapping in setup; Ask the owner; the remaining 20 eval questions and one run of all 40 (D33); Rovo only if
  P0-1 to P0-4 pass on a fresh site.

## Phase 2 (approvals, Ask the owner, optional Rovo), started 2026-11-23 on branch `phase-2`

Started a week early at the human's request ("Start Phase 2"), right after the Phase 1 sign-off.

### Works (verified)

- Step 1, approvals through the request loop (D34):
  - Code: `raiseApproval`, `approvalTargets`, `approvalRequestText`, `howToDecide` and the generalised
    "requested" card state in `src/loop/requests.ts`; approval decisions in `src/loop/events.ts`
    (`approvalDecision`: mapped name and the right person, `undecided` keeps the request open);
    `resolvedBy` (changelog) in `src/loop/resolution.ts`; `src/db/approvals.ts` (pending and decide upserts);
    `markUndecided` in `src/db/requests.ts`; resolution list and changelog read-back in `src/loop/jsm-forge.ts`;
    `requestApproval`, `resolutionSetup`, `saveResolutionMap` resolvers; Request approval button, "Approval
    requested" state and polling, and an Approvals section in setup.
  - Tests first (red: `TypeError: raiseApproval is not a function`, 19 failed). Now `npx vitest run`:
    `Test Files 19 passed (19)`, `Tests 272 passed (272)`; safety suite `Tests 46 passed (46)` (case 12 adds
    self-approval and an unreadable author through the real event path). Mutation checks: counting any resolver
    turned 2 approval tests red; skipping the mapping check turned 4 red; restored, green. tsc exit 0, eslint
    exit 0, `forge lint`: `No issues found.`
  - `forge deploy -e development`: 4.14.0, "eligible for the Runs on Atlassian program" (no scope or module
    change; resolutions and changelog are read with `read:jira-work`).
  - **Live on the demo site, in the browser as the admin (2026-11-23, UTC):**
    - Setup → Approvals listed Jira's 13 resolutions (as the app); Done → Approved, Declined → Declined, Save:
      `Saved. Resolving an approval request as "Done" approves it.`
    - KS-DEV Build environments set to `standard, frontend` (moment 2). Ask → **Yes, with approval**, "Allowed in
      KS-DEV with approval: Needs design review.", button **Request approval**. Log: `[ask] state=checked
      verdict=yes_with_approval cached=true model=-`.
    - Request approval (09:56:47): `[request] approval raised=1`; card `Approval requested (TPD-5) from <owner> ·
      view request` with Re-check. TPD-5: `Approval needed in KS-DEV: custom ui (Needs design review)`, raised
      via API for the asker, assigned to the owner, description ends `Resolve this request as "Done" to approve
      or "Declined" to decline. Any other resolution leaves the approval pending. …`
    - Resolved as **Won't Do** (unmapped): log 09:57:42 `[issue-event] TPD-5 undecided`; one comment `Tool
      Passport: "Won't Do" is not an approval decision, so the approval is still pending. To decide, the
      approver reopens it. Resolve this request as "Done" to approve or "Declined" to decline.`
    - Reopened (Back to in progress) and resolved as **Done** by the owner: comment `Tool Passport checked again
      after this request was resolved. Answer now: Yes. Everything this needs is in place in KS-DEV.` The open
      card turned by itself to **Yes**, `KS-DEV · 13.2`, chips `Owner-verified · 13.2`, `Approved · TPD-5`,
      `Mapped access · kestrel-de…`, no action. This confirms the changelog read-back (who resolved it) on the
      real API. Log: `[issue-event] TPD-5 rechecked` at 10:00:34 (it reached `forge logs` about 5 minutes
      later; log delivery lags, the handler didn't).
    - KS-DEV set back to `standard`.
  - **LLM calls in step 1: 0** (cache hits).

- Step 2, Ask the owner (D35):
  - Code: `raiseQuestion`, `questionTargets`, `questionRequestText` in `src/loop/requests.ts`;
    `src/loop/questions.ts` (`checkAnswer`, `writeAnswer`, `settleOpenQuestions`, `openQuestionGroups`);
    `src/resolvers/owner-handlers.ts` (`myTools`, `openQuestions`, `publishAnswer`); `askOwner` resolver;
    `openByKind` in `src/db/requests.ts`; `resolve` (issue transition) in `src/loop/jsm-forge.ts`; the page's
    Ask / My tools tabs, Ask the owner button, "Question sent (TPD-6) to <owner>" state with polling, and the
    Open questions view with the answer form.
  - Tests first (red: `Cannot find module '../../src/resolvers/owner-handlers'`). `npx vitest run`:
    `Test Files 20 passed (20)`, `Tests 286 passed (286)` (adds `questions.test.ts` 15). Mutation check:
    skipping the owner check in publish/open questions turned 2 tests red; restored, green. tsc exit 0,
    eslint exit 0, `forge lint`: `No issues found.`
  - `forge deploy -e development`: 4.15.0, then 4.16.0 (fix below), each "eligible for the Runs on Atlassian
    program" (no scope or module change; transitions use `write:jira-work`).
  - **Live on the demo site, in the browser as the admin (2026-11-23, UTC).** To keep the demo's known unknown
    (websockets) for the video, the loop was run on two other unknowns, in "Any environment":
    - The page now shows **Ask | My tools** tabs (the admin owns Kestrel Studio).
    - "Can I run jobs on GPU machines?", Any environment: **Don't know yet**, "Run jobs on GPU machines: No
      verified answer yet.", the Any-environment banner, chip `Not verified · No verified an…`, button **Ask
      the owner** (first live check of "Any environment"). Log: `[ask] state=checked verdict=dont_know
      cached=false model=claude-haiku-5-5`.
    - Ask the owner (11:08:38): `[request] question raised=1`; card `Question sent (TPD-6) to <owner> · view
      request`. TPD-6: `Question about Kestrel Studio: Run jobs on GPU machines`, raised via API for the asker,
      description `Someone asked Tool Passport about Kestrel Studio in any environment, and there is no
      verified answer yet. … Not verified yet: Run jobs on GPU machines: No verified answer yet. …` (no
      question text).
    - Bug found: My tools said "No open questions" (its panel had loaded with the page). After a reload it
      listed `Asked in Any environment · 1 open request · TPD-6 · Not verified: Run jobs on GPU machines: No
      verified answer yet` with the form (Yes / All environments / 13.2 / Holds for every version / Publish).
      Fixed in 4.16.0: the list reloads each time the tab opens, plus a Refresh button.
    - Publish (Yes, all environments, every version): `Published. Answered and closed: TPD-6. Still open: 0.`
      Log `[publish] gpu_compute settled=1 open=0`. TPD-6: comment `The tool owner answered in Tool Passport.
      Answer now: Yes. Kestrel Studio can do this, as verified by its owner.`, status **Resolved**, resolution
      **Done**, set by the app (the transitions API verified). The app's own resolution event: `[issue-event]
      TPD-6 already` (nothing done twice).
    - On 4.16.0: "Can my app send email to my team?", Any environment → Don't know yet → Ask the owner (TPD-7)
      → My tools tab listed TPD-7 **without a reload** → Publish (Yes, every version): `Published. Answered and
      closed: TPD-7. Still open: 0.` The Ask card, left open, turned by itself from `Question sent (TPD-7)` to
      **Yes**, "Kestrel Studio can do this, as verified by its owner.", chip `Owner-verified · 13.2`. Logs
      `[publish] email_notifications settled=1 open=0`, `[issue-event] TPD-7 already`.
  - **LLM calls in step 2: 2** chat calls on `claude-haiku-5-5` (the two new questions). Phase 2 total: 2.
    Project total since Phase 1: 1 `list()` + 4 chat, about $0.005.

- Step 3, the 40-question set and its first full run (D36):
  - `test/eval/questions.json` complete at 40 (20 plain, 6 pairs, 6 outside, 5 injection, 3 environment).
    Offline checks (`eval-set.test.ts`): groups at their targets, pairs point at each other with the same
    keys, injections match their plain question, and the engine gives the expected different verdicts on the
    demo data (KS-DEV Not ready, KS-PROD No) for the environment group.
  - Runner: `src/eval/score.ts` (translate without cache, score), `src/eval/summary.ts` (bars),
    `src/resolvers/eval-handlers.ts` (admin only, batches of 4, 10-minute gap between runs), Setup → Tests.
  - `npx vitest run`: `Test Files 21 passed (21)`, `Tests 297 passed (297)` (adds `eval-run.test.ts` 8; the
    first run of it failed in the test's own fake model, which matched i04 to p02 by contained text; fixed in
    the fake). tsc exit 0, eslint exit 0, `forge lint`: `No issues found.` `forge deploy`: 4.17.0, eligible
    for Runs on Atlassian.
  - **Live run, once, approved ("Yes, step 3"):** `Bar met. Answerable questions exact: 33 of 34 (97%; bar
    90%). Outside the catalog marked unsupported: 6 of 6 (bar 100%). Pairs consistent: 2 of 3. Model calls:
    39.` plain 20/20, pair 5/6 (pair bar **not met**), outside 6/6, injection 5/5, environment 3/3. The miss:
    `r1a` ("Can my dashboard show new data the moment it changes…") got `web_frontend, websockets` instead of
    `websockets`: stricter, never a false Yes; expectation not changed. Details: `docs/experiments.md`.
  - **Fix and re-run (human: "Yes, fix and re-run"; D37):** prompt p2 adds rule 6 (something the person already
    has is context, not a request to build it) and one worked example on another capability; expectations
    untouched. `npx vitest run`: `Tests 298 passed (298)`; deployed 4.18.0. Re-run 11:39:46-11:40:34 UTC:
    `Bar met. Answerable questions exact: 34 of 34 (100%; bar 90%). Outside the catalog marked unsupported: 6
    of 6 (bar 100%). Pairs consistent: 3 of 3. Model calls: 39.` Every group met; none got worse.
  - **LLM calls in step 3: 78** (two runs, about $0.08). Phase 2 total: 80. Project total since Phase 1: 1
    `list()` + 82 chat, about $0.09.

- Owner editing, spec F1 / P0-1 (D38), built before Rovo because Rovo's gate needs P0-1:
  - Code: `src/registry/edit.ts` (seven edit shapes and their checks), `src/resolvers/edit-handlers.ts`
    (`edit`, `createTool`, `toolDetails`), `loadRegistry` in `src/db/repo.ts` (readiness and access row
    readers shared with the engine), `writeFact` in `src/loop/questions.ts` (one fact write path), and the
    screens: My tools → Records (pick a kind, see what is recorded, add or change one) and Setup → Tools.
  - Tests first (red: `Cannot find module '../../src/resolvers/edit-handlers'`). `npx vitest run`:
    `Test Files 22 passed (22)`, `Tests 326 passed (326)` (adds `owner-edit.test.ts` 28); safety suite
    `Tests 46 passed (46)`. Mutation check: dropping the owner check turned 7 tests red (one per kind);
    restored, green. tsc exit 0, eslint exit 0, `forge lint`: `No issues found.` Deployed 4.19.0, eligible for
    Runs on Atlassian.
  - **Live on the demo site (2026-11-23, as the admin; only identical re-saves, so the demo data is unchanged):**
    My tools → Records listed both environments (`KS-DEV · Assets record TPENV-4679 · version 13.2 · owner
    <admin>`, the same for KS-PROD: the version baseline from asks, first seen live), the 8 policy rules, the
    8 facts (the seed's 6 plus GPU jobs and email from step 2) and the 4 access mappings, all as in spec
    section 16. Re-saved "custom_ui · KS-DEV · Needs approval · Tool owner · Needs design review": `Saved.`;
    log `[edit] rule saved` (12:28:10 UTC); the list still shows 8 rules (updated in place by its scope key).
    The save moved the catalog revision on, so each question's next ask costs one model call.
  - Not tried live: a refusal (needs a second, non-owner account), Setup → Add tool (would add a tool to the
    demo site), saving each of the other six kinds.

### Phase 2 sign-off checks (2026-11-23; the human chose "Phase 3 next")

Step 4 (Rovo, P1) is **not built**: its gate (P0-1 to P0-4 passing on a fresh site) hasn't been run, because the
only fresh site is kept for E9. Keep-or-drop decision due Dec 7. Everything else in Phase 2 is done.

Results, verbatim: `bash scripts/check-prereqs.sh`: `Result: 18 passed, 0 warnings, 0 failed`. `npx vitest run
test/safety`: `Tests 46 passed (46)`. `npx vitest run`: `Test Files 22 passed (22)`, `Tests 326 passed (326)`.
tsc exit 0, eslint exit 0. `forge lint`: `No issues found.` `forge eligibility -e development`: `The version of
your app [4.19.0] that's deployed to [development] is eligible for the Runs on Atlassian program.` Deployed =
committed (`git diff --stat 52173eb HEAD -- src manifest.yml package.json` empty). Searches: `external`/`remotes`
in manifest.yml 0; `participant`/`emailAddress`/`displayName` in src 0.

Section 14 self-review, what Phase 2 changed (the Phase 1 table still holds):

| Risk | Added in Phase 2 | Proven by |
| --- | --- | --- |
| A false Yes | An approval counts only with a mapped resolution set by the approver (or the assignee, if not the asker); an unreadable author decides nothing; an undecided resolution keeps the request open | Safety case 12 extended (46/46); `approvals.test.ts` |
| Non-owner writes | `edit` (7 kinds), `publishAnswer`, `openQuestions`, `toolDetails`: owner or Jira administrator, on the server; refusals audited. `createTool`, `saveResolutionMap`, `runEval`: Jira administrators | `owner-edit.test.ts`, `questions.test.ts`, `approvals.test.ts`, `eval-run.test.ts`; mutation checks |
| A request pretends to be someone else | `requestApproval`, `askOwner` take only an ask id and check it is the caller's; environment owners and access attesters are the person saving | `approvals.test.ts`, `questions.test.ts`, `owner-edit.test.ts` |
| One asker's question leaks to another | Question requests hold the requirement and what isn't verified, never question text; two askers' requests read the same; no participant call exists | `questions.test.ts`; search above |
| An approval nobody gave | as "A false Yes" | as above |
| Data kept too long / leaves Atlassian | Nothing new about people is stored (the eval run keeps only its start time); no egress | Searches above; `forge eligibility` |
| Rovo | Not built | — |

### Not done / untested

- Demo site state: the admin now holds an **approved** grant for custom UI in KS-DEV (TPD-5). Moment 2 on this
  site therefore skips the approval step until Phase 4's Reset demo clears grants. TPD-5 resolved.
- Untested live (unit-tested): Declined; self-approval refused; hand-over to another assignee; the sweep
  deciding a missed event; a missing pending grant created at decision time.
- **Privacy with two askers untested live** (spec section 19 privacy test, the demo's Priya + Sam): needs a
  second signed-in person (Sam), which only the human can do. Unit-tested: each asker's own request, identical
  text built from the requirement only, nobody added as a participant (no participant call exists).
- Untested live: a question answered for one environment and version only; a "No" answer; a question the
  owner resolves in the service desk; the websockets demo question itself (kept unanswered for the video).
- Demo site state: published facts `gpu_compute` and `email_notifications` (Yes, all environments, every
  version, verified by the admin); TPD-6 and TPD-7 resolved. The catalog revision moved on twice, so cached
  translations are redone (one model call per question on its next ask).
- The prompt was tuned once on this same set (D37); judges' own wording is still the real test. Prompt p2
  means every question's first ask after 4.18.0 costs one model call.
- Step 4: Rovo (spec F8), only if P0-1 to P0-4 pass on a fresh site; keep-or-drop decision Dec 7.

### Waiting on the human

- Still open: before any push, decide whether to rewrite root commit `6693b75` (D9). Branches `phase-0`,
  `phase-1` and `phase-2` are local only.

### Next

- Step 4 (Rovo) depends on a fresh-site check of P0-1 to P0-4 (spec Phase 2 step 4); the decision is due Dec 7.
  With F1 built, the check can run on the fresh site (toolpassport): add a tool, environments and records,
  ask, request a fix and an approval. That site has no service desk set up and no demo data on purpose (E9);
  using it for this check is the human's call. Also: the privacy test with Sam signed in.

## Phase 3 (version validity), started 2026-11-23 on branch `phase-3` (from `phase-2`)

Started early, right after Phase 2, at the human's request ("Phase 3 next").

### Works (verified)

- Step 1, version validity (spec F6, section 11; D39):
  - Code: `src/change/changes.ts` (`buildRecheckList`, `sweepChanges`, `detectVersions`, `stillTrue`),
    `src/db/changes.ts` (changes and recheck items), `src/resolvers/change-handlers.ts` (`changes`,
    `stillTrue`, `recentAsks`), `src/frontend/changes.tsx` (My tools → Changes; Ask → Your recent questions),
    the sweep (`src/change/sweep.ts`: notes every environment's version, then builds open lists), and a
    registry environment save that notes the version (`src/registry/edit.ts`). Read-time comparison and
    `noteVersion` were already in place from Phase 1.
  - `npx vitest run`: `Test Files 23 passed (23)`, `Tests 342 passed (342)` (adds `changes.test.ts` 12, plus
    version tests in `owner-edit.test.ts` and `requests-sql.test.ts`); `npx vitest run test/safety`:
    `Tests 46 passed (46)`. tsc exit 0, eslint exit 0. `forge lint`: `No issues found.` Deployed 4.20.0, then
    4.21.0 (the time fix below). `forge eligibility -e development`: `The version of your app [4.21.0] that's
    deployed to [development] is eligible for the Runs on Atlassian program.`
  - **Moment 3 live on the demo site (2026-11-23, as the admin acting as both Priya and Marco):**
    1. KS-DEV and KS-PROD on 13.2. "Can I upload a 3 GB file?" in KS-DEV: **No** (2 GB on 13.2).
    2. The admin set KS-DEV's Version to 14.0 in Assets (TPENV-4679), 12:49 UTC. Asked again at once:
       **Don't know yet**, "Verified on 13.2; KS-DEV runs 14.0" (read-time comparison, before any background
       work). The ask noted the change.
    3. Sweep, 12:51:31 UTC: `[sweep] versions changed=0 lists listed=1 failed=0`. My tools → Changes:
       `KS-DEV: 13.2 → 14.0 · Found in Assets record`, 4 facts to re-verify on 14.0, `Not listed: 4 facts
       that don't depend on the version. Policy rules untouched: 8. Other environments untouched: KS-PROD
       (13.2).` Recent questions whose evidence used those facts showed **May have changed**.
    4. The change time first showed as 12:49 PM in a UTC+5:30 browser (Forge SQL returns UTC with no zone).
       Fixed with `utcIso` (4.21.0); it now shows 06:19 PM.
    5. **Changed** on "Upload a file of a given size", 5 GB: `Upload a file of a given size: changed on 14.0.`
       **Still true** on "Build a custom web front end or dashboard": `…: still true on 14.0.` Both left the
       list; two remain (community app framework, runtime 3.9).
    6. Ask again on the badged 3 GB KS-DEV question: **Yes**, `KS-DEV · 14.0`, `Owner-verified · 14.0`; the
       same ask row now reads Yes and the badge is gone.
    7. **Rollback:** the admin set KS-DEV back to 13.2 (12:58 UTC). Ask again: **No**, `KS-DEV · 13.2`, "the
       recorded limit on 13.2 is 2 GB; you asked for 3 GB", with no edits. A second change row appeared,
       `KS-DEV: 14.0 → 13.2 · Found in Assets record · Nov 23, 06:28 PM`; sweep 13:01:31 UTC `listed=1`;
       the screen then read `Every version-dependent fact is verified on 13.2.` KS-PROD stayed 13.2 throughout.
  - **LLM calls in Phase 3: 1** chat call (the first 3 GB ask; every later one was a re-check of the stored
    keys).

- Rollback badge fix (D40; human: "Yes, fix the gap"). Found in step 7 above: an ask was marked "may have
  changed" only if its evidence used an *affected* fact. After the rollback to 13.2 every fact had a 13.2
  verification, so nothing was marked, though an ask answered Yes on 14.0 (5 GB) would now get No. Now an ask is
  marked when its evidence used a verification other than the one that counts on the new version, unless the
  value is the same (`staleVerifications` in `src/change/changes.ts`).
  - Tests first, red as expected: `expected [ false, false, false ] to deeply equal [ true, false, false ]` and
    `expected [ false, false ] to deeply equal [ true, false ]`. Then `npx vitest run`: `Test Files 23 passed
    (23)`, `Tests 344 passed (344)`; `npx vitest run test/safety`: `Tests 46 passed (46)`. Mutation check:
    dropping the same-value condition turned both new tests red; restored, green. tsc exit 0, eslint exit 0,
    `forge lint`: `No issues found.` `forge deploy`: `The version of your app [4.22.0] that was just deployed to
    [development] is eligible for the Runs on Atlassian program.`
  - **Live, 4.22.0 (2026-11-23 UTC, as the admin; the human signed in again in the browser pane first):**
    1. KS-DEV set to 14.0 in Assets. Sweep 19:11:29 UTC: `[sweep] versions changed=1 lists listed=1
       failed=0` (the sweep noted the change itself, with no ask). The 3 GB KS-DEV question (No, answered on
       13.2) showed **May have changed**. The old rule missed this case too, because 14.0 already had its own
       verification (5 GB). The KS-PROD question was not marked.
    2. Ask again: **Yes**, `KS-DEV · 14.0`, `Owner-verified · 14.0`; the badge cleared.
    3. KS-DEV set back to 13.2. Sweep 19:16:29 UTC: `[sweep] versions changed=1 lists listed=1 failed=0`. The
       same question, now **Yes · May have changed**: the gap is closed.
    4. Ask again: **No**, `KS-DEV · 13.2`, "the recorded limit on 13.2 is 2 GB; you asked for 3 GB"; the
       badge cleared. No LLM calls (re-checks only).
  - Limits, as D40 says: the KS-DEV "Don't know yet" question (asked on 14.0 before 14.0 was verified) used no
    verification, so it is not marked although asking again would now answer it; questions marked by an earlier
    change keep their badge until asked again.

- Polish (2026-11-24; human: "Yes, polish"), both found in the live runs above:
  - **Order.** Shown lists sort by `created_at`, then id: the Changes list (newest first), the asker's recent
    questions (newest first) and the owner's open questions (oldest first). The sweep's open changes and the
    recent asks it checks use the same order, so a `LIMIT` keeps the right rows. Forge SQL (TiDB) ids are not in
    time order. Test first, red as expected: `expected 'SELECT id, tool_id, environment_id, f…' to match
    /ORDER BY created_at DESC, id DESC LIM…/`.
  - **Refresh.** One Refresh button at the top of My tools (next to the tool picker) now reloads open questions,
    Changes and Records; before, it reloaded open questions only.
  - Checks: tsc exit 0, eslint exit 0; `npx vitest run`: `Test Files 23 passed (23)`, `Tests 345 passed (345)`;
    `npx vitest run test/safety`: `Tests 46 passed (46)`; `forge lint`: `No issues found.` `forge deploy`:
    `The version of your app [4.23.0] that was just deployed to [development] is eligible for the Runs on
    Atlassian program.`
  - **Live, 4.23.0 (as the admin):** the Changes list read Nov 24 12:46 AM, Nov 24 12:41 AM, Nov 23 06:28 PM,
    Nov 23 06:19 PM (browser time, UTC+5:30); before, 06:19 was above 06:28. The reply carried ids 90001, 30006,
    2, 30005 with `createdAt` 19:16:29Z, 19:11:29Z, 12:58:16Z, 12:49:59Z: id 2 was made after id 30005. Clicking
    Refresh sent three app calls (it used to send one), and one reply was that Changes list. Not checked live: a
    change found by the sweep appearing on Refresh without a tab switch (no new version change was made for
    this; the call it depends on was seen).

### Fresh-site check of P0-1 to P0-4 (spec section 6: the gate before any P1 work), 2026-11-24

The human chose this before F9 ("Fresh-site check first"), because spec section 6 allows P1 features (Rovo, then
release-note labels) "only after P0-1 to P0-4 pass on a fresh site". Site: `toolpassport` (free developer site from
the sign-up page, made 2026-11-21 for E2). The app there was already on the latest code (`forge install list`:
version 4, `Up-to-date`), so no upgrade. The human signed in; everything ran in the browser pane as the admin.
E9 (Phase 4) now needs another fresh site.

Set up as a customer would (human: "Yes, create all three"):
- Service desk: Create space → Service management → Basic IT service management, name Tool Passport Desk, key
  TPD, team type IT, channel access Open (the default). `GET /rest/servicedeskapi/servicedesk`: `{id 1, TPD}`;
  request types include `1:Get IT help`.
- Groups `kestrel-dev-builders` (the admin as the only member) and `kestrel-prod-deployers` (empty):
  `POST /rest/api/3/group` 201, 201; member add 201.
- Assets: the E2 schema `Tool Passport Environments` (TPENV) with type `Tool Environment` and KS-DEV (TPENV-1,
  13.2, `standard`) and KS-PROD (TPENV-2, 13.2, `standard, frontend`) was already there and matched.
- Setup → Load demo data: `Demo data loaded` · `tools: 1 · environments: 2 · catalogKeys: 25 · links: 7 ·
  facts: 6 · rules: 8 · readinessKeys: 2 · accessMappings: 4` · `KS-DEV → TPENV-1 · KS-PROD → TPENV-2`.
- Setup → Requests: `Fix requests go to Tool Passport Desk (TPD) as "Get IT help".`

Results:
- **P0-3 passes here.** Ask → "Can I build a custom web front end or dashboard?" in KS-DEV: **Not ready**,
  `KS-DEV · 13.2`, "Frontend build isn't set up in KS-DEV.", chips `Assets record · read 08:03 …`,
  `Owner-verified · 13.2`, `Mapped access · kestrel-de…`, Request the fix, `next: Needs design review`. Log
  `[ask] state=checked verdict=not_ready cached=false model=claude-haiku-5-5` (02:33:23 UTC). 1 model call.
- **P0-2 passes here.** KS-DEV Build environments set to `standard, frontend` in Assets (as the admin, PUT 200).
  Asking again: **Yes, with approval**, "Allowed in KS-DEV with approval: Needs design review." Log
  `cached=true model=-` (02:38:24). A failed read was not forced here (unit-tested).
- **P0-1 passes in part.** My tools → Records re-saved KS-DEV unchanged: `Saved.`, log `[edit] environment
  saved` (02:39:13). A refusal for someone who is not the owner was not tried: there is no second person on this
  site (unit-tested, `owner-edit.test.ts`).
- **P0-4 failed here on 4.23.0; fixed in 4.24.0 (D41), see below.**
  - Request the fix raised **TPD-1** (`[request] fix raised=1`, 02:33:40). Its portal text is right: missing
    Frontend build, evidence TPENV-1, "When it's in place, resolve this request."
  - **This site has no Jira resolutions.** `GET /rest/api/3/resolution` → `[]`; Jira's View Resolutions page is
    empty. The desk's "Resolve this issue" transitions have no post-function that sets one. The loop waits for a
    resolution (`src/loop/events.ts`: the event needs a `resolution` change; the read-back needs a resolution
    name), so a resolved request is never noticed. TPD-1, resolved from the portal (the asker may resolve a
    fix request; any resolver counts for a fix), read back as an agent: `status: Resolved`, category `done`,
    `resolution: null`, `resolutiondate: null`; changelog `status: Waiting for support -> Resolved` (02:36:45
    UTC) and `assignee: -> <admin>` (02:33:40: the app's assignment to the owner worked). No app comment
    followed; the sweeps at 02:36:29 and 02:41:39 both logged `[sweep] requests looked=1 rechecked=0
    failed=0`.
  - Approvals can't be set up: Setup → Approvals lists no resolutions to map. Request approval answered
    "Approvals aren't set up yet. …" (`[request] approval error=approvals_not_set_up`); it fails safe (no request,
    no Yes), but moment 2 can't finish on a site like this.
  - For about 10 minutes after creating the desk, the admin was not an agent on it (`SERVICEDESK_AGENT` false
    although in the roles the scheme grants it to; `/browse/TPD-1` opened the customer portal). At 02:41:28 it
    was true. A judge who creates a desk and resolves the first request at once may hit this; the guide should
    say to wait.
- Small: the "Assets object key" box in Records showed the demo site's key `TPENV-4679` as its example; now
  "Like TPENV-1" (and the refusal text says "like TPENV-1").

Fix (D41; human: "Done status counts"): a request in a done status with no resolution counts as resolved,
decided by whoever moved it there; a status change alone triggers the read-back; Setup → Approvals offers the
desk's done statuses on a site with no resolutions.
- Tests first, red as expected (15: `TypeError: readOutcome is not a function`, status events `ignored`). Then
  `npx vitest run`: `Test Files 23 passed (23)`, `Tests 357 passed (357)`; `npx vitest run test/safety`:
  `Tests 47 passed (47)`. Mutation checks: no done-status outcome → `Tests 3 failed | 354 passed`; status
  change ignored → `7 failed | 350 passed`; the assignee counted as the decider → `2 failed | 355 passed`
  (one in the safety suite); restored, green. tsc exit 0, eslint exit 0, `forge lint`: `No issues found.`
  No manifest change. `forge deploy`: `The version of your app [4.24.0] that was just deployed to
  [development] is eligible for the Runs on Atlassian program.`
- **Live on toolpassport, 4.24.0:**
  - Setup → Approvals: `This site has no Jira resolutions, so the service desk's done statuses decide
    instead.`, listing Closed, Canceled, Resolved, Completed, Done and more. Resolved → Approved, Canceled →
    Declined, Save: `Saved. Setting an approval request to "Resolved" approves it.`
  - Ask (cached, no model call): **Yes, with approval** → Request approval → **TPD-2**, `Approval requested
    (TPD-2) from <owner>`. Its text: `Set this request to "Resolved" to approve or "Canceled" to decline. Any
    other outcome leaves the approval pending. …`
  - As the approver in Jira's agent view, "Resolve this issue" **would not save**: `Resolution is required.`,
    and the Resolution list said `No matches found`. Jira itself blocks agents on a site with no resolutions.
  - The same transition through `POST /rest/api/3/issue/TPD-2/transitions` as the approver (the field reported
    `required: true` with 0 allowed values): **204**, TPD-2 `Resolved`, category `done`, `resolution: null`.
    Within seconds, TPD-2 got `Tool Passport checked again after this request was resolved. Answer now: Yes.
    Everything this needs is in place in KS-DEV.`, and the open card turned by itself to **Yes**,
    `KS-DEV · 13.2`, chips `Owner-verified · 13.2`, `Approved · TPD-2`, `Mapped access · kestrel-de…`. Logs:
    `[request] approval raised=1` (02:53:52), `[issue-event] TPD-2 rechecked` (02:55:57).
  - TPD-1 (resolved from the portal under 4.23.0, its event already spent): the first 4.24.0 sweep picked it
    up (`[sweep] requests looked=1 rechecked=1 failed=0`, 02:56:32). Comment at 02:56:32 UTC: `Tool Passport checked again after this request was resolved. Answer now:
    Yes. Everything this needs is in place in KS-DEV.` (Yes, since TPD-2 had just been approved.) Not run: a
    fix request resolved under 4.24.0 through its event; that is the same handler TPD-2 went through.
  - **P0-4 now passes here, with one condition:** an approver can only resolve in Jira's own screen once the
    site has resolutions. The judge guide (Phase 4) must say: if Jira settings → Work items → Resolutions is
    empty, add Done and Declined. The app's done-status path covers portal resolves and the app's own resolving.
  - LLM calls in the fresh-site check: 1.

### Rovo agent and actions (spec F8, P1), started 2026-11-24 (human: "Start Rovo first")

- Docs read first (CLAUDE.md lists these as unconfirmed), as of 2026-11-24: the rovo-agent module page (key,
  name ≤ 30 characters, prompt, description, conversationStarters, actions), the rovo-action page (module
  `action`: key, name, function, actionVerb GET/CREATE/UPDATE/DELETE/TRIGGER, description, inputs with title,
  type, required, description; "never rely on values passed as inputs … read [the accountId] from the
  context"), and Function arguments (`handler(payload, context)`, `context.principal.accountId`). Not stated
  in the docs: whether Rovo fills `principal` for actions, and whether CREATE asks the person to confirm.
  Reuse by other people's agents goes through a separate `rovo:mcp` module (not added).
- Code: `src/rovo/actions.ts` (`rovoCheck`, `rovoAskOwner`, `accountIdOf`; no Forge imports) and
  `src/rovo/forge.ts`. `check-tool-readiness` (GET) takes tool, environment (optional) and question by name,
  runs the page's own `handleAsk` for `context.principal.accountId`, and returns the card's fixed words: verdict,
  reason, where, evidence lines with their labels, checked, next, a next step and the askId. Environments the
  person may not pick count as unknown and aren't listed. `ask-tool-owner` (CREATE) takes only that askId and
  raises the question through `raiseQuestion`, which checks the ask is the caller's. Fixes and approvals stay
  on the page. The agent's prompt (inline in the manifest) says to answer only through the action, keep its
  verdict words and labels, and call ask-tool-owner only after the person agrees.
- Tests first (red: `Cannot find module '../../src/rovo/actions'`), `test/unit/rovo.test.ts` 10 tests.
  `npx vitest run`: `Test Files 24 passed (24)`, `Tests 367 passed (367)`; safety `Tests 47 passed (47)`.
  Mutation checks: identity also read from `context.accountId` → `2 failed`; audience filter dropped →
  `1 failed`; restored, green. tsc exit 0, eslint exit 0, `forge lint`: `No issues found.` (it validates the
  new `rovo:agent` and `action` modules).
- `forge deploy`: 4.26.0 (agent and actions), 4.27.0 (`rovo:mcp`), each "eligible for the Runs on Atlassian
  program". `forge install list` after each: both installations version 4, `Up-to-date`, so no install
  upgrade was needed. (One deploy first failed on `getaddrinfo ENOTFOUND` for the CLI's error-report host; the
  network was back a minute later and the retry worked.)
- **Live on the demo site (as the admin, in Rovo chat):**
  - The agent picker found **Tool Passport**, showing its description and the three conversation starters.
  - "Can I build a custom web dashboard with Kestrel Studio in KS-DEV?": Rovo showed `Invoking tool: Check tool
    readiness`, then **Verdict: Not ready**, "Frontend build isn't set up in KS-DEV.", evidence `Assets record:
    Build environments`, `Owner-verified: 13.2`, `Approved: TPD-5`, and the next step on the page. The same
    answer as the page. So Rovo does fill `context.principal.accountId` for an action (without it the action
    refuses). Logs: `[ask] … verdict=not_ready cached=false`, `[rovo] check verdict=not_ready`.
  - "Can my dashboard keep a two-way connection open to the server with Kestrel Studio in KS-DEV?": **Don't
    know yet**, "Keep two-way connections open (websockets): No verified answer yet.", evidence `Not verified`,
    and the agent asked "Would you like me to do that?" before anything. After "Yes, please ask the owner."
    Rovo itself showed **Please review · Ask the tool owner · askId: 30007 · Confirm selected / Cancel**: E8's
    "the create action asks for confirmation" is met. On Confirm (human: "Yes, on the demo site"): **TPD-8**
    raised for the admin, assigned to the owner, text built from the requirement only ("Question about Kestrel
    Studio: Keep two-way connections open (websockets)"). Logs: `[rovo] ask-owner raised=1`.
  - **Reuse (`rovo:mcp`, human: "Add rovo:mcp"):** Rovo Studio → Create agent → Start from blank made a draft
    "Untitled Agent"; Add tools listed **Check tool readiness (development)** with our description. Added to
    the draft (not published) and asked the same dashboard question in Test: `Invoking tool: Check tool
    readiness (development)`, then the facts (Not ready, the reason, Assets record, TPD-5, next step). Log
    `cached=true`. **Found:** that agent, which has no instructions, opened with "No, you cannot currently
    build…" for Not ready. Fixed: the check's reply now leads with `answer` ("Not ready. Frontend build isn't
    set up in KS-DEV.") and a fixed `howToReport` (keep the verdict word; Not ready is not a No; Don't know yet
    means nothing is recorded), and the action's description says so too (`forge lint` limits it to 255
    characters). Test first (red: `expected undefined to be 'Not ready. …'`); 368 tests, safety 47/47.
    Deployed 4.28.0 (eligible for Runs on Atlassian). The same draft agent, new chat, same question: **"Not
    ready. Frontend build isn't set up in KS-DEV."**, then the labelled evidence and the next step; no "No".
    Log `[ask] … cached=true model=-` (05:04:33 UTC).
  - **toolpassport (a free developer site) has no Rovo:** no Ask Rovo button, also at full width. Checked in
    Atlassian Administration (read only, 2026-11-24): AI and Rovo → Access says `You haven't blocked Rovo
    features for any apps`, and the overview shows Rovo credits (0 used), so nothing is switched off. But Apps →
    Atlassian apps lists 9 apps with **no Rovo and no Studio**, while the demo site's organization lists 17,
    including `Rovo | Free` and `Studio | Free` (its other plans are Enterprise, Premium and "Service Collection
    Enterprise Demo"). Add app on toolpassport offers no single Rovo app; Rovo agents come only in the
    "Teamwork Collection" ("Start a free trial"). Nothing was added. So a judge on a free developer site likely
    has no Rovo unless they start that trial; E8's "invoke them on a second site" can't run on toolpassport
    as it is.
  - LLM calls for the Rovo checks: 2 (two new wordings; the Studio call was a cache hit).
- Left on the demo site: the draft Studio agent "Untitled Agent" (not published) and TPD-8 (open). The Phase 4
  Reset demo should clear TPD-8; the draft can be deleted in Rovo Studio.

### Release-note labels (spec F9, P1, Phase 3 step 3), started 2026-11-24 (human: "Yes, start F9")

- Code (D44): `src/change/release-notes.ts` (`labelReleaseNotes`, `groundedQuote`, `buildLabelMessages`; no
  Forge imports), `src/db/labels.ts` (`release_labels`, from migration v015), `labelChat` in
  `src/llm/client.ts` (up to 2,000 output tokens), `handleReleaseNotes` and a `suggestion` per fact in
  `handleChanges`, the `releaseNotes` resolver, and on My tools → Changes a paste box with **Suggest labels**
  on each listed change, and a lozenge ("Notes: still true / changed / removed", "Notes don't say") with the
  quote under each fact, next to Still true and Changed.
- Tests first (red: `Cannot find module '../../src/change/release-notes'`, `handleReleaseNotes is not a
  function`). `npx vitest run`: `Test Files 25 passed (25)`, `Tests 382 passed (382)`; safety `Tests 47 passed
  (47)`. Mutation checks: quote not checked against the notes → `3 failed`; no owner check on Suggest labels →
  `1 failed`; facts not on the change's list sent to the model → `1 failed`; restored, green. tsc exit 0,
  eslint exit 0, `forge lint`: `No issues found.` `forge deploy`: 4.29.0, "eligible for the Runs on Atlassian
  program" (no manifest change).
- **Live on the demo site, 4.29.0 (as the admin, after the human signed in again):** My tools → Changes, the
  KS-DEV 13.2 → 14.0 change of Nov 24 12:41 AM (2 facts still open) showed the paste box and its help text.
  Pasted fictional notes (5 lines: uploads now 5 GB; "The community app framework is fully supported in 14.0,
  with no changes needed."; "Removed: runtime 3.9 is no longer supported. Apps must move to runtime 4."; a
  fix). Suggest labels: `Suggested a label for 2 facts (2 with a quote from the notes). Check each one, then
  choose Still true or Changed.` Under "Use the community app framework": **Notes: still true** and
  “The community app framework is fully supported in 14.0, with no changes needed.” Under "Run code on runtime
  version 3.9": **Notes: removed** and “runtime 3.9 is no longer supported”. Both facts stayed open with
  Still true on 14.0 / Changed: nothing was verified. Log: `[labels] change=30006 facts=2 grounded=2
  model=claude-haiku-5-5` (08:28:02 UTC). **LLM calls for F9: 1.**
- Not tried live: a paste where a quote isn't in the notes (unit-tested), and a non-owner (no second person).
- Demo site state: change 30006 now carries the two suggestions; Reset demo (Phase 4) should clear
  `release_labels` with the changes.

### Phase 3 sign-off checks (2026-11-24; human: "Yes, sign off")

All three Phase 3 steps are done: version validity (F6, with D39-D41), the change-detection test, and
release-note labels (F9, D44). Also in this phase: Changes polish, the fresh-site check of P0-1 to P0-4 (D41),
and Rovo (F8, D42, kept by D43). Branch `phase-3`, HEAD `a006c54`.

Results, verbatim:
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npx eslint "src/**/*.{ts,tsx}" "test/**/*.ts"`: exit 0.
- `npx vitest run`: `Test Files 25 passed (25)`, `Tests 382 passed (382)`. `npx vitest run test/safety`:
  `Tests 47 passed (47)`.
- `forge lint`: `No issues found.`
- `forge eligibility -e development`: `The version of your app [4.29.0] that's deployed to [development] is
  eligible for the Runs on Atlassian program.` `forge install list`: both installations (toolpassport,
  one-atlas-oibs) development, version 4, `Up-to-date`.
- Deployed = committed: `git diff --stat a789b45 HEAD -- src manifest.yml package.json package-lock.json` is
  empty (4.29.0 was deployed from a789b45's code; only docs changed since), and the working tree is clean.
- Searches: `external`/`remotes` in manifest.yml: 0. `participant`/`emailAddress`/`displayName` in src: 0.
  Token or password patterns (`ATATT`, `api_token =`, `password =`) in src and test: 0. Write calls to Assets
  outside `seed/` and `setup/`: one match, `src/providers/forge.ts:44`, the AQL search, which is a POST but only
  reads.
- `scripts/check-prereqs.sh`: the only bash on PATH is `C:\Windows\system32\bash.exe` (Linux, WSL), which gave
  `Result: 16 passed, 0 warnings, 2 failed`: `Node.js not found` and `Not logged in to Forge`, because it can't
  see the Windows tools. Git Bash is broken on this machine (`'C:\Program Files\Git\bin\..\usr\bin\bash.exe'
  not found`; the same reason the agent's Bash tool fails). The two checks run directly: `node --version`
  `v24.22.1` (the script accepts 22.x or 24.x); `forge whoami` exit 0 (logged in; output not recorded because it
  holds the account's name and email). So all 18 checks hold.

Section 14 self-review, what Phase 3 changed (the Phase 1 and Phase 2 tables still hold):

| Risk | Added in Phase 3 | Proven by |
| --- | --- | --- |
| A false Yes from missing data | Answers compare versions at read time: a verification for another version is never used, so an upgrade or a rollback can't make an old fact count (F6). A done status with no resolution can approve only when the approver set it (D41). Release-note labels and "May have changed" badges never change an answer; only Still true or Changed adds a verification | Safety suite 47/47 (case 12 extended for statuses); `changes.test.ts`; `release-notes.test.ts` "a label is only a suggestion"; mutation checks in D40, D41, D44 |
| Someone other than the owner changes a fact | `stillTrue`, `changes` and `releaseNotes` check owner or Jira administrator on the server | `changes.test.ts` (refusals, no model call); mutation check: owner check removed from Suggest labels → 1 red |
| A request pretends to be someone else | The Rovo actions take the caller from `context.principal.accountId` only; no input is an account id; ask-tool-owner checks the ask is the caller's | `rovo.test.ts`; mutation check: identity also read elsewhere → 2 red; live: Rovo filled the principal |
| Environment data shown to the wrong people | The Rovo check treats an environment the person may not pick as unknown and never lists it | `rovo.test.ts`; mutation check: audience filter dropped → 1 red |
| The model infers permission from wording | F9's model sees only the listed facts' labels and old values and the pasted notes (D44, a scoped deviation from section 13); its output is a label and a quote that code checks is in the notes; it can't write | `release-notes.test.ts` (ungrounded quotes become can't tell; orders in the notes change nothing); mutation check: quote not checked → 3 red |
| An approval is recorded that nobody gave | Status-mapped approvals keep D34's rule: the asker moving their own request to a mapped status decides nothing | Safety case 12 (status variant); `approvals.test.ts` |
| One asker's question leaks to another | Rovo's ask-tool-owner raises through the same `raiseQuestion` (requirement only, never question text) | `rovo.test.ts`; live TPD-8 text |
| The app changes environments | No new Assets write path; the only match is a read (AQL search) | Search above |
| Rovo acts without the user meaning it | ask-tool-owner is CREATE; live, Rovo showed "Please review … Confirm selected" before it ran, and the agent's prompt asks first | E8 (part pass), STATUS Rovo section |
| Data kept longer than needed | Release notes are not stored, only labels and short quotes | `release-notes.ts`, `db/labels.ts` |
| Data leaves Atlassian | No `permissions.external`; Forge LLM and Rovo only | `forge eligibility` above |

### Not done / untested

- Step 2 (spec section 19 change-detection test): written and green as `changes.test.ts` "the change-detection
  test" (two stale detections at once and a repeat after a crash make one row; the rollback restores No with no
  edits and is its own row), plus `detect.test.ts` from Phase 1. Those use in-memory fakes; against the real
  database only the rollback was run (live, above), not two detections at the same moment.
- Untested live, unit-tested: F9 with a quote that isn't in the notes; any refusal for someone who isn't the
  owner (no second person on either site); the privacy test with Sam signed in.
- toolpassport is no longer fresh: Tool Passport Desk (TPD, TPD-1 and TPD-2 resolved), the two kestrel groups,
  the demo data, KS-DEV Build environments `standard, frontend`, an approved custom UI grant (TPD-2), approvals
  mapped by status. E9 needs another fresh site.
- For the judge guide (Phase 4): on a site with no resolutions, Jira's agent view can't resolve anything; tell
  the admin to add Done and Declined under Jira settings → Work items → Resolutions. A new desk took about 10
  minutes before its creator counted as an agent.
- Untested live: a refusal for someone who isn't the owner (no second person on toolpassport).
- Demo site state now: KS-DEV back on 13.2 (as the seed). New 14.0 verifications: max upload 5 GB, custom web
  front end Yes (copied from 13.2). Four change rows for KS-DEV (13.2 → 14.0 twice, each with 2 items still
  open; 14.0 → 13.2 twice, listed). Several recent questions carry "May have changed". Phase 4's Reset demo must
  clear these so the video's moment 3 starts clean.

### Next

- Rovo (F8): built, working on the demo site, and **kept** (D43, following the rules page). Still to do, in
  Phase 4: judge instructions with the Rovo prerequisite; the fresh-site run (E9) on a site with Rovo, from
  the production installation link (the human starts the Teamwork Collection trial there), which also
  finishes E8; the video's Rovo clip on the demo site; the Best Agents write-up; delete the draft Studio agent.
- F9 release-note labels: built and working live (D44). Phase 3 is signed off (section above).
- Next: Phase 4 (judge readiness): setup wizard, `seed/demo.ts` and Reset demo, the test screen, README and
  JUDGE_GUIDE (with the Rovo and resolutions notes above), production deploy and installation link, and the
  timed fresh-site runs with and without Assets (E9, on a site with Rovo).
- Still open: the privacy test with Sam signed in; the root commit `6693b75` decision before any push;
  repairing Git Bash on this machine is optional (PowerShell covers everything).

## Phase 4 (judge readiness), started 2026-11-24 on branch `phase-4` (from `phase-3`; human: "Yes, start Phase 4")

Plan, from spec F7 and sections 15-16 compared with what exists: (1) Load demo data makes the Assets records
itself; (2) registry mode for sites without Assets; (3) the demo groups (needs the right scopes, so an install
upgrade, asked first); (4) Reset demo; (5) the Setup page as a guided wizard with model choice; (6) the false-Yes
suite runnable on the Tests screen; (7) README and JUDGE_GUIDE; (8) production deploy, installation link and the
timed fresh-site runs, with the human.

### Works (verified)

- Step 1, Load demo data makes the Assets records: `src/setup/assets-records.ts` (`ensureDemoRecords`, no
  Forge imports; the E1/E2 calls and bodies, which got 201 for every step on the fresh site), `src/setup/forge.ts`
  (as the app or as the signed-in admin; a consent request is thrown so Forge can show its consent screen),
  `src/setup/load-demo.ts` (records first, then `seedDemo` linked to their keys; nothing written if the records
  can't be made). The old read-only `findPassportObjectKey` is gone.
  - Tests first (red: `Cannot find module '../../src/setup/assets-records'`): `setup-assets.test.ts` (7: fresh
    site creates everything with the section 16 values; a repeat creates nothing; a half set-up adds only what is
    missing; app refused → the admin writes; both refused → stops at the first write and names it; no Assets →
    `no_assets`; consent passed up) and `load-demo.test.ts` (4). `npx vitest run`: `Test Files 27 passed (27)`,
    `Tests 393 passed (393)`. tsc exit 0, eslint exit 0, `forge lint`: `No issues found.` Deployed 4.30.0
    (eligible for Runs on Atlassian).
  - Live on the demo site (schema already there): Setup → Load demo data: `Demo data loaded` · `tools: 1 ·
    environments: 2 · catalogKeys: 25 · links: 7 · facts: 6 · rules: 8 · readinessKeys: 2 · accessMappings: 4` ·
    `KS-DEV → TPENV-4679 · KS-PROD → TPENV-4680`, with no "assetsRecordsCreated" count: nothing was created.
    The creating path is proven live only by E2's calls so far; the fresh-site run (step 8) will show it.
- Step 2, registry mode (spec section 16, "Judge path without Assets"): `seedDemo` with `registry` looks nothing
  up in Assets and gives each environment the section 16 values as owner-recorded values (`{ values, recordedAt,
  recordedBy }`); `loadDemoData(…, 'registry')` skips the Assets records; `loadDemo` takes `{ mode }` (zod:
  `assets` or `registry`, default `assets`); Setup has a second button, "Load without Assets (registry mode)",
  and says registry values are weaker evidence. A site without Assets gets "Load the demo data in registry mode
  instead".
  - Tests first: `seed.test.ts` (+3: no Assets lookups and the recorded values; moment 1 answers through the
    real registry provider, labelled `recorded_by_owner`; switching modes keeps the same two environments),
    `load-demo.test.ts` (+1), `resolvers.test.ts` (mode passed, a bad mode refused). `npx vitest run`: `Test
    Files 27 passed (27)`, `Tests 397 passed (397)`; safety `Tests 47 passed (47)`. tsc, eslint exit 0;
    `forge lint`: `No issues found.` Deployed 4.31.0 (eligible for Runs on Atlassian).
  - Live on the demo site (human: "Use the demo site", because toolpassport showed Atlassian's request-access
    page for the account signed in now): "Load without Assets (registry mode)" → `KS-DEV → Recorded by owner ·
    KS-PROD → Recorded by owner`. Ask in KS-DEV "Can I build a custom web front end or dashboard?": **Not
    ready**, `KS-DEV · 13.2`, "Frontend build isn't set up in KS-DEV.", chips `Recorded by owner · Nov 24`,
    `Owner-verified · 13.2`, `Approved · TPD-5`. Then "Load demo data" again → `KS-DEV → TPENV-4679 · KS-PROD →
    TPENV-4680`: the demo site is back in Assets mode. LLM calls: 1 expected (each load moves the catalog
    revision, so the question was translated again).
- Step 3, the demo groups (built and unit-tested; not live yet): `src/setup/groups.ts` (`ensureDemoGroups`: finds
  or creates `kestrel-dev-builders` and `kestrel-prod-deployers`, adds only the person loading to
  kestrel-dev-builders; as the app first, then as the signed-in admin; consent passed up), `forgeGroupsClient`,
  and Load demo data runs it after the data in both modes. If it fails, the load stands and Setup shows "One more
  step" with the exact manual steps. Jira's Create group / Add user to group docs (read in the browser
  2026-11-24): "Site administration (that is, member of the site-admin group)", granular scopes
  `read:group:jira, read:user:jira, write:group:jira, read:avatar:jira`; the app lacked the last two, which
  explains Phase 0's 401, so the manifest adds `read:user:jira` and `read:avatar:jira` (D45).
  - Tests: `setup-groups.test.ts` (5) and `load-demo.test.ts` (+3), written with the code, so mutation checks
    instead of a red first run: existing groups not checked → `1 failed`; joins the wrong group → `2 failed`; no
    admin fallback → `2 failed`; a group failure hidden → `1 failed`; restored, green. `npx vitest run`: `Test
    Files 28 passed (28)`, `Tests 405 passed (405)`; safety 47/47; tsc, eslint exit 0. `forge lint`: one
    approval, `This deployment triggers a major version upgrade … because: Change due to scope modification`.
  - Deploy and upgrade (human: "Yes, both sites"): `forge deploy -e development --approve MAJOR_VERSION_RULE`:
    `Deployed tool-passport to the development environment with 1 approval acknowledged.` 5.0.0, eligible for Runs
    on Atlassian. `forge install --upgrade` on one-atlas-oibs and toolpassport: `√ Upgrade complete!` each;
    `forge install list`: both version 5, `Up-to-date`.
  - **Live on the demo site, 5.0.0:** Load demo data → `Demo data loaded` · `… accessMappings: 4 ·
    groupsCreated: 1` · `KS-DEV → TPENV-4679 · KS-PROD → TPENV-4680`, no warning. Read back in the browser:
    `kestrel-dev-builders` 1 member (the admin, already there, so no "addedToGroup"), `kestrel-prod-deployers`
    0 members: the app made the missing group. Whether it went as the app or as the admin isn't recorded; a
    `[loadDemo] … groups=created=… as=…` log line is added for the fresh-site run.
- Step 4, Reset demo (spec section 16 step 7): `src/setup/reset-demo.ts` (`resetDemo`, no Forge imports),
  `src/db/reset.ts` (`sqlResetStore`: the demo tool by its exact name; 15 DELETEs, each scoped to that tool id
  directly or through its changes and facts, children first; never `tools`, `audit_log` or `app_settings`),
  `resetDemoRecords` in `assets-records.ts` (makes sure the records exist, then one `PUT /object/{id}` each with
  the section 16 values), the `resetDemo` resolver (Jira administrators only) sharing `loadDemoAs` with Load demo
  data, and on Setup a "Reset demo" button that first shows what will be deleted and "This can't be undone",
  then "Yes, reset the demo" / Cancel. Kept: the tool row, audit log, request and approval setup, groups, and
  the Jira requests already raised (their later resolutions find no row and are ignored). If the Assets values
  can't be put back, the reset still finishes and says what to set by hand; if the reload fails after clearing,
  it says to run Reset again.
  - Tests first (red: `resetDemoRecords is not a function`, `Cannot find module '../../src/setup/reset-demo'`,
    `Cannot find module '/src/db/reset'`): `setup-assets.test.ts` (+3), `reset-demo.test.ts` (5),
    `requests-sql.test.ts` (+1: every statement scoped to the tool, order, nothing else touched),
    `resolvers.test.ts` (+1: administrators only). `npx vitest run`: `Test Files 29 passed (29)`, `Tests 415
    passed (415)`; safety 47/47; tsc, eslint exit 0; `forge lint`: `No issues found.` Mutation checks: asks
    cleared for every tool → `1 failed`; registry mode touching Assets → `1 failed`; restored, green. Deployed
    5.2.0 (no scope change).
  - **Live on the demo site, 5.2.0** (human: "Yes, reset it", after signing in again): Setup → Reset demo showed
    the confirmation ("Reset the demo? … This can't be undone." with "Yes, reset the demo" / Cancel); on Yes:
    `Demo data loaded` · `tools: 1 · environments: 2 · catalogKeys: 25 · links: 7 · facts: 6 · rules: 8 ·
    readinessKeys: 2 · accessMappings: 4 · cleared: 119` · `KS-DEV → TPENV-4679 · KS-PROD → TPENV-4680`, no
    warning. Read back in Assets: TPENV-4679 `Version 13.2`, `Build environments standard`, `Features enabled
    uploads, scheduling`; TPENV-4680 `13.2`, `standard, frontend`, `uploads, scheduling, single sign-on`. Ask
    page: no recent questions; "Can I build a custom web front end or dashboard?" in KS-DEV → **Not ready**,
    `KS-DEV · 13.2`, chips `Assets record`, `Owner-verified · 13.2`, `Mapped access · kestrel-de…`, Request the
    fix, `next: Needs design review` (the old `Approved · TPD-5` grant is gone). My tools: `No open questions for
    Kestrel Studio.`, `No version changes yet.` LLM calls: 1 (the cache was cleared).
  - Demo site state now: the clean demo of spec section 16 (plus that one question), ready for the video. The
    Jira requests TPD-1…TPD-8 are still in the desk, unlinked. The draft Rovo Studio agent is still there.
- Step 5, the Setup page as a guided wizard (spec F7, section 13): `src/resolvers/setup-handlers.ts`
  (`handleSetupStatus`: each step done or to do, read with no writes; `handleChooseModel`: only an active Claude
  model from the site's live `list()`, saved with `by: 'setup'`), the `setupStatus` and `chooseModel` resolvers
  (Jira administrators only), and `claudeChoices`, `storedModel`, `chosenInSetup` in `llm/model-choice.ts`. The
  Setup page now has: a checklist at the top (1 Requests, 2 Approvals, 3 Demo data and its mode, 4 Model and
  whether it was picked automatically or chosen here, 5 Tests and the last run), a "Before you start" note
  (Customer role; a new desk takes about 10 minutes; no resolutions → done statuses; Rovo needed only for the
  agent), the sections numbered in that order, the model step, and "Tools" last. Saving a step, loading the demo
  or running the tests refreshes the checklist. One request type serves all three kinds (approval and question
  already fall back to the fix type), and the page says so (D46). The old "arrives in Phase 4" line is gone, and the
  app no longer repeats the page title Jira already shows.
  - Tests: `setup-wizard.test.ts` (9). The model-marker tests were red first (`2 failed | 7 passed`); the rest
    were checked by mutation: admin check removed, any model accepted, a decline-only map counted as done,
    `automatic` always false, the stored choice ignored, the `by` marker ignored, and not saved: every one `failed`;
    restored, green. `npx vitest run`: `Test Files 30 passed (30)`, `Tests 424 passed (424)`; safety `Tests 47
    passed (47)`; tsc, eslint exit 0; `forge lint`: `No issues found.` Deployed 5.3.0, 5.4.0, 5.5.0 (no scope
    change; each eligible for Runs on Atlassian).
  - **Live on the demo site, 5.5.0:** Setup shows `Done` for all five: `1. Requests Service desk and request type
    chosen.`, `2. Approvals Approved when set to "Done".`, `3. Demo data Kestrel Studio loaded with Assets.`,
    `4. Model claude-haiku-5-5, picked automatically.`, `5. Tests Last run Nov 23, 05:09 PM.` (5.3.0 said "chosen
    here" for a model the app had stored by itself on first use; fixed in 5.4.0 with the `by` marker). Model step:
    Save with `claude-haiku-5-5` → `Saved. New questions are read by claude-haiku-5-5.`, the checklist changed to
    `chosen here` without a reload, and Save greyed out. Both pages show their title once. LLM calls: 0.
- Step 6, the false-Yes suite runnable in the app (spec section 19 "also runnable from the Setup screen", P0-7,
  section 18 checklist): the 47 cases now live in `src/safety/cases.ts` as one list, with plain checks in
  `src/safety/assert.ts` (`same`, `like` = toMatchObject, `ok`, `throws`, `includes`) instead of vitest's
  `expect`. `test/safety/false-yes.test.ts` runs that list, and so does Setup → 5. Tests → "Run the false-Yes
  suite" (`runSafety` resolver, Jira administrators only; `src/safety/run.ts` reports every case and carries on
  past a failure). The in-memory worlds moved from `test/support/` to `src/safety/` (the old paths re-export
  them, so no other test changed). Nothing is read from the site and no model is called (D47).
  - Tests first (red: `Cannot find module '../../src/safety/assert'`): `safety-run.test.ts` (9: the helpers
    fail where `expect` would, the list has 47 unique cases covering spec cases 1-13, the runner reports a
    failure with its reason and carries on, the resolver is for administrators only and logs the count).
  - **The conversion lost nothing:** the old suite (from HEAD) and the new one were run side by side under 8
    engine breaks. Failed cases, old / new: combine accepts an empty list 1/1; missing access mapping passes
    1/1; missing policy rule passes 1/1; pending approval passes 4/4; unread groups pass access 1/1; badly typed
    stored fact passes 1/1; the asker's own approval counts 2/2; a group failure on policy says ask owner 2/2.
    Mutations of the new code: the runner hiding a failure, no admin check, `like` ignoring a missing key: each
    `failed`. Restored, green.
  - `npx vitest run`: `Test Files 31 passed (31)`, `Tests 433 passed (433)`; safety `Tests 47 passed (47)`; tsc,
    eslint exit 0; `forge lint`: `No issues found.` Deployed 5.6.0 and 5.7.0 (wording only), no scope change,
    eligible for Runs on Atlassian.
  - **Live on the demo site, 5.7.0:** Setup → 5. Tests → Run the false-Yes suite: `All 47 cases passed` · `No
    case gave a Yes it should not have.`, then 16 rows, each `Passed`, from `combine() refuses an empty check
    list · 1 of 1` through `13. Injection and pressure · 4 of 4` to `Every result that is not a pass says why ·
    1 of 1`. Forge log: `[runSafety] passed=47/47`. LLM calls: 0.
- Step 7, `README.md` and `docs/JUDGE_GUIDE.md`. The README replaces the Forge template: what the app does, how an
  answer is made, the false-Yes suite, the Atlassian parts used, security in short, layout, development commands,
  and every dependency's licence (spec section 2 rows 6 and 16). The judge guide follows spec section 16: what you
  need, install and prepare the site, the five setup steps, moments 1-3, the unknown loop, Rovo (optional), Reset
  demo and a troubleshooting table, with **No Assets?** notes for registry mode at each step.
  - Navigation checked live in the browser on the demo site, because the old wording was wrong: the setup page is
    **Jira settings (gear) → Marketplace apps → sidebar Apps → Tool Passport setup** (the old "Apps → Manage
    apps" now shows "App management has moved to Administration"); the app is **sidebar → Apps → Your apps →
    Tool Passport**; resolutions are under **Jira settings → Work items → Resolutions**; Assets is **Assets →
    Schemas → Tool Passport Environments → Tool Environment → KS-DEV**. The app's own three messages that named
    "Apps → Manage apps" now name the Marketplace apps path (`src/loop/requests.ts`, the Ask page's "No tools
    yet").
  - **Setup's "Before you start" corrected** against the fresh-site notes above: the admin trying the demo needs
    no Customer role (only other askers do); during a new desk's first ~10 minutes, raising requests worked but
    they opened in the customer portal and couldn't be resolved as an agent (the old text said requests "can
    fail"); and a site with no resolutions must get Done and Declined, because Jira's agent view refuses to
    resolve without one (the old text said "Nothing else is needed"). Step 2's no-resolutions message says the
    same.
  - The guide's questions asked live on 5.8.0 in KS-DEV: "Does Kestrel Studio support WebSockets for live
    dashboards?" → **Don't know yet**, `Keep two-way connections open (websockets): No verified answer yet.`,
    one check; "Can I upload a 3 GB file?" → **No**, `the recorded limit on 13.2 is 2 GB; you asked for 3 GB.`;
    "Can I embed my dashboard in an internal page?" → **Don't know yet** (the Rovo step's example). The
    dashboard suggestion → **Not ready** (cached). LLM calls: 3.
  - `npx vitest run`: `Test Files 31 passed (31)`, `Tests 433 passed (433)`; safety 47/47; tsc, eslint exit 0;
    `forge lint`: `No issues found.` Deployed 5.8.0 (copy only), eligible for Runs on Atlassian. A scan of both
    docs found no personal names or emails.
  - **Not yet run end to end:** the whole guide on a fresh site with a timer (step 8, E9), including the parts not
    re-run here: the fix and approval resolves on a site where resolutions were just added, the registry-mode
    edits through My tools → Records, Publish in Open questions, and the version change. The installation link
    goes in at step 8. The guide leaves out the two-asker privacy check until that test is done.
  - Demo site state: four new recent questions from these checks; run Reset demo before recording the video.
  - Open: `package.json` declares MIT but the repo has no LICENSE file (the human decides).
- Step 8, production and distribution (human: "Yes, step 8"), started 2026-11-24.
  - Docs read first (2026-11-24): *Distribute your apps* (deploy to production, then Distribution → Edit →
    "Sharing" for installers outside the owner's organization, choose the Atlassian app, copy the link); *Forge LLMs
    API* (no preview restriction; admins are told at install that the app uses it); *Forge LLMs pricing* ("Forge
    LLMs usage is charged to the developer of the Forge app"; "No free usage allowance"; claude-haiku-5-5 is $0.50
    per million input tokens and $2.50 per million output); *Forge LLM limits* (per installation: 100 requests a
    minute); *User privacy guide* (apps that store personal data must report account IDs every 7 days).
  - `forge eligibility -e development`: `[5.8.0] … is eligible for the Runs on Atlassian program.` `forge deploy -e
    production`: `Deployed tool-passport to the production environment.` · `The version of your app [2.0.0] that was
    just deployed to [production] is eligible for the Runs on Atlassian program.`
  - Distribution (developer console, in the browser): "Sharing with anyone" needs Company/Department, Customer
    support contact and Privacy policy (Terms optional); the first save with them blank was refused, nothing saved.
    The human chose: personal data **No** (D48), Company `Independent developer`, support
    `https://github.com/Viswanvi/tool-passport/issues`, privacy policy `…/blob/main/PRIVACY.md`, no terms. Saved:
    `Distribution status: Sharing with anyone`; Install onto **Jira**; the installation link appeared (in the judge
    guide, step 1). Opened, not installed: the install screen shows `tool-passport · By <owner> (Independent
    developer)`, support and privacy links, the vendor-logs note and the permission list (19 lines, matching the
    manifest scopes). PRIVACY.md now says what the app logs, because the screen tells admins the vendor reads logs.
  - **Public repository** `github.com/Viswanvi/tool-passport` (made by the human, public, empty). Before pushing, a
    scan of all tracked files and all history found: the admin's display name in `docs/ENVIRONMENT.md` (every commit
    since the first), the fake token in the first commit's `.claude/skills/**/evals/` fixtures, a fake `sk-…` key in
    the bundled Forge skill rules, and every commit authored as the machine's git identity (a company address). No
    personal emails, account IDs or real tokens. Fixed locally (e999301: PRIVACY.md, name removed, `.claude/` and the
    starter-kit zip untracked and ignored), then a cleaned copy was built in the scratchpad (never touching this
    repository): every phase-4 commit replayed without `.claude/` and `Claude outputs/`, with the name line replaced,
    authored as the human's GitHub noreply address, dates and messages kept. Checks: final tree identical to phase-4
    (`git diff --stat` empty), 55 commits, 134 files, no matches for the name, the company, the tokens or personal
    email domains in any version of any file, one identity, `dates-equal=True`, `messages-equal=True`. Pushed with
    the human's OK (the first try from this shell could not show GitHub's sign-in; the human signed in through Git
    Credential Manager): `* [new branch] main -> main`. GitHub: head `10dface`, linked to the account; PRIVACY.md and
    Issues load. The spec's byline "@QiBR" was left as the human wrote it.
  - **Timed judge-guide run (E9), 2026-11-25, PASS.** Site: `tp-judge-1`, a new free developer site the human made
    from go.atlassian.com/cloud-dev, plus a Teamwork Collection trial (14 days, started Nov 25, auto-renews to paid
    unless cancelled: **cancel by Dec 8**). Driven in the browser pane following docs/JUDGE_GUIDE.md, clock from
    opening the installation link (08:55:07 UTC):
    - Install from the link (human: "Yes, install it"; ~1.3 min waiting for that OK): `forge install list` →
      `production · tp-judge-1.atlassian.net: Jira · 2 · Up-to-date`. Log: `[lifecycle] migrations applied:
      v001_tools … v024_requests_portal_url`.
    - Desk: the new site opened Jira on "Welcome to Service Collection → Create space"; Basic IT service management,
      Tool Passport Desk (TPD). Resolutions already existed (Done, Won't Do, Duplicate, Declined), unlike toolpassport.
      The site also made its own "Demo service space (DEMO)".
    - Setup (gear → Marketplace apps → Tool Passport setup): checklist `Model: claude-haiku-5-5, picked
      automatically` before anything else (Forge LLM works in production); Requests `Fix requests go to Tool Passport
      Desk (TPD) as "Get IT help".`; Approvals `Saved. Setting an approval request to "Done" approves it.`; **Load demo
      data on a fresh site**: `assetsRecordsCreated: 8 · groupsCreated: 2 · addedToGroup: 1 · KS-DEV → TPENV-1 ·
      KS-PROD → TPENV-2` (log `[loadDemo] mode=assets assets_created=8 groups=created=2 joined=true as=user`): the
      creating path of steps 1 and 3 is now proven live; Assets records read back as section 16. False-Yes suite: `All
      47 cases passed` (log `[runSafety] passed=47/47`).
    - **Moment 1 at 09:02:33: 7.4 min** (6.1 min without the install wait). **Not ready**, "Frontend build isn't set
      up in KS-DEV.", `Assets record`, `Owner-verified · 13.2`, `Mapped access · kestrel-dev-builders`, next "Needs
      design review". KS-PROD: **No**, "Policy for KS-PROD: Not allowed in production."
    - Moment 2: Request the fix → TPD-1; Assets KS-DEV Build environments + frontend; the desk was 6 minutes old, so
      `/browse/TPD-1` opened the customer portal. **Found:** the portal's "Resolve this issue" works at once and set
      `Resolved with resolution Done`; within seconds the app commented `Answer now: Yes, with approval.` (sweep
      `requests looked=1 rechecked=1`). Request approval → TPD-2, resolved the same way → `Answer now: Yes.` (log
      `[issue-event] TPD-2 rechecked`): the owner resolving counts. Moment 2 done at 09:07:45. The guide and Setup's
      "Before you start" now say to use Resolve this issue instead of waiting.
    - Unknown loop: "Does Kestrel Studio support WebSockets for live dashboards?" → Don't know yet → Ask the owner →
      TPD-3 → Open questions, Yes · All environments · Holds for every version → `Published. Answered and closed:
      TPD-3. Still open: 0.`
    - Moment 3: "Can I upload a 3 GB file?" KS-DEV **No** (`the recorded limit on 13.2 is 2 GB`); Assets Version 14.0;
      again **Don't know yet** (`Verified on 13.2; KS-DEV runs 14.0`); Changes `KS-DEV: 13.2 → 14.0 · Found in Assets
      record`, `Building the list…` until the sweep (`[sweep] … lists listed=1` at 09:15:47), then 4 facts to
      re-verify, `Not listed: 3`, `Policy rules untouched: 8`, `Other environments untouched: KS-PROD (13.2)`. Still
      true on 14.0 (web front end), Changed → 5 (upload) → the 3 GB question **Yes**, `Owner-verified · 14.0`;
      recent questions show *May have changed*.
    - **Rovo (E8 second site): not possible here.** Hours after the trial started, tp-judge-1 had no Ask Rovo button;
      Administration lists Jira, Confluence and Loom on Teamwork Collection Standard but no Rovo app, and Rovo access
      says nothing is blocked. The guide now says the Rovo part needs a site that already has Rovo.
    - Guide fixes from the run (docs/JUDGE_GUIDE.md): the new-site "Create space" path, resolutions may already exist,
      Assets "3 more attributes", resolve from the portal, the Changes list can take up to 5 minutes, the Rovo note.
      Setup copy changed to match (not yet deployed).
    - LLM calls in the run: 3 (dashboard, WebSockets, 3 GB; everything else cached). The browser session expired once
      mid-run; the human signed in again.
  - Then (human: "Yes, both"): Setup copy deployed to development 5.9.0 and production 2.1.0 (no scope change);
    guide and records pushed, GitHub `main` 65b891b..6ea7a86. Left for the human: cancel the tp-judge-1 trial by
    Dec 8.

### Phase 4 sign-off checks (2026-11-25; human: "Yes, sign-off checks")

Steps 1-8 are done (Setup wizard D46, demo seed and Reset, the false-Yes suite in the app D47, README and judge
guide, production and distribution D48, the timed fresh-site run). Branch `phase-4`, code at `5ee8b53`.

Results, verbatim:
- `npx vitest run`: `Test Files 31 passed (31)`, `Tests 433 passed (433)`. `npx vitest run test/safety`: `Tests 47
  passed (47)`. `npm run typecheck`: exit 0. `npm run lint`: exit 0.
- `forge lint`: `No issues found.`
- `forge eligibility -e development`: `The version of your app [5.9.0] that's deployed to [development] is eligible
  for the Runs on Atlassian program.` `forge eligibility -e production`: `The version of your app [2.1.0] that's
  deployed to [production] is eligible for the Runs on Atlassian program.`
- `forge install list`: production on tp-judge-1 (version 2), development on toolpassport and one-atlas-oibs
  (version 5), all `Up-to-date`.
- Deployed = committed: `git diff --stat 5ee8b53 -- src manifest.yml package.json package-lock.json` is empty.
- Searches: `external`/`remotes` in manifest.yml: 0. `participant`/`emailAddress`/`displayName` in src: 0. Token or
  password patterns in src and test: 0. Writes outside `setup/` and `seed/`: one, `src/loop/jsm-forge.ts:41`, the
  request loop assigning a Jira request to its owner (not Assets); the only other Assets call there is the AQL read
  (`src/providers/forge.ts:44`, a POST that only reads). Account ids read from a resolver or Rovo payload: 0. The
  `src/safety/` code is called only by the `runSafety` resolver (the other two imports are types).

Section 14 self-review, what Phase 4 changed (the earlier tables still hold):

| Risk | Added in Phase 4 | Proven by |
| --- | --- | --- |
| A false Yes from missing data | The false-Yes suite runs in the app on the build's own case list (D47) | `safety-run.test.ts`; old and new suites failed the same cases under 8 engine breaks; live 47/47 in development and production |
| Someone other than the owner changes a fact, rule or mapping | `loadDemo`, `resetDemo`, `setupStatus`, `chooseModel` and `runSafety` all check Jira administrator on the server (`mayAdminister`) before anything else | `resolvers.test.ts` (loadDemo, resetDemo refuse a non-administrator), `setup-wizard.test.ts`, `safety-run.test.ts`; mutation checks removing the check from setupStatus, chooseModel and runSafety → red |
| A request pretends to be someone else | The new resolvers take no account id: `loadDemo` {mode}, `chooseModel` {model}, the rest nothing | Search above; zod payloads |
| The app changes environments | Assets writes (schema, type, attributes, the two records, Reset putting values back) and group writes only in `src/setup/` and `src/seed/`, behind the administrator check; Reset deletes only rows of the demo tool, never `tools`, `audit_log` or `app_settings` | Search above; `setup-assets.test.ts`, `setup-groups.test.ts`, `reset-demo.test.ts`, `requests-sql.test.ts`; live on a fresh site |
| Scope creep | Two scopes added, `read:user:jira` and `read:avatar:jira`, because Jira's group APIs list them (D45); no others | manifest; install screen lists 19 permissions |
| One asker's question leaks to another | Unchanged in Phase 4. The two-asker privacy test (section 19) still needs Sam signed in | Open |
| Data kept longer than needed / what is stored | PRIVACY.md states it; logs hold no question text, names or account ids; personal data declared No (D48) | Log line review; PRIVACY.md |
| Data leaves Atlassian | Still no egress; production eligible for Runs on Atlassian; the public repository has no personal data in any version (D48) | `forge eligibility` above; history scans before each push |

Spec checklist (section 18, Phase 4): Setup wizard ✓ (one request type for all kinds, D46); Load demo data and Reset
demo through the real APIs ✓ (loading proven from scratch on tp-judge-1; Reset on the demo site); test screen runs
both sets ✓; suggested questions ✓; written judge path tested on a fresh site ✓ **with Assets** (E9).

**Registry-mode run on the fresh site (2026-11-25, human: "Yes, registry check", "Yes, reset tp-judge-1"),
untimed, production 2.1.0:** Setup → Load without Assets (registry mode): `KS-DEV → Recorded by owner · KS-PROD →
Recorded by owner`, checklist `Kestrel Studio loaded in registry mode.`; Reset demo kept the mode (`cleared: 87`).
Moment 1: **Not ready**, chip `Recorded by owner · Nov 25`. Moment 2: Request the fix → TPD-4; My tools → Records →
Environments → Add or change, KS-DEV, Recorded by the owner, the guide's three lines → `Saved.`; TPD-4 Resolve this
issue → `Answer now: Yes, with approval.`; Request approval → TPD-5 → `Answer now: Yes.` Moment 3: 3 GB **No**
(`Recorded by owner`); KS-DEV saved again with `Version: 14.0` → Changes (after Refresh) `KS-DEV: 13.2 → 14.0 ·
Recorded by owner`, KS-PROD untouched; 3 GB **Don't know yet** (`Verified on 13.2; KS-DEV runs 14.0`). The Still
true / Changed steps are the same code in both modes and passed in the Assets run. LLM calls: 2.
Found: the suggested questions after a reset come in a different order (catalog rows come back in another order),
so the guide now says "or type it"; Changes needs Refresh after a save on the same tab (guide says so). With fast
automated typing the UI Kit TextArea dropped lines (each change round-trips to the app); typing slower worked, and
a person typing or pasting is not expected to hit it.

**Privacy test (spec section 19), 2026-11-25, PASS** (human: "Privacy test with Sam"; demo site, development 5.9.0).
Priya (the admin, in the browser pane) asked "Does Kestrel Studio support WebSockets for live dashboards?" in KS-DEV →
Don't know yet → Ask the owner → **TPD-9**. Sam, signed in by the human in a private window, asked "Can my dashboard
keep a live two-way connection open to the server?" → the same unknown (`Keep two-way connections open
(websockets)`) → Ask the owner → **TPD-10**, its own request. Sam's page had no My tools tab and listed only Sam's
question; Priya's listed only hers. Read back as the owner through Jira's REST API: different reporters (each raised
for its asker), same assignee (the owner); both descriptions hold only the requirement ("Someone asked … What they
want to do: Keep two-way connections open (websockets)"), neither asker's wording; **participants 0** on both; Sam's
request never contains Priya's account id. Owner view: one group, `Asked in KS-DEV · 2 open requests · TPD-9 ·
TPD-10`, no wording. One Publish (Yes, all environments, every version): `Published. Answered and closed: TPD-9,
TPD-10. Still open: 0.`; both `Resolved / Done`, each with the same public comment `The tool owner answered in Tool
Passport. Answer now: Yes. Everything this needs is in place in KS-DEV.`, participants still 0. Logs: `[ask] … cached=true`
(Priya), `[ask] … cached=false model=claude-haiku-5-5` (Sam), `[request] question raised=1` twice, `[publish] websockets
settled=2 open=0`. LLM calls: 1.

**Phase 4: every item now passes** (Setup wizard, demo seed and Reset, the test screen, README and judge guide, the
timed fresh-site run with Assets, registry mode on a fresh site, the privacy test). Open for submission: the video,
the Devpost text and Best Agents write-up, the Devpost form, a LICENSE file (the human decides), and cancelling the
tp-judge-1 trial by Dec 8. Also open for submission: the video, the Devpost text
and Best Agents write-up, a LICENSE file (the human decides), and cancelling the tp-judge-1 trial.

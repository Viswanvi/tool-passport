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
- Steps 3-4: the remaining 20 eval questions and the run of all 40; Rovo (decide Dec 7).

### Waiting on the human

- Still open: before any push, decide whether to rewrite root commit `6693b75` (D9). Branches `phase-0`,
  `phase-1` and `phase-2` are local only.

### Next

- Step 3: the remaining 20 eval questions (pairs, outside, injection, environment), an admin-only "Run tests"
  runner, and one run of all 40 against the real model (about 40-80 calls, roughly $0.05; ask first).

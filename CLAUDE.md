# Tool Passport — instructions for Claude Code

You are building **Tool Passport**, an Atlassian Forge app for Codegeist 2026 (category: Apps for Software Teams).
The full specification is `docs/tool-passport-v2.1.md`. It is the source of truth. Read all of it before writing code,
and re-read the relevant section before starting each feature.

- Submission target: **Dec 20, 2026**. Hard deadline: Dec 22, 2026, 12:00 PM PT.
- Judging tests the app on a judge's own site. A working, honest, installable app beats a bigger unfinished one.

## What the product does (one paragraph)

An employee asks "can I do X with tool T in environment E?". The model maps the question to catalog keys and values
only. Code expands those keys into four checks (capability, policy, readiness, mapped access) and evaluates them with
fixed rules. Every result carries a label naming its evidence source. Missing input is **Not verified**: never a pass,
never a fail. Blocked answers lead to a private JSM request (fix, approval, or question) raised for the asker; resolution
triggers a re-check. Facts are verified per tool version, so a version change in one environment stops the app vouching
for the affected facts there only.

## Non-negotiable rules

1. **Never produce a false Yes.** Write `test/safety/false-yes.test.ts` (spec section 19) *before* the evaluator and
   keep it green. Any change that fails it is not done. `combine()` must refuse an empty check list.
2. **The model never decides.** It returns catalog keys and values only. Comparisons come from `catalog_keys`. Which
   checks run comes from `capability_links`. The model never sees facts, rules, environment values or groups.
3. **Identity comes from the Forge context only.** No resolver or Rovo action accepts an account ID from the payload.
   Request content is rebuilt from the stored ask on the server, never taken from the browser.
4. **Owner-only writes, enforced on the server.** Every write resolver checks tool owner or Jira administrator.
5. **No egress.** Never add `permissions.external` or remotes. Run `forge eligibility` before every phase sign-off.
   The app must stay Runs on Atlassian.
6. **No fake behaviour.** No hard-coded screens, no mocked "live" results in the shipped app, no demo-only code paths.
   Demo data is created through the same APIs a customer would use (`seed/demo.ts`).
7. **Don't invent APIs.** Forge module names, manifest fields, `@forge/*` SDK shapes and Atlassian REST endpoints must be
   checked against current docs (use the Forge skills and the Forge MCP server installed in this project first, then
   developer.atlassian.com), `forge lint`, or a real call. The spec marks several as
   unconfirmed (list below). When unsure, write a small experiment, run it, and record the result.
8. **Report honestly.** Say "verified" only for something you ran and saw work; paste the command and the key output
   into `docs/STATUS.md`. Otherwise say "untested". Never summarise a failing or skipped test as passing.
9. **No third-party product names** in demo data, UI copy or seed content (video trademark rule). Use the spec's fictional
   names: Acorn Bio, Kestrel Studio, Kestrel Labs, KS-DEV, KS-PROD, Marco, Priya, Sam.
10. **No secrets in the repo.** No API tokens, passwords or personal emails in code, tests, fixtures or logs.

## Environment (set up by the human; see SETUP.md)

- This folder was created by `forge create` (Jira global page, UI Kit) and is the Forge app root. Keep its
  `app.id` in `manifest.yml`; never run `forge register` or create a second app.
- Development and testing happen on the Forge **demo site** recorded in `docs/ENVIRONMENT.md`
  (`forge install --demo-site`, later `forge install --upgrade`). Never run `forge site provision` again.
- The Forge CLI is already logged in on this machine. Never read, print or store the API token, and never put
  credentials in files or commit messages.
- Run `bash scripts/check-prereqs.sh` at the start of each session; if it fails, fix or report before coding.
- Deploy only to the development environment until Phase 4. Production deploy and sharing are done with the human.
- LLM calls cost money: don't run the 40-question set in loops; run it on demand and report the count of calls.

## Stop and ask the human when

- A step needs an interactive login, a browser, a site URL, admin rights on a site, or a second user account.
- An experiment result changes the design (especially E1: which Assets read path works).
- The spec is ambiguous or contradicts itself, or a Forge/Atlassian API behaves differently from the spec.
- You want to add scope, a dependency with network access, or anything on the "out of scope" list.
- You would need to weaken a rule above to make something work.

Ask one concise question with your recommended answer. Don't stall waiting on things you can do in parallel.

## Tech choices

- **Language:** TypeScript (strict). The spec's JavaScript snippets are reference logic, not copy-paste code;
  where the spec names a `.js` file, use the `.ts` equivalent.
- **UI:** Forge UI Kit (`render: native`), as in spec section 9.
- **Storage:** Forge SQL with migrations (`migrationRunner`). No transactions exist: every multi-step write must be made
  of statements that are safe to repeat (spec sections 10 and 11).
- **AI:** `@forge/llm`. Pick the model at setup from `list()` using a preference list; never hard-code a model ID.
- **Tests:** vitest. `src/engine/` has **no Forge imports**; repositories, providers and the LLM client are passed in,
  so the core runs in plain unit tests with fakes.
- **Validation:** zod for the translation schema and resolver payloads.
- Follow the code layout in spec section 9. Keep functions small; comment *why*, not *what*.

## Things the spec marks as unconfirmed (verify before relying on them)

- `rovo:agent` fields and the reusable `action` module name and fields (`actionVerb`).
- `scheduledTrigger` with `interval: fiveMinute` (E10).
- `@forge/llm` `list()` and `chat()` shapes; reply text at `choices[0].message.content` (E4).
- Assets: workspace lookup `/rest/servicedeskapi/assets/workspace`; AQL through `requestJira` `/jsm/assets/workspace/{id}/v1/...`;
  which of app context, user context, and impersonation (`asUser(accountId)` + `allowImpersonation`) works for an
  employee with no Assets role (E1); object `updated` time and history (E3).
- `raiseOnBehalfOf` for app-raised requests, assignment, and whether the issue-updated event carries the resolution name (E5).
- Group reads: `/rest/api/3/myself?expand=groups` as the user, and an app-context equivalent (E6).
- Manifest scopes map form with `allowImpersonation` (keep those two scopes only if E1/E6 need them).

## Phases (each ends with a sign-off; don't start the next until it passes)

### Phase 0 — scaffold and experiments (Nov 20–23; design decision by **Nov 23**)

Schedule note: setup finished on Nov 20, three days later than the spec's timeline, so Phase 0 is compressed and the
Assets decision moves from Nov 19 to Nov 23. Phase 1 still starts Nov 24. Where the spec says Nov 19, read Nov 23.

1. Create the Forge app skeleton (Jira global page + admin page, UI Kit), manifest per spec section 9, SQL module and
   migrations for every table in section 10.
2. Set up vitest, lint, and `npm test` running unit + safety suites.
3. Write experiments E1–E10 (spec section 7) as throwaway functions under `experiments/`, each runnable on its own.
   Record each result in `docs/experiments.md`: what you ran, raw output, pass/fail against the spec's bar, and the
   implication.
4. **STOP after E1, E2, E4, E5, E6** and report. The human decides the Assets read path (or registry-first) by Nov 23.

Sign-off: app deploys to the development environment, `forge lint` clean, `forge eligibility` reports Runs on
Atlassian, experiments documented.

### Phase 1 — the answer engine and moment 1 (Nov 24–30)

Order matters: tests first.

1. `test/safety/false-yes.test.ts` with all 13 cases from spec section 19, failing at first.
2. Pure engine: `catalog`, `select` (`mostSpecific`), `expand`, `evaluate` with its four checks plus `unlinked`,
   `verdict` (`combine`), version `normalise`. Make the safety suite and unit tests pass.
3. `translate` with the three outcomes (`ok`, `unsupported`, `failed`) and the translation cache; test with a fake LLM.
4. Providers behind one interface: Assets (the path chosen in Phase 0, mapped attributes only, record time,
   absent vs empty) and registry; group reader returning `{ ok, names }`.
5. Ask resolver (identity from context), the verdict card and the Ask page (spec section 15 card rules).
6. Guided fix: `loop/requests.ts` (kind `fix`), `loop/events.ts`, Re-check button, card polling, sweep.
7. First 20 questions of the 40-question set (`test/eval/questions.json`).

Sign-off: moment 1 works on the development site by Nov 26; the fix loop reaches "Yes, with approval" by Nov 30;
safety suite 100%; unit tests green.

### Phase 2 — approvals, Ask the owner, optional Rovo (Dec 1–7)

1. Approvals through the same request loop; resolution mapping in setup; an unmapped resolution never approves.
2. Ask the owner: private question request, owner answer form, `publishAnswer`, re-check of open questions.
3. Remaining 20 eval questions; run E4's accuracy bar (≥ 90% exact keys and values; 100% unsupported marked).
4. **Only if P0-1 to P0-4 pass on a fresh site:** Rovo `check-tool-readiness` and `ask-tool-owner` (spec F8).
   Decide keep or drop on Dec 7 (cut rule 2).

### Phase 3 — version validity (Dec 8–14; feature freeze Dec 11)

1. `fact_versions`, read-time version comparison, `noteVersion` with baseline-keyed changes and compare-and-set,
   `buildRecheckList`, Changes screen with "Still true" and "Changed", "may have changed" badges.
2. Change-detection test (spec section 19): parallel detection, crash between insert and version update, rollback.
3. Release-note labels (F9) only if the above is done by Dec 10.
4. From Dec 11: fixes, polish and tests only.

### Phase 4 — judge readiness (Dec 15–20; code freeze Dec 15)

1. Setup wizard: service desk, request types, resolution mapping, Assets schema or registry mode, model choice.
2. `seed/demo.ts` and Reset demo creating the exact data in spec section 16, through real APIs.
3. Test screen that runs the eval set and the false-Yes suite and shows results.
4. `README.md` and `docs/JUDGE_GUIDE.md`: install link steps, with-Assets and registry-mode paths, suggested questions.
5. Fresh-site runs with and without Assets, timed (E9 target: moment 1 within 10 minutes).

## Out of scope (do not build)

HTTP test-environment provider, any vendor connector, any outbound fetch, the shared-question model, the vendor step,
staged-change locks/steps/queue consumer, metrics view, Teamwork Graph, MCP, Confluence pages, Marketplace listing.

## Working habits

- Work in small, reviewable commits on a feature branch with clear messages. Don't push or deploy to production unless asked.
- Keep three living files current:
  - `docs/STATUS.md`: what works (verified how), what doesn't, what's next. Update at the end of every session.
  - `docs/DECISIONS.md`: every deviation from the spec, with the reason and the evidence.
  - `docs/experiments.md`: E1–E10 results.
- Before declaring any phase done: run the unit tests, the safety suite, `forge lint` and `forge eligibility`, and do a
  self-review against the security table in spec section 14. Report the results verbatim.
- If you change behaviour the spec describes, update `docs/DECISIONS.md` in the same commit.

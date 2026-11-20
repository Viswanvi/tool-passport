# Status

"Verified" = ran it and saw it work, with the command and key output below. Everything else is "untested".

## Phase 0 (scaffold and experiments), started 2026-11-20

### Works (verified)

- Hello-world global page loaded on the demo site (seen by the human in Jira, 2026-11-20).
- `bash scripts/check-prereqs.sh` (Git Bash): `Result: 18 passed, 0 warnings, 0 failed` after excluding skill eval
  fixtures from the token scan (DECISIONS D9).
- `npx tsc --noEmit` exit 0; `npx eslint "src/**/*.{ts,tsx}" "test/**/*.ts"` exit 0;
  `npx vitest run`: `Test Files 2 passed (2) · Tests 10 passed (10)`.
- `forge lint`: `No issues found` (plus the expected MAJOR_VERSION_RULE approval for new scopes, sql and llm).
- `forge deploy -e development --non-interactive --approve MAJOR_VERSION_RULE`: `Deployed tool-passport to the
  development environment` (version 3.0.0).
- `forge eligibility -e development --non-interactive`: `version [3.0.0] ... is eligible for the Runs on Atlassian program`.

### Not done / untested

- The demo-site installation is still on version 2 (hello world). `forge install --upgrade` is waiting for the
  human's approval (it grants the new scopes). Until then, migrations, the sweep (E10) and E1 have not run.
- SQL migrations have never run on a real Forge SQL database: untested.
- E1-E10: not run (docs/experiments.md).

### Next

1. Human approves `forge install --upgrade` (scopes listed in the session).
2. Lifecycle event runs migrations; the sweep starts (E10 clock starts).
3. E1 as the admin: "E1 · Create test schema (admin)", then "E1 · Read as me" on the Tool Passport page.
4. Stop at the first step needing Sam or the fresh site (E1 non-admin read, E6, E5, E2).

### Waiting on the human

- Approval for `forge install --upgrade` on the demo site.
- Second account (Sam): Jira + JSM customer access only, no Assets role, not an agent on TPD.
- Free Atlassian Cloud developer site (E2, E8, E9, fresh-site checks).
- Payment method on the Developer Space, then cost approval, before any LLM call (E4).
- Before any push to a remote: the root commit `6693b75` still contains the skill eval fixtures (fake token);
  decide whether to rewrite it (DECISIONS D9).

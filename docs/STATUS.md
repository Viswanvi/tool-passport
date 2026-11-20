# Status

"Verified" = ran it and saw it work, with the command and key output below. Everything else is "untested".

## Phase 0 (scaffold and experiments), started 2026-11-20

### Works (verified)

- Hello-world global page loads on the demo site (seen by the human in Jira, 2026-11-20).
- `bash scripts/check-prereqs.sh` (Git Bash): 17 passed, 1 failed before the fix; the failure was a fake token in a
  Forge skill eval fixture (see DECISIONS D9).

### Not done / untested

- Everything in Phase 0 steps 1-4.

### Next

- Step 0 housekeeping, Step 1 scaffold, E10, E1 as the admin. Stop at the first step that needs Sam or the fresh site.

### Waiting on the human

- Second account (Sam): Jira + JSM customer access only, no Assets role, not an agent on TPD.
- Free Atlassian Cloud developer site (for E2, E8, E9 and fresh-site checks).
- Payment method on the Developer Space before any LLM call (E4).

# First message to paste into Claude Code

Paste the block below as your first message, from inside the app folder, after SETUP.md is complete.

```
Read CLAUDE.md, docs/ENVIRONMENT.md and all of docs/tool-passport-v2.1.md before doing anything else.
Setup is done: the Forge CLI is logged in, the demo site is provisioned, and this folder was created with
forge create (Jira global page, UI Kit) and installed once as hello world. Run bash scripts/check-prereqs.sh
and show me the result.

Then, before writing any code, reply with:
1. Your understanding of the product and the non-negotiable rules, in 10 bullets.
2. Any contradictions, gaps or risky assumptions you found in the spec, each with your recommended resolution.
3. Your Phase 0 plan: the exact Forge CLI commands, the order of experiments E1–E10, and which steps need me.

Do not start coding until I confirm the plan. After I confirm, work through Phase 0 and stop after E1, E2, E4,
E5 and E6 with the results recorded in docs/experiments.md, so we can make the Assets decision by Nov 23.
```

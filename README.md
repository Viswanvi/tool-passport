# Tool Passport

An Atlassian Forge app for Jira and Jira Service Management, built for Codegeist 2026 (Apps for Software Teams).

Employees ask **"Can I do X with tool T in environment E?"**, for example *"Can I build a custom web dashboard with
Kestrel Studio in KS-DEV?"* Tool Passport answers from recorded evidence and names the source of every piece:

- **Yes**, **Yes, with approval**, **Not ready**, **No**, or **Don't know yet**, with the reason;
- one line per check, each labelled with its evidence: *Assets record*, *Owner-verified · 13.2*, *Policy rule*,
  *Mapped access*, *Approved*, or *Not verified* when nothing is recorded;
- the next step: **Request the fix**, **Request approval** or **Ask the owner**, each a private Jira Service
  Management request raised for the person asking. When it's resolved, the answer updates by itself.

Facts are verified per tool version. When an environment moves to a new version, Tool Passport stops vouching for
the facts that depend on the version in that environment only, and the owner re-verifies them on one screen.

**Judges:** start with [docs/JUDGE_GUIDE.md](docs/JUDGE_GUIDE.md). It covers installing, setup, the demo with and
without Assets, and the optional Rovo agent.

## How an answer is made

1. **Translate.** The model reads the question and returns catalog keys and values only, such as `web_frontend` or
   `max_upload_gb = 3`. It never sees facts, rules, environment values or groups, and it never decides the answer.
   A question outside the catalog is *Don't know yet*.
2. **Expand.** Code adds every check the capability is linked to: capability, policy, readiness and mapped access.
   The model can't skip one.
3. **Evaluate.** Each check runs against its own evidence with fixed rules: the environment's Assets record (or
   owner-recorded values), owner-verified facts for the version the environment runs, policy rules, approvals, and
   the asker's Jira groups.
4. **Combine.** Missing input is **Not verified**: never a pass, never a fail. A deny beats an approval, which beats
   an allow.

## Never a false Yes

The **false-Yes suite** holds 47 cases. Each takes away one piece of evidence from a question whose answer is Yes
(an access mapping, a policy rule, a group lookup, a readable record, a verified fact), or adds pressure such as
"my manager approved this", and the answer must then be anything but Yes. The build runs it
(`test/safety/false-yes.test.ts`), and so can any Jira administrator, from Setup → Tests. Both run the same case
list in [src/safety/cases.ts](src/safety/cases.ts).

## Built with

| Part | What it does |
| --- | --- |
| Forge UI Kit: `jira:globalPage`, `jira:adminPage` | The Ask page and My tools; the setup page with its checklist |
| Forge resolvers | Every action; the signed-in person always comes from the Forge context, never from the request |
| Forge SQL with migrations | Tools, catalog, facts and their versions, rules, mappings, asks, requests, changes, audit log |
| Forge LLM | Question translation and optional release-note labels; the model is picked from the site's live list |
| Jira Service Management REST | Private requests raised for the asker, assigned to the owner |
| Jira issue events and a 5-minute scheduled trigger | Re-check an answer when its request is resolved; notice version changes |
| Assets REST | Environment records read as the app (AQL); setup creates the demo schema and records |
| Jira groups | Mapped access; setup creates the demo groups |
| Rovo: `rovo:agent`, two `action` modules, `rovo:mcp` | The Tool Passport agent, and a readiness check other agents can reuse |

The app runs entirely on Atlassian: no `permissions.external`, no remotes, nothing fetched from outside. Every
deploy is reported eligible for the Runs on Atlassian program.

## Security in short

- Identity comes only from the Forge context. Request content is rebuilt on the server from the stored question.
- Writes are for the tool owner or a Jira administrator, checked on the server; refusals are audited.
- Requests are private to the person asking. Approvals count only when the approver decides them.
- Environments can be limited to a group; people outside it can't pick or query them.

## Project layout

| Path | Contents |
| --- | --- |
| `src/engine/` | The answer engine: catalog, translation, expansion, evaluation, verdicts, the card. No Forge imports |
| `src/loop/` | The request loop: fix, approval and question requests, events, the sweep |
| `src/providers/` | Assets and registry environment readers, group reader |
| `src/registry/` | Owner and administrator writes, with the server-side permission check |
| `src/change/` | Version changes and release-note labels |
| `src/eval/` | Scoring for the 40-question translation set (the questions are in `test/eval/questions.json`) |
| `src/llm/` | Model choice and the Forge LLM client |
| `src/rovo/` | The Rovo actions |
| `src/setup/`, `src/seed/` | Setup: Assets records, demo groups, demo data, reset |
| `src/safety/` | The false-Yes cases and their in-memory test data, shared by the build and the app |
| `src/db/` | Forge SQL repositories and migrations |
| `src/resolvers/`, `src/frontend/` | Resolver wiring and the UI Kit screens |
| `test/` | Unit tests, the safety suite runner and the 40-question set |
| `docs/` | Judge guide, [specification](docs/tool-passport-v2.1.md), [decisions](docs/DECISIONS.md), [status](docs/STATUS.md), [experiments](docs/experiments.md) |

## Development

Needs Node.js and the Forge CLI, logged in.

```sh
npm install
npm test               # unit tests and the false-Yes suite (vitest)
npm run typecheck
npm run lint
forge lint
forge deploy -e development
forge install          # first time, on your development site
```

The core runs in plain unit tests: repositories, providers and the model are passed in, so `src/engine/` needs no
Forge runtime.

## Licences

Tool Passport's own code is released under the MIT licence, as declared in `package.json`. It uses:

| Package | Licence |
| --- | --- |
| `@forge/api`, `@forge/bridge`, `@forge/llm`, `@forge/react`, `@forge/resolver`, `@forge/sql` | Atlassian Developer Terms |
| `react`, `zod` | MIT |
| Development only: `vitest`, `eslint`, `@typescript-eslint/*`, `eslint-plugin-react-hooks`, `@types/node`, `@types/react` | MIT |
| Development only: `typescript` | Apache-2.0 |

All names in the demo (Acorn Bio, Kestrel Studio, Kestrel Labs, KS-DEV, KS-PROD, Marco, Priya, Sam) are fictional.

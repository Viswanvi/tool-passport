# Tool Passport

An Atlassian Forge app for Jira and Jira Service Management, built for Codegeist 2026 (Apps for Software Teams).

**Not a chatbot. A passport that keeps itself true as your tools change.**

Before the sprint starts, know if your story can ship. Tool Passport opens on each person's **passport**: every
capability of a tool against every environment, checked as them. While it is open it checks itself again every 30
seconds, so when an environment upgrades, the answers that relied on the old version turn *Don't know yet* on
screen, marked with what they were, without anyone asking. Behind every cell is the answer to **"Can I do X with
tool T in environment E?"**, for example *"Can I build a custom web dashboard with Kestrel Studio in KS-DEV?"*,
answered from recorded evidence with the source of every piece named:

- **Yes**, **Yes, with approval**, **Not ready**, **No**, or **Don't know yet**, with the reason;
- four **passport stamps**, one per check (the tool can do it, policy allows it, set up here, you have access),
  each labelled with its evidence: *Assets record*, *Owner-verified · 13.2*, *Policy rule*, *Mapped access*,
  *Approved · until* a date, or *Not verified* when nothing is recorded. A stamp shows Yes only when every check
  under it passed;
- the **path to Yes** and the next step: **Request the fix**, **Request approval** or **Ask the owner**, each a
  private Jira Service Management request raised for the person asking. When it's resolved, the answer updates by
  itself, and the card says what changed.

More ways in:

- **Ask:** the same answer for a question in your own words. The AI only reads the question into the tool's own list;
  fixed rules decide. The Passport itself makes no model call; click a cell for its card.
- **My tools**, for a tool's owner: *Needs you* counts the open questions, the facts to re-check after an upgrade and
  the capabilities nobody has verified, and *Fill in from your docs* drafts facts from pasted documentation, each with
  the line that proves it.
- **Check this story:** a panel on any Jira work item. It reads the story as you, suggests the environment the story
  names, and answers before the sprint starts, with Request the fix right there. **Add to story** posts the answer,
  its stamps and the path to Yes as your comment. When the answer changes, the app adds the new one to the story by
  itself and says why: the fix request was resolved, the environment moved to a new version, or the owner
  re-verified the facts.
- **The help center:** where people already go for help, a box asks *Before you raise a request: can you already do
  it?* It gives the same card, checked as them, so a request that can't be fulfilled is never raised and the right
  one is raised for them. Service desk customers can use it too. It is off until a Jira administrator turns it on.
- **What if we upgrade?:** before an environment moves to a new version, the owner sees which facts would need
  re-verifying and how many recent answers rely on them. Nothing is saved.

Setup is one click: the setup page proposes the desk, request type, approval outcomes, the demo data and the help
center box, and sets them when you click. Without a service desk yet, it loads the demo so you can ask at once.

**AI where it helps, rules where it matters.** Every answer shows the AI's part: *AI read your question as* the
tool's own capability names, next to *Rules decide*. The model reads; it never decides.

**Keeping it current costs owners little.** The work that makes answers trustworthy is small and the app does most
of it:

- **Environments** come from Assets records the company already keeps; nobody re-types them.
- **Facts are drafted by AI from the tool's own documentation** (*Fill in from your docs*): paste a page and the AI
  drafts each fact it states, with the exact line that proves it. Drafts whose line isn't really in the text are
  dropped. The owner clicks Accept; nothing is saved before that.
- **Each fact is verified once per version.** After an upgrade the app lists exactly which facts to re-check, and AI
  suggests a label for each from the release notes. One click per fact.
- **Questions arrive grouped.** The owner answers a question once and everyone who asked gets the answer.

Facts are verified per tool version. When an environment moves to a new version, Tool Passport stops vouching for
the facts that depend on the version in that environment only, and the owner re-verifies them on one screen.

Approvals can expire. The owner sets how many days an approval counts for each rule; after that the answer asks for
approval again ("Your approval TPD-7 has expired") instead of saying Yes forever.

**Judges:** start with [docs/JUDGE_GUIDE.md](docs/JUDGE_GUIDE.md). It has the installation link and covers setup,
the demo with and without Assets, and the optional Rovo agent.

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

The **false-Yes suite** holds 51 cases. Each takes away one piece of evidence from a question whose answer is Yes
(an access mapping, a policy rule, a group lookup, a readable record, a verified fact, an approval still in date),
or adds pressure such as "my manager approved this", and the answer must then be anything but Yes. Two more check
the screens: no passport stamp shows Yes over a check that did not pass, and no cell of the Passport grid says Yes
where Ask would not. The build runs it
(`test/safety/false-yes.test.ts`), and so can any Jira administrator, from Setup → Tests. Both run the same case
list in [src/safety/cases.ts](src/safety/cases.ts).

## Built with

| Part | What it does |
| --- | --- |
| Forge UI Kit: `jira:globalPage`, `jira:adminPage`, `jira:issuePanel` | Ask, Passport and My tools; the setup page with its checklist; Check this story and Add to story on a work item |
| Forge Custom UI in a UI Kit `Frame` | The answer card on Ask, the story panel and the help center: a verdict banner, four passport stamps that land with a short animation, the path to Yes. It only draws; the page around it keeps every server call (they talk through `@forge/bridge` events) |
| Forge UI Kit: `jiraServiceManagement:portalSubheader` | "Can I…?" in the help center, with its own resolver offering only asking and the card's actions; `unlicensedAccess: customer`, never anonymous |
| Jira REST: work item comments | Add to story posts the answer as the person's comment; the app adds the new answer when it changes |
| Forge resolvers | Every action; the signed-in person always comes from the Forge context, never from the request |
| Forge SQL with migrations | Tools, catalog, facts and their versions, rules, mappings, asks, requests, changes, audit log |
| Forge LLM | Question translation, release-note labels and fact drafts from pasted documentation, each with a quote checked against the text; the model is picked from the site's live list |
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
| `static/card/` | The answer card, drawn in a Custom UI frame inside the UI Kit screens (built with Vite into `static/card/build`) |
| `test/` | Unit tests, the safety suite runner and the 40-question set |
| `docs/` | Judge guide, [specification](docs/tool-passport-v2.1.md), [decisions](docs/DECISIONS.md), [status](docs/STATUS.md), [experiments](docs/experiments.md) |

## Development

Needs Node.js and the Forge CLI, logged in.

```sh
npm install
npm test               # unit tests and the false-Yes suite (vitest)
npm run typecheck
npm run lint
npm run build:card     # the answer card's frame; forge deploy uploads static/card/build as it is
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

## Privacy

What the app stores, what it reads, and what reaches the model: [PRIVACY.md](PRIVACY.md).

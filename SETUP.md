# Tool Passport: setup before development

Do every step here yourself before handing the folder to Claude Code. When `bash scripts/check-prereqs.sh`
passes and the hello-world app shows up in Jira on your demo site, the setup is done.

Time needed: about 2 hours, plus waiting for the demo site to provision.

---

## Stage 1: Accounts (30 min)

- [ ] **Devpost.** Go to https://codegeist2026.devpost.com, click **Join Hackathon**, and sign in or create a free
      Devpost account. Registration closes with submissions: Dec 22, 2026, 12:00 PM PT.
- [ ] **Atlassian account.** Use the account you will develop with. Note the email; you need it for `forge login`.
- [ ] **API token.** https://id.atlassian.com/manage/api-tokens → **Create API token** → name it `codegeist26`
      → copy it somewhere safe (a password manager). Never put it in the project folder.
- [ ] **Second Atlassian account for "Sam"** (the privacy test needs two different askers). Any second email you
      control works. You'll invite it to the demo site in Stage 4.
- [ ] **YouTube account** that can upload public videos (needed for the demo video in December).
- [ ] **GitHub (or Bitbucket) account** for a private backup repository. The rules don't require a public repo.

## Stage 2: Your machine (20 min)

- [ ] **Node.js 22 or 24 LTS.** The Forge CLI supports 22.x and 24.x.
      - Windows: the LTS installer from nodejs.org (or nvm-windows). macOS / Linux: nvm.
      - Check: `node --version` shows `v22.x` or `v24.x`, and `npm --version` works.
      - Stay on npm 11. npm 12 blocks install scripts that the Forge CLI needs (keytar stores your login).
      - If the Forge CLI install fails with missing dependencies, clear `NODE_ENV` (`unset NODE_ENV`) and reinstall.
- [ ] **Forge CLI.** `npm install -g @forge/cli@latest`, then `forge --version`.
- [ ] **Log in.** `forge login`, then enter your Atlassian email and paste the API token. Check with `forge whoami`.
      (No system keychain, e.g. some Linux setups? Set `FORGE_EMAIL` and `FORGE_API_TOKEN` as environment variables
      in your shell profile, never in the project.)
- [ ] **Git.** `git --version`.
- [ ] **Claude Code** installed and signed in.

## Stage 3: Demo site (15 min plus waiting)

The Codegeist resources page recommends a Forge **demo site**, not the free developer site. A demo site has enterprise
editions of Jira, Confluence, Jira Service Management and Rovo; free developer sites have been reported to lack Rovo
Chat. You get one demo site at a time, and it lasts **90 days**, which covers development, the video and submission.

- [ ] Run `forge site provision`. You can press Ctrl+C; provisioning continues. Run the same command again to see
      the status and the site URL.
- [ ] Open the site URL and check:
  - [ ] Jira loads and you can create an issue.
  - [ ] Confluence loads at `/wiki`.
  - [ ] **Rovo Chat** is available (top bar).
  - [ ] **Jira Service Management** is available, and **Assets** appears (in the JSM sidebar or the app switcher).
        Note what you see; this is the first half of experiment E2.
- [ ] Write the site URL into `docs/ENVIRONMENT.md`.

Don't run `forge site provision` again later expecting a second site; reuse this one for everything.

## Stage 4: Prepare the demo site (20 min)

- [ ] **Service space for the app.** In Jira Service Management, create a new service space from the IT service
      management template. Name it `Tool Passport Desk` (key `TPD`). You are an agent on it automatically.
- [ ] **Invite "Sam".** Invite your second account to the site with access to Jira and JSM. Accept the invite from
      that account in a private browser window so it's ready for the privacy test.
- [ ] **Groups.** Don't create the demo groups by hand; the app's demo seed will create `kestrel-dev-builders` and
      `kestrel-prod-deployers` later. Just confirm you are a site admin (you can open Settings → User management).
- [ ] **Assets.** Don't create schemas by hand either; the setup wizard does that. Just confirm you can open Assets.
- [ ] Record the space key, and the display names (not emails) of both accounts, in `docs/ENVIRONMENT.md`.

## Stage 5: Developer space and billing (10 min)

Every new Forge app must belong to a **Developer Space**; `forge create` asks you to pick or create one. Forge LLM
calls have **no free allowance** and are billed to the developer, so add a payment method now to avoid surprises
when translation starts working.

- [ ] Open the developer console (developer.atlassian.com → Console). Create a Developer Space named `Codegeist 2026`.
- [ ] In the space settings, add a payment method. Expected LLM cost for this project is a few dollars; check
      **Usage and costs** in the console weekly.

## Stage 6: Create the app folder (20 min)

- [ ] In the folder where you keep projects (not inside another git repo), run `forge create`.
      - Name: `tool-passport`
      - Developer Space: `Codegeist 2026`
      - Template: **Jira → UI Kit → global page** (the Jira global page template)
- [ ] `cd tool-passport`, then copy **everything from this kit** into it: `CLAUDE.md`, `SETUP.md`, `docs/`,
      `scripts/`. The app's own `manifest.yml`, `package.json` and `src/` from `forge create` stay as they are;
      Claude Code will replace them in Phase 0.
- [ ] **Hello-world check** (proves the whole pipeline before any real code):
  - [ ] `npm install`
  - [ ] `forge deploy` (development environment)
  - [ ] `forge install --demo-site`
  - [ ] In Jira on the demo site, open **Apps** and confirm the hello-world global page loads.
- [ ] Write the app ID (the `app.id` line in `manifest.yml`) into `docs/ENVIRONMENT.md`.
- [ ] **Forge skills for Claude Code.** In the app folder run `forge skills install` (the CLI suggests it after login).
      It adds Atlassian's Forge developer skills and the Forge and ADS (design system) MCP servers, so Claude Code
      checks current Forge docs instead of guessing. Alternative inside Claude Code:
      `/plugin install forge-skills@atlassian-forge-skills`. Restart Claude Code afterwards.

## Stage 7: Version control (10 min)

- [ ] `git init` (if `forge create` didn't), then make sure `.gitignore` contains at least:
      `node_modules/`, `.env`, `.env.*`, `*.log`, `.DS_Store`.
- [ ] `git add -A && git commit -m "Forge hello world + Tool Passport spec and setup"`.
- [ ] Create a **private** repository and push to it.

## Stage 8: Final check and handoff

- [ ] Run `bash scripts/check-prereqs.sh` from the app folder (on Windows, run it in Git Bash or WSL). Fix anything
      marked FAIL.
- [ ] Optional but useful: watch the Codegeist live build session (Tue Nov 17, 12:00–12:45 PM ET, which is
      10:30–11:15 PM IST) or its recording.
- [ ] Start Claude Code in the app folder and paste the kickoff message from `KICKOFF.md`.

---

## Things to know before December (not setup, but plan for them)

- **Judges install through a link.** Sharing needs a production deploy (`forge deploy -e production`), then
  developer console → your app → **Distribution** → **Edit** → **Sharing**, which gives the installation link.
  Do a test run of this in Phase 4, not on Dec 20.
- **The video** must be under five minutes, public on YouTube, and free of third-party trademarks and unlicensed music.
- **Submission** is the Devpost form: text description, how the project meets the technology requirement, category
  (Apps for Software Teams), any bonus write-up, the installation link with instructions, and the video link. Save a
  draft early; nothing can change after the deadline.

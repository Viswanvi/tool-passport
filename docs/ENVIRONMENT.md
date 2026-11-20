# Environment record

Filled in by the human during SETUP.md. Claude Code reads this file; it must never contain tokens, passwords or
email addresses.

| Item | Value |
| --- | --- |
| Demo site URL (from `forge site provision`) | https://one-atlas-oibs.atlassian.net |
| Demo site provisioned on / expires | 2026-11-20 / 2027-02-18 |
| Developer Space name | Codegeist 2026 |
| Forge app ID (`app.id` in manifest.yml) | ari:cloud:ecosystem::app/116e4a95-46a5-4008-8a77-9177f8e23ed0 |
| JSM service space name and key | Tool Passport Desk (TPD), project id 10202, template Basic IT service management, created 2026-11-20 |
| Account 1 (plays Priya and Marco) | the admin account (display name kept out of the repo) |
| Account 2 display name (plays Sam) | |
| Assets visible on the demo site? (Stage 3) | yes (workspace id e814c5c1-5d62-496f-9b4c-78c6d67a7401; 14 seeded schemas) |
| Rovo Chat visible on the demo site? (Stage 3) | yes ("Open Rovo Chat" in the top bar) |
| Confluence on the demo site? | yes (/wiki opens) |
| Licensed products (applicationrole) | Jira Software, Jira Service Desk, Jira Product Discovery, Jira Customer Service |
| Node.js version | 24.22.1 (npm 11.19.1; stay on npm 11) |
| Forge CLI version | 15.1.0 |

## Notes

- One demo site per developer at a time. Do not provision another.
- Development deploys: `forge deploy` then `forge install --demo-site` (first time) or `forge install --upgrade`.
- Production deploy and sharing happen in Phase 4 only.

## Site check results (2026-11-20, done in the browser as the signed-in admin)

- These checks used the admin's browser session. They prove the products exist on the site. They do NOT prove the
  Forge app can read them: E5 must still show an app-side Assets read (scopes plus the Forge API call) before
  anything depends on it.
- The demo site comes pre-seeded: about 20 sample Jira spaces (several JSM service spaces) and 14 Assets schemas,
  including `a_software_registry` (18 objects) and `Application Portfolio` (32 objects).
- Do not use the seeded Assets data in the demo or video. `Application Portfolio` names real third-party vendors
  and products, which breaks the "no third-party names" rule. For E5, create a dedicated Tool Passport schema with
  fictional tool names and read that.

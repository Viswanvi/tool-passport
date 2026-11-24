# Tool Passport privacy policy

Last updated: 25 November 2026

Tool Passport is an Atlassian Forge app for Jira and Jira Service Management. It runs entirely on Atlassian's
platform (the Runs on Atlassian program): it makes no calls outside Atlassian, and its data stays in Atlassian's
hosted storage for the site where it is installed. The developer has no copy of it and no access to it.

## What the app stores

In Forge SQL, Atlassian's hosted database for the app, separately for each site:

- **Atlassian account IDs** of the people who ask questions, own tools, approve requests or change records. The app
  stores no names, email addresses or avatars; screens show those live from Atlassian.
- **Questions people ask.** The text is deleted automatically after 30 days. What the app keeps longer is its
  reading of the question as catalog keys (for example `web_frontend`), the verdict, and which records it used.
- **Tool records** that tool owners and Jira administrators enter: capabilities, facts and the versions they were
  verified on, policy rules, readiness requirements, group mappings and environments.
- **Request records:** the keys of the Jira requests it raised, their kind and status.
- **An audit log** of every change to the records: who made it (account ID), what changed and when.

## What the app reads but does not keep

Assets environment records, a person's Jira group membership, and the status of the requests it raised. These are
read when needed and are not copied into the app's storage, except that the app notes the tool version each
environment was last seen on.

## Model use

To understand a question, the app sends its text, with the tool's catalog of capabilities, to an Atlassian-hosted
model through Forge LLM. The model never receives facts, policy rules, environment values, group names or anyone's
identity, and its reply can only name catalog keys. If a tool owner pastes release notes on the Changes screen, the
notes are sent the same way to suggest labels. Atlassian applies its usual moderation to these requests.

## Requests in Jira Service Management

Fix requests, approval requests and questions to a tool owner are created in the site's own service desk, privately
for the person asking. They are ordinary Jira data, controlled by the site's settings and administrators.

## Retention and deletion

Question text is deleted after 30 days. Everything else stays until a Jira administrator changes or deletes it
(Reset demo clears the demo tool's questions, request records and records, keeping the audit log) or the app is
uninstalled, after which Atlassian handles
the app's storage as described in Forge's
[hosted storage data lifecycle](https://developer.atlassian.com/platform/forge/hosted-storage-data-lifecycle/).

## Contact

Questions about this policy or the app: open an issue in this repository.

# Tool Passport privacy policy

Last updated: 26 November 2026

Tool Passport is an Atlassian Forge app for Jira and Jira Service Management. It runs entirely on Atlassian's
platform (the Runs on Atlassian program): it makes no calls outside Atlassian, and its data stays in Atlassian's
hosted storage for the site where it is installed. The developer has no copy of it.

## App logs

Atlassian lets the developer read the app's logs to troubleshoot problems. The app writes only short event lines
there, such as a verdict word, a request key like `TPD-4`, a count or a model name, and short error messages. It
never logs question text, names or account IDs. Site administrators can turn off the developer's access to the logs,
or view and download them, in Atlassian Administration.

## What the app stores

In Forge SQL, Atlassian's hosted database for the app, separately for each site:

- **Atlassian account IDs** of the people who ask questions, own tools, approve requests, change records or turn the
  help center box on or off. The app
  stores no names, email addresses or avatars; screens show those live from Atlassian.
- **Questions people ask.** The text is deleted automatically after 30 days. What the app keeps longer is its
  reading of the question as catalog keys (for example `web_frontend`), the verdict, and which records it used.
  When someone checks a work item with **Check this story**, its summary is kept the same way, as that person's
  question.
- **Tool records** that tool owners and Jira administrators enter: capabilities, facts and the versions they were
  verified on, policy rules, readiness requirements, group mappings and environments.
- **Request records:** the keys of the Jira requests it raised, their kind and status.
- **Stories an answer was added to:** when someone clicks **Add to story**, the work item's key and the verdict it
  was given (for example `not_ready`), so the app can add the new answer there when it changes. No text from the
  work item is kept.
- **An audit log** of every change to the records: who made it (account ID), what changed and when.

## What the app reads but does not keep

Assets environment records, a person's Jira group membership, the status of the requests it raised, and, when
someone clicks **Check this story** on a work item, that work item's summary and description, read as that person
so only what they may see is read. These are
read when needed and are not copied into the app's storage, except that the app notes the tool version each
environment was last seen on.

## Model use

To understand a question, the app sends its text, with the tool's catalog of capabilities, to an Atlassian-hosted
model through Forge LLM. For **Check this story**, that text is the work item's summary and the start of its
description, up to 500 characters. The model never receives facts, policy rules, environment values, group names or
anyone's identity, and its reply can only name catalog keys. The **Passport** screen calls no model. If a tool owner pastes release notes on the Changes screen, the
notes are sent the same way to suggest labels. Atlassian applies its usual moderation to these requests.

## Requests in Jira Service Management

Fix requests, approval requests and questions to a tool owner are created in the site's own service desk, privately
for the person asking. They are ordinary Jira data, controlled by the site's settings and administrators.

## Comments on work items

**Add to story** posts an answer on a work item only when the person clicks it, as their own comment, so everyone
who can see the work item can read it. It holds the verdict, the reason, the evidence labels (such as the name of an
access group) and a mention of that person. When the answer later changes, the app adds one comment with the new
answer. These comments are ordinary Jira data.

## The help center

When a Jira administrator turns it on, a "Can I…?" box appears in the site's service desk help center for signed-in
people, including service desk customers without a Jira licence. It answers exactly as the Ask page does, as the
person asking, so it shows the same evidence labels (such as the name of an access group). Anonymous visitors never
see it. It is off until an administrator turns it on, because some help centers are open to people outside the
company.

## Retention and deletion

Question text is deleted after 30 days. Everything else stays until a Jira administrator changes or deletes it
(Reset demo clears the demo tool's questions, request records and records, keeping the audit log) or the app is
uninstalled, after which Atlassian handles
the app's storage as described in Forge's
[hosted storage data lifecycle](https://developer.atlassian.com/platform/forge/hosted-storage-data-lifecycle/).

## Contact

Questions about this policy or the app: open an issue in this repository.

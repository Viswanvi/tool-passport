# Tool Passport: judge guide

Tool Passport answers one question for employees: **"Can I do X with tool T in environment E?"** It answers from
recorded evidence (an Assets record, an owner-verified fact, a policy rule, your group membership) and names the
source of every piece. When something is missing it says so, and it can raise a private request to fix it.

This guide takes you from the installation link to the three things the app is built for:

1. **Context:** the same question gets a different answer in development and in production, and each answer says why.
2. **Guided fix:** a blocked answer becomes a private request; when it's resolved, the answer updates by itself.
3. **Version change:** when an environment moves to a new tool version, answers that depended on the old version
   stop being vouched for, and the owner re-verifies them in one place.

Everything is created by the app's own setup through the same APIs a real customer would use. The company, tool and
people are fictional: Kestrel Studio is a data-app platform with two environments, KS-DEV and KS-PROD. You play both
the employee asking (Priya in the video) and the tool owner (Marco), with your own account.

## What you need

- An Atlassian Cloud site where you are a site admin, with **Jira** and **Jira Service Management**. A free
  developer site works.
- **Assets** (part of Jira Service Management). Free developer sites have it, and no Assets role is needed. If your
  site has no Assets, use registry mode (marked **No Assets?** below).
- **Rovo**, only for the optional Rovo part at the end. Everything else works without it.

## 1. Install and prepare the site

1. Open the [installation link](https://developer.atlassian.com/console/install/116e4a95-46a5-4008-8a77-9177f8e23ed0?signature=AYABeBOvsiGiDaXFGITTJXv0SaIAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB8Hj7T4MmnIhU5akWl5pzoQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDOD0JAw07f27V8F8XgIBEIA7dKrAKCYfrYkYJtQvIeUgMqQ8rhTDohP39PayEcH3s5n%2B682bPPVY%2Bw5D9USPs5o77ccLi%2Be7qlomgOIAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgFKpXbOptH67Vllbilcs9HrAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMMkyFEahs9%2B36EKTQAgEQgDuY3llj2%2F5UvFALfautqlMgDSNgY2ShYcRmYu8qPeeGgsWT7GJWGR0k7Rw6aCg3k06R%2FkiQiSYBHI%2BWqwAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAaNe4JzmVWrpJEHBN1biRTQAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAyxcWouXocdF4f3GHICARCAO%2Fs1ZbTP7YgbQmqybuh8fJ%2FTJMdJfeUsg2TiOhwgv4KF5phAN8spaXgKGHzbaK5dI7AhcAmBohzzRAh3AgAAAAAMAAAQAAAAAAAAAAAAAAAAAGLcpKVj0k2gKGWiLyaubMb%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADIxzJ9VXpQTOUhYT3KOxUZOf0T8ZV13dhK4R5xigaOLlkTeu78JymUYmKG3YTjC28CiRNmcPap6INasNvLghyJMBvk%3D&product=jira)
   (also on the Devpost page), click **Get app**, choose your site and accept the app's permissions.
2. **A service desk.** If your site has none, create one. On a brand-new site Jira opens on *Welcome to Service
   Collection*: click **Create space**. Otherwise use the sidebar, **Spaces → +**. Then choose **Service
   management** → **Basic IT service management** → **Use template**, give it a name (for example *Tool Passport
   Desk*) and click **Create space**.
3. **Resolutions.** Open Jira settings (the gear icon at the top right) → **Work items** → **Resolutions**. If the
   list is empty, add two: **Done** and **Declined**. Without any resolutions, Jira won't let anyone resolve a
   request with an outcome. (Some new sites already have them; one of ours did, another didn't.)

## 2. Set up Tool Passport

Open Jira settings (gear icon) → **Marketplace apps**, then in the sidebar under **Apps**, **Tool Passport setup**.
The checklist at the top shows each step as **Done** or **To do** and updates as you go.

1. **Requests.** Choose your service desk and a request type that needs only a summary and a description (on a new
   IT desk, **Get IT help**), then **Save**. Fix requests, approval requests and questions to the owner all use it.
2. **Approvals.** Set **Done → Approved** and **Declined → Declined**, then **Save**. Any other outcome leaves an
   approval pending.
3. **Demo data.** Click **Load demo data**. It creates the Kestrel Studio tool, its catalog, verified facts, policy
   rules and access mappings, and in Assets the *Tool Passport Environments* schema with the KS-DEV and KS-PROD
   records. It also creates the groups `kestrel-dev-builders` and `kestrel-prod-deployers` and adds you to
   `kestrel-dev-builders`. You become the tool's owner. It is safe to run again. If a box titled **One more step**
   appears, do what it says.
   - **No Assets?** Click **Load without Assets (registry mode)** instead. The environment values are then recorded
     by the owner inside Tool Passport, and answers label them *Recorded by owner*, which is weaker evidence than an
     Assets record.
4. **Model.** Nothing to do: the app picks an active model on your site by itself.
5. **Tests.** Click **Run the false-Yes suite**. It runs the app's 47 safety cases on fixed test data inside the
   app and should show **All 47 cases passed**. It reads nothing from your site and makes no model calls. The
   **40-question set** below it is optional: it makes about 40 model calls, so it can run once every 10 minutes.

## 3. Moment 1: the answer depends on the environment

Open the app: sidebar → **Apps** → **Tool Passport**. On the **Ask** tab, pick **Kestrel Studio** and **KS-DEV**,
then click the suggested question **Can I build a custom web front end or dashboard?** (or type it and click **Ask**).

- Expected: **Not ready**. "Frontend build isn't set up in KS-DEV." Each line underneath names its evidence:
  *Assets record* (Build environments), *Owner-verified · 13.2*, *Mapped access · kestrel-dev-builders*. The next
  step after the fix is a design review.
- Switch the environment to **KS-PROD** and ask again: **No**, not allowed in production (*Policy rule*), even
  though KS-PROD has the frontend build.

Try your own wording too. A question outside the tool's catalog gets **Don't know yet**, never a guess.

## 4. Moment 2: the guided fix

1. Ask the KS-DEV question again and click **Request the fix**. The card shows *Fix requested (TPD-…)* with a link
   to the request. The request is private, raised for you, and assigned to the tool owner (also you). It says what
   is missing and where the evidence came from, such as *Assets record TPENV-1*.
2. Make the fix in Assets: sidebar → **Assets** → **Schemas** → **Tool Passport Environments** → **Tool
   Environment** → **KS-DEV**. On the object, click **3 more attributes** to see them all, click the **Build
   environments** value, add **frontend** next to *standard*, and confirm with ✓.
   - **No Assets?** In Tool Passport, open **My tools** → **Records**, pick **Environments**, and under *Add or
     change* enter Name `KS-DEV`, Values come from **Recorded by the owner**, and these three lines, then **Save**:

     ```
     Version: 13.2
     Build environments: standard, frontend
     Features enabled: uploads, scheduling
     ```
3. Resolve the request: click **view request** on the card and then **Resolve this issue** (and confirm). This works
   from the request's portal page straight away, even on a desk you created minutes ago. Within seconds the app
   comments on the request with the new answer ("Answer now: Yes, with approval…"), and the card turns **Yes, with
   approval** (click **Ask again** under *Your recent questions*, or **Re-check**).
4. Click **Request approval**, open that request the same way and **Resolve this issue**. On our test site this set
   the resolution **Done**, the outcome you mapped to Approved, and the app answered "Answer now: Yes." The card turns
   **Yes**, with the evidence line *Approved · TPD-…*. If the app instead says the approval is still pending, resolve
   it in Jira's agent view with the resolution **Done** (Jira can take about 10 minutes after you create a desk before
   it lets you act as an agent there).

An approval counts only when the approver resolves it. In this demo the approver is the tool owner, which is you.

## 5. The unknown loop

1. In KS-DEV, ask **Does Kestrel Studio support WebSockets for live dashboards?** Expected: **Don't know yet**, no
   verified answer yet.
2. Click **Ask the owner**. A private question goes to the owner.
3. Open **My tools** → **Open questions**. For the question, choose **Yes**, **All environments**, tick **Holds for
   every version**, and click **Publish**. The message names the request it answered and closed, and asking again
   gives **Yes**.

## 6. Moment 3: a version change

1. In KS-DEV, ask **Can I upload a 3 GB file?** Expected: **No**, the limit is 2 GB on version 13.2.
2. In Assets, set KS-DEV's **Version** to **14.0**. (**No Assets?** Save KS-DEV again under My tools → Records with
   all three lines, the first one now `Version: 14.0`: the form replaces every value.)
3. Ask the 3 GB question in KS-DEV again: **Don't know yet**. The upload limit was verified on 13.2 and KS-DEV now
   runs 14.0, so the app no longer vouches for it. KS-PROD still answers No.
4. Open **My tools** → **Changes** (click **Refresh** if you were already on My tools): *KS-DEV: 13.2 → 14.0 · Found
   in Assets record* (*Recorded by owner* in registry mode), and a note of what was not
   touched (facts that don't depend on the version, policy rules, KS-PROD). The list of facts to re-verify is built in
   the background: if it says *Building the list…*, wait up to 5 minutes and click **Refresh**. For *Build a custom web front end
   or dashboard*, click **Still true on 14.0**. For the upload limit, click **Changed**, enter **5** and **Save**.
5. Ask the 3 GB question in KS-DEV once more: **Yes**. Your recent questions mark the earlier answers *May have
   changed* until you ask again.

Optional: paste release notes into the box on the change card and click **Suggest labels**. The model suggests a
label for each fact with the line that supports it. Nothing counts as verified until you choose Still true or
Changed.

## 7. Optional: the Rovo agent (needs Rovo on the site)

1. Click **Ask Rovo** in the top bar and choose the agent **Tool Passport**.
2. Use a conversation starter, such as *Can I build a custom web dashboard with Kestrel Studio in KS-DEV?* The agent
   answers through the app's own check: the same verdict, reason and labelled evidence as the page.
3. Ask something nobody has answered yet, such as *Can I embed my dashboard in an internal page with Kestrel Studio
   in KS-DEV?* The answer is **Don't know yet**; the agent offers to ask the owner, and Rovo asks you to confirm
   before it raises the request. Fixes and approvals stay on the Tool Passport page.
4. Other agents can reuse the check: in Rovo Studio, add the tool **Check tool readiness** to any agent.

Rovo isn't part of a free developer site. On two new developer sites we tested, Rovo never appeared, even after
starting a Teamwork Collection trial on one of them. So this part needs a site that already has Rovo; the video shows
it working on such a site. Everything else in this guide works without Rovo.

## 8. Optional: the check from any MCP client

The same readiness check is available to MCP-compatible AI clients through the Atlassian MCP server.

1. Turn it on (it is off by default): Atlassian Administration → **Apps** → **Sites** → your site → **Connected
   apps** → **tool-passport** → **Tools** → **Enable tools**. Only the read-only *Check tool readiness* tool is
   exposed.
2. In your MCP client, add a remote MCP server (Streamable HTTP) with the address
   `https://mcp.atlassian.com/forge/116e4a95-46a5-4008-8a77-9177f8e23ed0`, connect, sign in with your Atlassian
   account and approve access for your site.
3. Call the tool with Tool `Kestrel Studio`, Environment `KS-DEV` and Question `Can I build a custom web dashboard?`.
   It answers as the page does: "Not ready. Frontend build isn't set up in KS-DEV.", with the same labelled
   evidence.

## Start over

Setup → **3. Demo data** → **Reset demo**, then **Yes, reset the demo**. This deletes what Tool Passport holds about
Kestrel Studio (questions, request records, approvals, version changes, facts, rules, mappings), loads the demo
again, and puts KS-DEV and KS-PROD back to version 13.2 and their first values in Assets. Requests already raised in
Jira stay in the desk. Nothing else is touched.

## If something doesn't work

| What you see | What to do |
| --- | --- |
| A request opens in the customer portal | The desk is new and Jira doesn't count you as an agent yet (about 10 minutes). Use **Resolve this issue** on the portal page; that's enough for the demo. |
| Resolving says *Resolution is required* with nothing to pick | Add the resolutions **Done** and **Declined** (step 1.3), then save Setup → **2. Approvals** again. |
| **One more step** after Load demo data | The demo groups couldn't be made automatically. Follow the steps shown there. |
| The card says *The app is not allowed to read the record for KS-DEV* | The app can't read Assets on this site. Use **Load without Assets (registry mode)** instead. |
| Someone else can't get a request raised for them | Other people who ask need the Jira Service Management **Customer** role, given in Atlassian Administration. You don't need it yourself. |
| A question shows **Try again** | The model didn't answer in time. Ask again. |

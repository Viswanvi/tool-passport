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

1. Open the installation link on the Devpost page, choose your site and accept the app's permissions.
2. **A service desk.** If your site has none, create one: in the sidebar, **Spaces → +**, then **Service
   management** and a template such as **Basic IT service management**. Jira can take about **10 minutes** before
   it counts you as an agent on a desk you just created. Until then its requests open in the customer portal and you
   can't resolve them, so set up the rest meanwhile.
3. **Resolutions.** Open Jira settings (the gear icon at the top right) → **Work items** → **Resolutions**. If the
   list is empty, which is normal on a new developer site, add two: **Done** and **Declined**. Without any
   resolutions, Jira won't let an agent resolve a request.

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
then click the suggested question **Can I build a custom web front end or dashboard?**

- Expected: **Not ready**. "Frontend build isn't set up in KS-DEV." Each line underneath names its evidence:
  *Assets record* (Build environments), *Owner-verified · 13.2*, *Mapped access · kestrel-dev-builders*. The next
  step after the fix is a design review.
- Switch the environment to **KS-PROD** and ask again: **No**, not allowed in production (*Policy rule*), even
  though KS-PROD has the frontend build.

Try your own wording too. A question outside the tool's catalog gets **Don't know yet**, never a guess.

## 4. Moment 2: the guided fix

Do this once you count as an agent on the desk (see step 1.2).

1. Ask the KS-DEV question again and click **Request the fix**. The card shows *Fix requested (TPD-…)* with a link
   to the request. The request is private, raised for you, and assigned to the tool owner (also you). It says what
   is missing and where the evidence came from, such as *Assets record TPENV-1*.
2. Make the fix in Assets: sidebar → **Assets** → **Schemas** → **Tool Passport Environments** → **Tool
   Environment** → **KS-DEV**. Edit **Build environments** and add **frontend** next to *standard*.
   - **No Assets?** In Tool Passport, open **My tools** → **Records**, pick **Environments**, and under *Add or
     change* enter Name `KS-DEV`, Values come from **Recorded by the owner**, and these three lines, then **Save**:

     ```
     Version: 13.2
     Build environments: standard, frontend
     Features enabled: uploads, scheduling
     ```
3. Resolve the request in Jira: search for its key (like `TPD-1`) and use the resolve transition with the
   resolution **Done**. Within seconds the app comments on the request with the new answer, and the card turns
   **Yes, with approval** by itself (or click **Re-check**).
4. Click **Request approval**. Resolve that request with **Done**, the outcome you mapped to Approved. The card
   turns **Yes**, with the evidence line *Approved · TPD-…*.

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
4. Open **My tools** → **Changes**: *KS-DEV: 13.2 → 14.0*, with the facts to re-verify on 14.0 and a note of what
   was not touched (facts that don't depend on the version, policy rules, KS-PROD). For *Build a custom web front end
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

The free developer site we tested did not include Rovo; Atlassian offered it there through a Teamwork Collection
free trial.

## Start over

Setup → **3. Demo data** → **Reset demo**, then **Yes, reset the demo**. This deletes what Tool Passport holds about
Kestrel Studio (questions, request records, approvals, version changes, facts, rules, mappings), loads the demo
again, and puts KS-DEV and KS-PROD back to version 13.2 and their first values in Assets. Requests already raised in
Jira stay in the desk. Nothing else is touched.

## If something doesn't work

| What you see | What to do |
| --- | --- |
| A request opens in the customer portal and you can't resolve it | The desk is new: wait about 10 minutes after creating it, then reload. |
| Resolving says *Resolution is required* with nothing to pick | Add the resolutions **Done** and **Declined** (step 1.3), then save Setup → **2. Approvals** again. |
| **One more step** after Load demo data | The demo groups couldn't be made automatically. Follow the steps shown there. |
| The card says *The app is not allowed to read the record for KS-DEV* | The app can't read Assets on this site. Use **Load without Assets (registry mode)** instead. |
| Someone else can't get a request raised for them | Other people who ask need the Jira Service Management **Customer** role, given in Atlassian Administration. You don't need it yourself. |
| A question shows **Try again** | The model didn't answer in time. Ask again. |

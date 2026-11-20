# Week-1 experiments (spec section 7)

Each entry: what ran, raw output (trimmed, no secrets, no emails), pass/fail against the spec's bar, and what it means
for the design. "Not run" means not run; nothing here is inferred.

Order agreed at kickoff: E10 (started first, passive) → E1 (+ E3) → E6 → E5 → E2 → E4 (last; LLM cost approval
first). STOP after E1, E2, E4, E5, E6 for the Assets decision (due Nov 23). E7 after the decision; E8 in Phase 2;
E9 in Phase 4.

All times UTC. Demo site `one-atlas-oibs`, app version 3.0.0-3.3.0 (development).

| ID | Question | Status | Result so far |
| --- | --- | --- | --- |
| E1 | Which Assets read path works from Forge? | **Partial**: admin and no-user paths run; employee-without-Assets-role path needs Sam | All three read paths work for the admin: app context (UI resolver and scheduled trigger, no role granted), user context, and impersonation in the scheduled trigger. Schema writes: admin user yes, app no (403) |
| E2 | Will Assets exist on a judge's site? | Not run (needs the fresh developer site) | |
| E3 | Can the card show where an Assets value came from? | **Partial pass** | `created` and `updated` available on the object. History: 0 entries on an unedited object; "who changed it" untested |
| E4 | Does translation work, and fail safely? | Not run (needs cost approval) | |
| E5 | Can the app raise requests for an employee and react to resolution? | Not run (needs Sam) | |
| E6 | Can the app read the asker's groups? | Not run (needs Sam) | |
| E7 | Is change detection safe to repeat? | Not run | |
| E8 | Can judges use the Rovo action? (P1) | Moved to Phase 2 (D7) | |
| E9 | Can a stranger reach moment 1 quickly? | Moved to Phase 4 (D7) | |
| E10 | Does the five-minute sweep run, and can it read Assets without a user? | **Running** (2-hour window) | Ticking since 18:36:00. Assets read without a user: works (app context) |

## E1 · Assets read path

**Setup** — clicked "E1 · Create test schema (admin)" as the Jira administrator, 2026-11-20 18:35. The resolver tries
the app first, then the admin user (`src/experiments/e1.ts` `setup`).

| Step | As app (`api.asApp()`) | As admin user (`api.asUser()`) |
| --- | --- | --- |
| `GET /rest/servicedeskapi/assets/workspace` | 200 | 200 |
| `GET …/v1/objectschema/list` | 200 | 200 |
| `POST …/v1/objectschema/create` | **403** `"Sorry, you do not have permission to perform this action."` | 201 (schema id 16, key `TPENV`) |
| `POST …/v1/objecttype/create` (icon from `GET …/v1/icon/global`) | not reached | 201 (type id 147) |
| `POST …/v1/objecttypeattribute/147` × 4 | not reached | 201 × 4. Select attributes accepted `defaultTypeId: 10`, `options`, `maximumCardinality: -1`; multiple values stored and read back |
| `POST …/v1/object/create` × 2 | not reached | 201 × 2: KS-DEV `TPENV-4679`, KS-PROD `TPENV-4680` |

Cut rule 1 ("Assets stays only for seeding if writes work"): writes work **as a Jira/Assets administrator in user
context**; they do **not** work as the app. The setup wizard and demo seed must run as the signed-in admin.

**Read** — what the provider will run: `POST /jsm/assets/workspace/{id}/v1/object/aql?includeAttributes=true`
with `qlQuery: objectSchema = "Tool Passport Environments" AND objectType = "Tool Environment"`, then
`GET …/object/{id}` and `GET …/object/{id}/history` for E3. No schema listing.

| Run | Context | Who | Result |
| --- | --- | --- | --- |
| #3 `ui:user:admin` 18:35:31 | `api.asUser()` in a UI resolver | Jira admin | 200, both objects, all attributes |
| #30001 `ui:app` 18:35:33 | `api.asApp()` in a UI resolver | (app) | 200, both objects, all attributes. **No Assets role was granted to the app** |
| #30003 `sweep:app` 18:36:02 | `api.asApp()` in the scheduled trigger | (no user) | 200: `ok: KS-DEV v13.2, KS-PROD v13.2` |
| `sweep:impersonate:admin` 18:41:05 | `api.asUser(accountId)` in the scheduled trigger | Jira admin | 200: `ok: KS-DEV v13.2, KS-PROD v13.2`. Offline impersonation works with `allowImpersonation` on the read scopes. (The 18:36 attempt failed on a JSON-column bug in our code, fixed in 3.2.0.) |
| `ui:user:non-admin` | `api.asUser()` in a UI resolver | Sam (no Assets role) | **Not run: needs Sam** |
| `sweep:impersonate:non-admin` | `api.asUser(accountId)` in the scheduled trigger | Sam | **Not run: needs Sam** |

AQL reply top-level keys: `values, objectTypeAttributes, maxResults, startAt, total, isLast, hasMoreResults, last`.
`objectTypeAttributes` maps attribute ids to names, so no extra call is needed. The system attributes `Key`,
`Created` and `Updated` come back as ordinary attributes.

**Contradiction with the docs:** Atlassian's "grant roles to Forge apps (2LO)" page says the app account has no
Assets access by default. Here the app read the passport objects without any role. Possible reasons: the demo site's
configuration, or these endpoints being exempt. **E2 must repeat the app-context read on the fresh developer site**
before the design relies on it.

**Pass bar** ("at least one path returns the environment object for an employee with no Assets role"): not decided
yet. The app path doesn't use the employee's permissions at all, so it should pass for Sam; that is what the Sam run
checks.

**Open sub-question (provider contract, absent vs empty):** every attribute on both objects has a value, so whether
AQL omits empty attributes is untested. Test with an empty attribute before the Assets provider is built.

## E3 · Assets record provenance

- `GET …/object/4679` (KS-DEV): `created` and `updated` present (`2026-11-20T18:35:18.141Z`). **Pass bar "updated
  time available": met.**
- `GET …/object/4679/history`: 200 with **0 entries** on an object that hasn't been edited since creation. Who
  changed it (bonus): untested. Re-test after an edit (moment 2 edits KS-DEV's Build environments).

## E10 · Five-minute sweep

- `scheduledTrigger` `interval: fiveMinute`, key `five-minute-sweep`, deployed in 3.0.0 and installed 18:32.
- First tick `2026-11-20T18:36:00.047Z`, second `18:41:00.180Z`. Pass bar: no gap over 10 minutes across two hours
  (until about 20:36). The Status panel's E10 line computes the gaps from the recorded ticks.
- Assets read without a user: **works** in the app context (`sweep:app` above).

## Forge SQL platform behaviour seen while running the experiments (verified on the demo site)

1. All 19 `CREATE TABLE IF NOT EXISTS` migrations applied in one `avi:forge:upgraded:app` invocation
   (`[lifecycle] migrations applied: v001_tools … v019_experiment_runs`, 18:32:40).
2. A bound `LIMIT ?` parameter is rejected: `ERROR 1210 (HY000): Incorrect arguments to LIMIT`. Fixed by inlining a
   clamped integer (`limitClause`, unit-tested).
3. JSON columns come back **already parsed as objects**, although the docs say strings
   (`SyntaxError: "[object Object]" is not valid JSON`). Fixed with `fromJsonColumn`, which accepts both.
4. `AUTO_INCREMENT` ids are allocated in blocks (ids 1, 2, 3, then 30001), so id order is not insert order. Order by
   timestamp; never use id order for recency in Phase 1.

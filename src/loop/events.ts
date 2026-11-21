/**
 * avi:jira:updated:issue. Phase 1 builds the request loop here (spec section 11): ignore any issue the app
 * didn't raise; on a resolution, read it from `changelog.items` and confirm with a read-back of the issue
 * (DECISIONS D22, never `issue.fields.resolution`), then re-check. Until then the handler does nothing.
 */
export async function onIssueEvent(): Promise<void> {
  // Intentionally empty until Phase 1; the trigger stays so adding the loop needs no manifest change.
}

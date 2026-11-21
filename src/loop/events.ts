import { onEvent as e5OnEvent } from '../experiments/e5';

/**
 * avi:jira:updated:issue. Phase 0: only E5's test requests are looked at. Phase 1 replaces this with
 * the request loop (spec section 11): ignore anything we didn't raise, re-check on resolution.
 */
export async function onIssueEvent(event: Parameters<typeof e5OnEvent>[0]): Promise<void> {
  try {
    await e5OnEvent(event);
  } catch (e) {
    console.error(`[issue-event] ${String(e).slice(0, 300)}`);
  }
}

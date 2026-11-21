import { onEvent as e5OnEvent } from '../experiments/e5';

type IssueEvent = Parameters<typeof e5OnEvent>[0];

/**
 * avi:jira:updated:issue. Phase 0: only E5's test requests are looked at. Phase 1 replaces this with
 * the request loop (spec section 11): ignore anything we didn't raise, re-check on resolution.
 */
export async function onIssueEvent(event: IssueEvent): Promise<void> {
  // Phase 0 diagnostic: one line per delivery (event type, payload keys, issue key; no names or content),
  // so E5 can tell "never delivered" from "delivered but not matched".
  const keys = event && typeof event === 'object' ? Object.keys(event).join(',') : typeof event;
  console.log(`[issue-event] received ${event?.eventType ?? '?'} ${event?.issue?.key ?? '(no issue.key)'} keys=${keys}`);
  try {
    await e5OnEvent(event);
  } catch (e) {
    console.error(`[issue-event] ${String(e).slice(0, 300)}`);
  }
}

import type { Answer } from './answer';
import type { Catalog, Check, CheckResult, CheckStatus, Environment, Label, Outcome, Verdict } from './model';

/**
 * The verdict card (spec section 15), built by code from the answer. One verdict in fixed words, one reason
 * sentence, at most three evidence chips, one primary action. Every word here comes from code, the catalog or
 * the owner's records: never from the model (its `restated` and `unsupported` texts are not shown, D29/D31),
 * and never "live", "AI", "I think" or "probably". Times stay ISO strings; the page formats them for the viewer.
 */

export type LozengeAppearance = 'success' | 'inprogress' | 'moved' | 'removed' | 'new' | 'default';

export type ChipLabel = 'Owner-verified' | 'Assets record' | 'Recorded by owner' | 'Mapped access' | 'Policy rule' | 'Approved' | 'Declined' | 'Not verified';

export interface Chip {
  label: ChipLabel;
  detail: string;
  readAt?: string | null;
  changedAt?: string | null;
}

export type ActionKind = 'request_fix' | 'fix_requested' | 'request_approval' | 'approval_requested' | 'ask_owner' | 'recheck' | 'try_again';

/** An open request shown on the card. The page looks the owner's name up from the account id. */
export interface CardRequest {
  /** Null while it is still being raised. */
  key: string | null;
  url: string | null;
  ownerAccountId: string;
}

export interface CardAction {
  kind: ActionKind;
  label: string;
  requestKey?: string;
  /** fix_requested and approval_requested only: one per open request. */
  requests?: CardRequest[];
}

export interface CardCheck {
  subject: string;
  dimension: Check['dimension'];
  status: CheckStatus;
  statusText: string;
  chip: Chip;
}

export interface Card {
  kind: 'verdict' | 'try_again' | 'refused';
  verdict: Verdict | null;
  title: string;
  lozenge: LozengeAppearance;
  reason: string;
  /** "KS-DEV · 13.2", "Any environment", or null when nothing was checked. */
  where: string | null;
  chips: Chip[];
  action: CardAction | null;
  /** After a fix: the approvals still needed ("next: design review"). */
  next: string[];
  /** "I checked: …", in plain words from the catalog and records. */
  checked: string[];
  checks: CardCheck[];
  banner: string | null;
}

export interface CardContext {
  toolName: string;
  environment: Environment | null;
  catalog: Catalog;
}

const TITLE: Record<Verdict, string> = {
  yes: 'Yes',
  yes_with_approval: 'Yes, with approval',
  not_ready: 'Not ready',
  no: 'No',
  dont_know: "Don't know yet",
};

// Each verdict has its own colour; Not ready (yellow) and Don't know yet (purple) never look like No (red).
const LOZENGE: Record<Verdict, LozengeAppearance> = {
  yes: 'success',
  yes_with_approval: 'inprogress',
  not_ready: 'moved',
  no: 'removed',
  dont_know: 'new',
};

const STATUS_TEXT: Record<CheckStatus, string> = { pass: 'Yes', fail: 'No', missing: 'Missing', approval: 'Needs approval', unknown: 'Not verified' };

export const ANY_ENVIRONMENT_BANNER = 'Any environment: only whether the tool can do this was checked. Policy, setup and access were not checked.';

const humanize = (key: string) => key.replace(/_/g, ' ');
const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** "file size in gigabytes (GB)" → " GB"; no unit → "". */
function shortUnit(unit: string | undefined): string {
  const m = unit ? /\(([^)]+)\)\s*$/.exec(unit) : null;
  return m ? ` ${m[1]}` : '';
}

function actionLabel(action: string, catalog: Catalog): string {
  return catalog.keys.get(action)?.label ?? humanize(action);
}

export function subjectOf(r: CheckResult, catalog: Catalog): string {
  const c = r.check;
  switch (c.dimension) {
    case 'capability':
    case 'unlinked':
      return catalog.keys.get(c.key)?.label ?? humanize(c.key);
    case 'environment':
      return r.subject ?? humanize(c.key);
    case 'policy':
      return `${lowerFirst(actionLabel(c.action, catalog))} policy`;
    case 'access':
      return `access for ${lowerFirst(actionLabel(c.action, catalog))}`;
  }
}

export function chipOf(label: Label): Chip {
  switch (label.kind) {
    case 'owner_verified':
      return { label: 'Owner-verified', detail: label.version };
    case 'assets_record':
      return { label: 'Assets record', detail: label.attribute, readAt: label.readAt, changedAt: label.changedAt };
    case 'recorded_by_owner':
      return { label: 'Recorded by owner', detail: label.attribute, readAt: label.readAt, changedAt: label.changedAt };
    case 'mapped_access':
      return { label: 'Mapped access', detail: label.group };
    case 'no_access_needed':
      return { label: 'Mapped access', detail: 'no access needed' };
    case 'policy_rule':
      return { label: 'Policy rule', detail: label.reason ?? label.effect };
    case 'default_policy':
      return { label: 'Policy rule', detail: 'allowed by default' };
    case 'approved':
      return { label: 'Approved', detail: label.requestKey };
    case 'declined':
      return { label: 'Declined', detail: label.requestKey };
    case 'not_verified':
      return { label: 'Not verified', detail: label.missing };
  }
}

/** The results that decided the verdict, in order. */
function deciding(o: Outcome): CheckResult[] {
  switch (o.verdict) {
    case 'no':
      return o.because;
    case 'dont_know':
      return o.unknown;
    case 'not_ready':
      return o.fixes;
    case 'yes_with_approval':
      return o.approvals;
    case 'yes':
      return [];
  }
}

function reasonFor(o: Outcome, ctx: CardContext): string {
  const env = ctx.environment?.name ?? '';
  const first = deciding(o)[0];
  if (o.verdict === 'yes') {
    return ctx.environment ? `Everything this needs is in place in ${env}.` : `${ctx.toolName} can do this, as verified by its owner.`;
  }
  if (!first) return TITLE[o.verdict];
  const subject = subjectOf(first, ctx.catalog);
  const label = first.label;

  if (o.verdict === 'dont_know') return sentence(`${subject}: ${label.kind === 'not_verified' ? label.missing : 'not verified'}`);
  if (o.verdict === 'yes_with_approval') {
    return sentence(`Allowed in ${env} with approval${label.kind === 'policy_rule' && label.reason ? `: ${label.reason}` : ''}`);
  }
  if (o.verdict === 'not_ready') {
    if (first.check.dimension === 'access' && label.kind === 'mapped_access') {
      return sentence(`You're not in ${label.group}${label.grants ? `, which gives ${label.grants}` : ''}`);
    }
    return sentence(`${subject} isn't set up in ${env}`);
  }
  // No.
  if (label.kind === 'policy_rule') return sentence(label.reason ? `Policy for ${env}: ${label.reason}` : `Not allowed in ${env}`);
  if (label.kind === 'declined') return sentence(`Your approval request ${label.requestKey} was declined`);
  if (first.check.dimension === 'capability' && label.kind === 'owner_verified') {
    const key = ctx.catalog.keys.get(first.check.key);
    const unit = shortUnit(key?.unit);
    if (key && (key.comparison === 'gte' || key.comparison === 'lte')) {
      const kind = key.comparison === 'gte' ? 'limit' : 'minimum';
      return sentence(`${subject}: the recorded ${kind} on ${label.version} is ${String(first.found)}${unit}; you asked for ${String(first.check.value)}${unit}`);
    }
    if (key?.comparison === 'eq') return sentence(`${subject}: recorded as ${String(first.found)}${unit} on ${label.version}`);
    return sentence(`${ctx.toolName} ${label.version} can't ${lowerFirst(subject)}`);
  }
  return sentence(`${subject}: ${STATUS_TEXT[first.status].toLowerCase()}`);
}

function actionFor(o: Outcome): CardAction | null {
  switch (o.verdict) {
    case 'not_ready':
      return { kind: 'request_fix', label: 'Request the fix' };
    case 'yes_with_approval': {
      const pending = o.approvals.find((a) => a.pending)?.pending;
      return pending ? { kind: 'request_approval', label: `Approval requested · ${pending.requestKey}`, requestKey: pending.requestKey } : { kind: 'request_approval', label: 'Request approval' };
    }
    case 'dont_know':
      return o.unknown[0]?.settle === 'recheck' ? { kind: 'recheck', label: 'Re-check' } : { kind: 'ask_owner', label: 'Ask the owner' };
    case 'no':
    case 'yes':
      return null;
  }
}

function chipsFor(o: Outcome): Chip[] {
  // Approvals listed under "next" on a Not ready card aren't repeated as chips.
  const skip = new Set(o.verdict === 'not_ready' ? o.next : []);
  const ordered = [...deciding(o), ...o.results].filter((r) => !skip.has(r));
  const out: Chip[] = [];
  const seen = new Set<string>();
  for (const r of ordered) {
    const chip = chipOf(r.label);
    const id = `${chip.label}|${chip.detail}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(chip);
    if (out.length === 3) break;
  }
  return out;
}

const empty = (kind: Card['kind'], title: string, reason: string, action: CardAction | null, verdict: Verdict | null = null, lozenge: LozengeAppearance = 'default'): Card => ({
  kind,
  verdict,
  title,
  lozenge,
  reason,
  where: null,
  chips: [],
  action,
  next: [],
  checked: [],
  checks: [],
  banner: null,
});

export function buildCard(answer: Answer, ctx: CardContext): Card {
  switch (answer.state) {
    case 'try_again':
      return empty('try_again', "Couldn't read your question", "Couldn't read your question. Try again.", { kind: 'try_again', label: 'Try again' });
    case 'environment_refused':
      return empty('refused', "Can't check this environment", sentence(answer.reason), null);
    case 'unsupported':
      return empty('verdict', TITLE.dont_know, "Nothing in this tool's catalog covers that question.", { kind: 'ask_owner', label: 'Ask the owner' }, 'dont_know', LOZENGE.dont_know);
    case 'checked': {
      const o = answer.outcome;
      const where = answer.anyEnvironment
        ? 'Any environment'
        : ctx.environment
          ? `${ctx.environment.name}${answer.environmentVersion ? ` · ${answer.environmentVersion}` : ''}`
          : null;
      return {
        kind: 'verdict',
        verdict: o.verdict,
        title: TITLE[o.verdict],
        lozenge: LOZENGE[o.verdict],
        reason: reasonFor(o, ctx),
        where,
        chips: chipsFor(o),
        action: actionFor(o),
        next: o.verdict === 'not_ready' ? o.next.map((r) => (r.label.kind === 'policy_rule' && r.label.reason ? r.label.reason : subjectOf(r, ctx.catalog))) : [],
        checked: o.results.map((r) => subjectOf(r, ctx.catalog)),
        checks: o.results.map((r) => ({ subject: subjectOf(r, ctx.catalog), dimension: r.check.dimension, status: r.status, statusText: STATUS_TEXT[r.status], chip: chipOf(r.label) })),
        banner: answer.anyEnvironment ? ANY_ENVIRONMENT_BANNER : null,
      };
    }
  }
}

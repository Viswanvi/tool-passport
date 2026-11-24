import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Checkbox,
  Heading,
  Inline,
  Link,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  Text,
  Textfield,
  User,
  useProductContext,
  xcss,
} from '@forge/react';
import type { Card, CardRequest, Chip } from '../engine/card';
import { call, cardStyle, type Option } from './common';
import { ChangesSection, RecentQuestions } from './changes';
import { AddToolSection, ToolRecords } from './records';
import { EVAL_QUESTIONS } from '../eval/questions';
import { BATCH, summarise, type EvalResult } from '../eval/summary';
import type { QuestionGroup } from '../loop/questions';
import type { RunReply } from '../resolvers/eval-handlers';
import type { RaiseReply, RecheckReply, RequestSetup } from '../loop/requests';
import type { AskReply } from '../resolvers/handlers';
import type { Option as DeskOption } from '../resolvers/request-handlers';
import type { SeedResult } from '../seed/demo';
import { PREFERRED_MODELS } from '../llm/model-choice';
import type { SetupStatus } from '../resolvers/setup-handlers';
import type { SafetyRun } from '../safety/run';

/**
 * UI Kit screens (spec section 15). The page shows what the resolvers return and decides nothing: verdicts,
 * reasons, chips and actions all come from the server's card. Times are formatted here, in the viewer's own
 * time zone. Actions that aren't wired yet (request the fix, request approval, ask the owner: Phase 1 step 6
 * and Phase 2) are shown as the next step in words, not as buttons that do nothing.
 */

const ANY = 'any';
const POLL_MS = 10_000;
const POLL_LIMIT = 90;

const time = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const day = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

function chipText(c: Chip): string {
  if (c.label === 'Assets record') return `Assets record · read ${time(c.readAt)}`;
  if (c.label === 'Recorded by owner') return `Recorded by owner${c.changedAt ? ` · ${day(c.changedAt)}` : ''}`;
  return `${c.label} · ${c.detail}`;
}

function checkLine(c: Card['checks'][number]): string {
  const chip = c.chip;
  const extra = chip.label === 'Assets record' || chip.label === 'Recorded by owner' ? `${chip.detail}${chip.changedAt ? `, changed ${day(chip.changedAt)}` : ''}` : chip.detail;
  return `${c.subject}: ${c.statusText} (${chip.label}${extra ? ` · ${extra}` : ''})`;
}

// Actions that arrive in Phase 2, shown as the next step in words rather than as buttons that do nothing.
/** Open requests keep the card checking again (spec section 15). */
const WAITING = new Set(['fix_requested', 'approval_requested', 'owner_asked']);

/** "Fix requested (TPD-3) from Marco · view request", one line per open request. Names are looked up by the page. */
const OpenRequests = ({ label, to, requests }: { label: string; to: boolean; requests: CardRequest[] }) => (
  <Stack space="space.050">
    {requests.map((r, i) => (
      <Inline key={r.key ?? `raising-${i}`} space="space.100" alignBlock="center" shouldWrap>
        <Text>{`${label}${r.key ? ` (${r.key})` : ', being raised,'} ${to ? 'to' : 'from'}`}</Text>
        <User accountId={r.ownerAccountId} />
        {r.key && r.url ? (
          <Link href={r.url} openNewTab>
            view request
          </Link>
        ) : null}
      </Inline>
    ))}
  </Stack>
);

interface CardActions {
  busy: boolean;
  onRecheck: () => void;
  onRequest: (kind: 'fix' | 'approval' | 'question') => void;
  canRecheck: boolean;
}

const VerdictCard = ({ card, busy, onRecheck, onRequest, canRecheck }: { card: Card } & CardActions) => {
  const [open, setOpen] = useState(false);
  const kind = card.action?.kind;
  // An approval pending with no open request row to show still reads "Approval requested · TPD-12" (text).
  const requestApproval = kind === 'request_approval' && !card.action?.requestKey;
  // A question outside the catalog has no checks: the owner can't answer it here yet (D35), so it stays text.
  const askOwner = kind === 'ask_owner' && card.checks.length > 0;
  const button = kind === 'recheck' || kind === 'try_again' || kind === 'request_fix' || requestApproval || askOwner;
  const onPrimary =
    kind === 'request_fix' ? () => onRequest('fix') : requestApproval ? () => onRequest('approval') : askOwner ? () => onRequest('question') : onRecheck;
  return (
    <Box xcss={cardStyle}>
      <Stack space="space.150">
        <Inline spread="space-between" alignBlock="center">
          <Lozenge appearance={card.lozenge} isBold>
            {card.title}
          </Lozenge>
          {card.where ? <Text>{card.where}</Text> : null}
        </Inline>
        <Text>{card.reason}</Text>
        {card.banner ? (
          <SectionMessage appearance="information">
            <Text>{card.banner}</Text>
          </SectionMessage>
        ) : null}
        {card.chips.length ? (
          <Inline space="space.100" shouldWrap>
            {card.chips.map((c) => (
              <Tag key={`${c.label}|${c.detail}`} text={chipText(c)} />
            ))}
          </Inline>
        ) : null}
        {kind && WAITING.has(kind) && card.action?.requests ? (
          <OpenRequests label={card.action.label} to={kind === 'owner_asked'} requests={card.action.requests} />
        ) : null}
        <Inline space="space.150" alignBlock="center" shouldWrap>
          {button && card.action ? (
            <Button appearance="primary" onClick={onPrimary} isDisabled={busy}>
              {card.action.label}
            </Button>
          ) : null}
          {kind === 'request_approval' && !requestApproval ? <Text>{card.action!.label}</Text> : null}
          {kind === 'ask_owner' && !askOwner ? <Text>Next step: ask the tool owner.</Text> : null}
          {kind && WAITING.has(kind) && canRecheck ? (
            <Button appearance="subtle" onClick={onRecheck} isDisabled={busy}>
              Re-check
            </Button>
          ) : null}
          {card.next.length ? <Text>next: {card.next.join(', ')}</Text> : null}
          {card.checks.length ? (
            <Button appearance="subtle" onClick={() => setOpen(!open)}>
              {open ? 'Hide checks' : `Show ${card.checks.length} checks`}
            </Button>
          ) : null}
        </Inline>
        {open ? (
          <Stack space="space.050">
            {card.checks.map((c, i) => (
              <Text key={i}>{checkLine(c)}</Text>
            ))}
          </Stack>
        ) : null}
        {card.checked.length ? <Text size="small">I checked: {card.checked.join(' · ')}</Text> : null}
      </Stack>
    </Box>
  );
};

const AskPage = () => {
  const [tools, setTools] = useState<Option[] | null>(null);
  const [tool, setTool] = useState<Option | null>(null);
  const [envs, setEnvs] = useState<Option[]>([]);
  const [env, setEnv] = useState<Option | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [askId, setAskId] = useState<number | null>(null);
  const [failed, setFailed] = useState<Extract<AskReply, { ok: false }>['error'] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ toolId: number; environmentId: number | null; question: string } | null>(null);
  const [asksMade, setAsksMade] = useState(0);

  useEffect(() => {
    void call<{ tools: Array<{ id: number; name: string }> }>('tools').then((r) => {
      const list = r.tools.map((t) => ({ label: t.name, value: String(t.id) }));
      setTools(list);
      if (list.length === 1) setTool(list[0]!);
    });
  }, []);

  const clear = () => {
    setCard(null);
    setAskId(null);
    setFailed(null);
    setNotice(null);
  };

  useEffect(() => {
    if (!tool) return;
    setEnv(null);
    clear();
    void call<{ environments: Array<{ id: number; name: string }>; suggestions: string[] }>('environments', { toolId: Number(tool.value) }).then((r) => {
      const list = [...r.environments.map((e) => ({ label: e.name, value: String(e.id) })), { label: 'Any environment', value: ANY }];
      setEnvs(list);
      setEnv(list[0] ?? null);
      setSuggestions(r.suggestions);
    });
  }, [tool]);

  const run = async (payload: { toolId: number; environmentId: number | null; question: string }) => {
    setBusy(true);
    setAsked(payload);
    clear();
    try {
      const r = await call<AskReply>('ask', payload);
      setCard(r.card);
      setAskId(r.ok ? r.askId : null);
      setFailed(r.ok ? null : r.error);
    } catch {
      setFailed('try_again');
    } finally {
      setBusy(false);
      setAsksMade((n) => n + 1);
    }
  };

  /** Evaluates the stored ask again (no model call). Without a stored ask, the question is asked again. */
  const recheck = async (quiet = false) => {
    if (askId === null) {
      if (asked && !quiet) await run(asked);
      return;
    }
    if (!quiet) setBusy(true);
    try {
      const r = await call<RecheckReply>('recheck', { askId });
      if (r.ok) setCard(r.card);
      else if (!quiet) setNotice('Could not check again just now. Try again.');
    } catch {
      if (!quiet) setNotice('Could not check again just now. Try again.');
    } finally {
      if (!quiet) setBusy(false);
    }
  };

  /** A recent question, checked again with its stored keys (no model call); clears "may have changed". */
  const askAgain = async (id: number) => {
    setBusy(true);
    clear();
    try {
      const r = await call<RecheckReply>('recheck', { askId: id });
      if (r.ok) {
        setCard(r.card);
        setAskId(id);
      } else setNotice('That question can no longer be checked. Ask it again.');
    } catch {
      setNotice('Could not check again just now. Try again.');
    } finally {
      setBusy(false);
      setAsksMade((n) => n + 1);
    }
  };

  /** Request the fix or Request approval: the payload names only the ask; the server builds the request. */
  const request = async (kind: 'fix' | 'approval' | 'question') => {
    if (askId === null) {
      setNotice('Ask the question again, then try once more.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await call<RaiseReply>(kind === 'fix' ? 'requestFix' : kind === 'approval' ? 'requestApproval' : 'askOwner', { askId });
      if (r.card) setCard(r.card);
      if (!r.ok) setNotice(r.message);
    } catch {
      setNotice("The request couldn't be raised just now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // While a request is open the card checks again every 10 seconds (spec section 15), for 15 minutes.
  const polling = WAITING.has(card?.action?.kind ?? '') && askId !== null;
  useEffect(() => {
    if (!polling) return undefined;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > POLL_LIMIT) clearInterval(timer);
      else void recheck(true);
    }, POLL_MS);
    return () => clearInterval(timer);
    // recheck reads askId, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, askId]);

  const ask = (q: string) => {
    if (!tool || !env || !q.trim()) return;
    void run({ toolId: Number(tool.value), environmentId: env.value === ANY ? null : Number(env.value), question: q });
  };

  if (tools === null) return <Spinner />;
  if (tools.length === 0) {
    return (
      <SectionMessage appearance="information" title="No tools yet">
        <Text>A Jira administrator can load the demo data under Apps → Manage apps → Tool Passport setup.</Text>
      </SectionMessage>
    );
  }

  return (
    <Stack space="space.200">
      <Inline space="space.200" shouldWrap>
        <Box xcss={xcss({ width: '240px' })}>
          <Select options={tools} value={tool} onChange={(o: Option) => setTool(o)} placeholder="Tool" />
        </Box>
        <Box xcss={xcss({ width: '240px' })}>
          <Select options={envs} value={env} onChange={(o: Option) => setEnv(o)} placeholder="Environment" />
        </Box>
      </Inline>
      <Inline space="space.100" alignBlock="center">
        <Box xcss={xcss({ width: '480px' })}>
          <Textfield placeholder="Can I … ?" value={question} maxLength={500} onChange={(e) => setQuestion(String(e.target.value ?? ''))} />
        </Box>
        <Button appearance="primary" onClick={() => ask(question)} isDisabled={busy || !question.trim() || !env}>
          Ask
        </Button>
      </Inline>
      {suggestions.length ? (
        <Inline space="space.100" shouldWrap>
          {suggestions.map((s) => (
            <Button
              key={s}
              appearance="subtle"
              onClick={() => {
                setQuestion(s);
                ask(s);
              }}
              isDisabled={busy || !env}
            >
              {s}
            </Button>
          ))}
        </Inline>
      ) : null}
      {busy ? <Spinner /> : null}
      {notice ? (
        <SectionMessage appearance="warning">
          <Text>{notice}</Text>
        </SectionMessage>
      ) : null}
      {card ? (
        <VerdictCard card={card} busy={busy} canRecheck={askId !== null} onRecheck={() => void recheck()} onRequest={(kind) => void request(kind)} />
      ) : null}
      {failed && !card ? (
        <SectionMessage appearance="warning">
          <Text>{failed === 'not_found' ? 'That tool or environment no longer exists.' : 'Something went wrong. Try again.'}</Text>
        </SectionMessage>
      ) : null}
      <RecentQuestions refreshKey={asksMade} onAskAgain={(id) => void askAgain(id)} />
    </Stack>
  );
};

type SetupReply = { ok: true; current: RequestSetup | null; desks: DeskOption[] } | { ok: false; reason: string };
type TypesReply = { ok: true; types: DeskOption[] } | { ok: false; reason: string };
type SaveReply = { ok: true; setup: RequestSetup } | { ok: false; reason: string };

const asOption = (o: DeskOption): Option => ({ label: o.name, value: o.id });

/** Where Request the fix goes. Jira administrators only; the server checks that again on save. */
const RequestSetupSection = ({ onSaved }: { onSaved?: () => void }) => {
  const [setup, setSetup] = useState<{ current: RequestSetup | null; desks: Option[] } | null>(null);
  const [desk, setDesk] = useState<Option | null>(null);
  const [types, setTypes] = useState<Option[] | null>(null);
  const [type, setType] = useState<Option | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call<SetupReply>('requestSetup').then((r) => {
      if (!r.ok) return setMessage({ ok: false, text: r.reason });
      const desks = r.desks.map(asOption);
      setSetup({ current: r.current, desks });
      setDesk(desks.find((d) => d.value === r.current?.serviceDeskId) ?? null);
    });
  }, []);

  useEffect(() => {
    if (!desk) return;
    setTypes(null);
    setType(null);
    void call<TypesReply>('requestTypes', { serviceDeskId: desk.value }).then((r) => {
      if (!r.ok) return setMessage({ ok: false, text: r.reason });
      const list = r.types.map(asOption);
      setTypes(list);
      const current = setup?.current?.serviceDeskId === desk.value ? setup.current.requestTypeIds.fix : undefined;
      setType(list.find((t) => t.value === current) ?? null);
    });
    // setup is read once, when it arrives; the desk choice drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk]);

  const save = async () => {
    if (!desk || !type) return;
    setBusy(true);
    try {
      const r = await call<SaveReply>('saveRequestSetup', { serviceDeskId: desk.value, requestTypeId: type.value });
      setMessage(r.ok ? { ok: true, text: `Fix requests go to ${desk.label} as "${type.label}".` } : { ok: false, text: r.reason });
      if (r.ok) onSaved?.();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack space="space.150">
      <Heading as="h2">1. Requests</Heading>
      <Text>
        Request the fix, Request approval and Ask the owner each raise a private request in this service desk for the person asking. All three use the request type
        you pick here. Pick one that needs only a summary and a description.
      </Text>
      {setup ? (
        <Inline space="space.200" alignBlock="center" shouldWrap>
          <Box xcss={xcss({ width: '280px' })}>
            <Select options={setup.desks} value={desk} onChange={(o: Option) => setDesk(o)} placeholder="Service desk" />
          </Box>
          <Box xcss={xcss({ width: '280px' })}>
            <Select options={types ?? []} value={type} onChange={(o: Option) => setType(o)} placeholder={desk && !types ? 'Loading…' : 'Request type'} />
          </Box>
          <Button appearance="primary" onClick={() => void save()} isDisabled={busy || !desk || !type}>
            Save
          </Button>
        </Inline>
      ) : message ? null : (
        <Spinner />
      )}
      {types && types.length === 0 ? <Text>This desk has no request type that needs only a summary and a description.</Text> : null}
      {message ? (
        <SectionMessage appearance={message.ok ? 'success' : 'warning'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

type ResolutionReply = { ok: true; by: 'resolution' | 'status'; outcomes: DeskOption[]; map: Record<string, unknown> | null } | { ok: false; reason: string };
type Decision = 'none' | 'approved' | 'declined';

const DECISIONS: Option[] = [
  { label: 'No decision', value: 'none' },
  { label: 'Approved', value: 'approved' },
  { label: 'Declined', value: 'declined' },
];

/**
 * Which outcomes decide an approval request: Jira's resolutions, or the desk's done statuses on a site with no
 * resolutions (D41). Unmapped ones never approve (spec section 14).
 */
const ApprovalSetupSection = ({ onSaved }: { onSaved?: () => void }) => {
  const [names, setNames] = useState<string[] | null>(null);
  const [by, setBy] = useState<'resolution' | 'status'>('resolution');
  const [map, setMap] = useState<Record<string, Decision>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call<ResolutionReply>('resolutionSetup').then((r) => {
      if (!r.ok) return setMessage({ ok: false, text: r.reason });
      setBy(r.by);
      setNames(r.outcomes.map((x) => x.name));
      const current: Record<string, Decision> = {};
      for (const [name, v] of Object.entries(r.map ?? {})) if (v === 'approved' || v === 'declined') current[name] = v;
      setMap(current);
    });
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const chosen = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== 'none'));
      const r = await call<{ ok: true } | { ok: false; reason: string }>('saveResolutionMap', { map: chosen });
      const approve = Object.keys(chosen).filter((n) => chosen[n] === 'approved');
      setMessage(
        r.ok
          ? { ok: true, text: approve.length ? `Saved. Setting an approval request to ${approve.map((n) => `"${n}"`).join(' or ')} approves it.` : 'Saved. Nothing approves yet, so approvals stay off.' }
          : { ok: false, text: r.reason },
      );
      if (r.ok) onSaved?.();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack space="space.150">
      <Heading as="h2">2. Approvals</Heading>
      <Text>
        Request approval raises a private request for the approver. Choose which outcomes decide it. Anything else leaves the approval pending, and a decision only counts
        when the approver (or the person the request is assigned to) sets it.
      </Text>
      {by === 'status' ? (
        <Text>
          {names?.length
            ? "This site has no Jira resolutions, so the service desk's done statuses decide instead."
            : 'This site has no Jira resolutions. Choose the service desk under Requests first; its done statuses will decide instead.'}
        </Text>
      ) : null}
      {names ? (
        <Stack space="space.100">
          {names.map((name) => (
            <Inline key={name} space="space.200" alignBlock="center">
              <Box xcss={xcss({ width: '200px' })}>
                <Text>{name}</Text>
              </Box>
              <Box xcss={xcss({ width: '200px' })}>
                <Select
                  options={DECISIONS}
                  value={DECISIONS.find((d) => d.value === (map[name] ?? 'none'))}
                  onChange={(o: Option) => setMap({ ...map, [name]: o.value as Decision })}
                />
              </Box>
            </Inline>
          ))}
          <Inline>
            <Button appearance="primary" onClick={() => void save()} isDisabled={busy}>
              Save
            </Button>
          </Inline>
        </Stack>
      ) : message ? null : (
        <Spinner />
      )}
      {message ? (
        <SectionMessage appearance={message.ok ? 'success' : 'warning'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

// ---- Setup → Run tests (spec P0-7, section 16 step 7) ----------------------------------------------------

const keysText = (keys: Array<{ key: string; value?: unknown }> | null) =>
  keys === null ? 'not covered (unsupported)' : keys.map((k) => (k.value === undefined ? k.key : `${k.key} = ${String(k.value)}`)).join(', ') || 'nothing';

type SafetyReply = ({ ok: true } & SafetyRun) | { ok: false; reason: string };

/** The false-Yes suite (spec section 19): the build's own case list, run on the server against this app's engine. */
const SafetySuite = () => {
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<SafetyReply | null>(null);

  const run = async () => {
    setRunning(true);
    setReply(null);
    try {
      setReply(await call<SafetyReply>('runSafety'));
    } catch (e) {
      setReply({ ok: false, reason: String(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Stack space="space.150">
      <Text weight="bold">The false-Yes suite</Text>
      <Text>
        The same cases as the app&apos;s own automated safety tests. Each one starts from a question whose answer is Yes, takes away one piece of evidence (an access mapping, a
        policy rule, a group lookup, a readable record, a verified fact) or adds pressure such as &quot;my manager approved this&quot;, and the answer must then be
        anything but Yes. They use fixed test data and a scripted model inside the app: nothing on this site is read or changed, and no model is called, so a run is free.
      </Text>
      <Inline space="space.150" alignBlock="center">
        <Button appearance="primary" onClick={() => void run()} isDisabled={running}>
          Run the false-Yes suite
        </Button>
        {running ? <Spinner /> : null}
      </Inline>
      {reply && !reply.ok ? (
        <SectionMessage appearance="warning">
          <Text>{reply.reason}</Text>
        </SectionMessage>
      ) : null}
      {reply?.ok ? (
        <Stack space="space.100">
          <SectionMessage
            appearance={reply.passed === reply.total ? 'success' : 'error'}
            title={reply.passed === reply.total ? `All ${reply.total} cases passed` : `${reply.total - reply.passed} of ${reply.total} cases failed`}
          >
            <Text>{reply.passed === reply.total ? 'No case gave a Yes it should not have.' : 'A failing case means the app could give a false Yes. Do not use it until this is fixed.'}</Text>
          </SectionMessage>
          {reply.groups.map((g) => (
            <Inline key={g.group} space="space.100" alignBlock="center">
              <Lozenge appearance={g.passed === g.total ? 'success' : 'removed'}>{g.passed === g.total ? 'Passed' : 'Failed'}</Lozenge>
              <Text>{`${g.group} · ${g.passed} of ${g.total}`}</Text>
            </Inline>
          ))}
          {reply.failed.map((f) => (
            <Text key={f.id}>{`Failed ${f.group} · ${f.title}: ${f.reason}`}</Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
};

const TestsSection = ({ onRan }: { onRan?: () => void }) => {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // One run: the set in batches of BATCH, one after another (a resolver call has about 25 seconds).
  const run = async () => {
    setRunning(true);
    setError(null);
    setResults([]);
    const all: EvalResult[] = [];
    try {
      for (let from = 0; from < EVAL_QUESTIONS.length; from += BATCH) {
        const r = await call<RunReply>('runEval', { from, count: BATCH });
        if (!r.ok) {
          setError(r.reason);
          break;
        }
        all.push(...r.results);
        setResults([...all]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
      if (all.length) onRan?.();
    }
  };

  const s = results.length ? summarise(EVAL_QUESTIONS, results) : null;
  return (
    <Stack space="space.200">
      <Heading as="h2">5. Tests</Heading>
      <SafetySuite />
      <Text weight="bold">The 40-question set</Text>
      <Text>
        Run the 40-question set against the model this app uses. It makes about 40 model calls, which cost money, so a new run can start only 10 minutes after the last.
        Answers are not cached during the run.
      </Text>
      <Inline space="space.150" alignBlock="center">
        <Button appearance="primary" onClick={() => void run()} isDisabled={running}>
          Run the 40-question set
        </Button>
        {running ? <Text>{`${results.length} of ${EVAL_QUESTIONS.length}`}</Text> : null}
      </Inline>
      {error ? (
        <SectionMessage appearance="warning">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
      {s ? (
        <Stack space="space.100">
          <SectionMessage appearance={s.complete ? (s.answerable.met ? 'success' : 'error') : 'information'} title={s.complete ? (s.answerable.met ? 'Bar met' : 'Bar not met') : 'Running'}>
            <Text>{`Answerable questions exact: ${s.answerable.pass} of ${s.answerable.total} (${Math.round(s.answerable.rate * 100)}%; bar 90%). Outside the catalog marked unsupported: ${s.groups.outside.pass} of ${s.groups.outside.total} (bar 100%). Pairs consistent: ${s.pairs.consistent} of ${s.pairs.total}. Model calls: ${s.calls}.`}</Text>
          </SectionMessage>
          {Object.entries(s.groups).map(([g, v]) => (
            <Text key={g}>{`${g}: ${v.pass} of ${v.total} · ${v.bar} · ${v.met ? 'met' : 'not met'}`}</Text>
          ))}
          {s.failures.map((f) => (
            <Text key={f.id}>{`Missed ${f.id} (${f.group}): expected ${keysText(f.expected)}; got ${f.status === 'ok' ? keysText(f.got) : f.status}`}</Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
};

// ---- the setup wizard (spec F7): each step shown as done or to do, read from the server --------------------

type StatusReply = SetupStatus | { ok: false; reason: string };

const dayAndTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const StepRow = ({ n, title, done, detail }: { n: number; title: string; done: boolean; detail: string }) => (
  <Inline space="space.150" alignBlock="center" shouldWrap>
    <Box xcss={xcss({ width: '64px' })}>
      <Lozenge appearance={done ? 'success' : 'default'}>{done ? 'Done' : 'To do'}</Lozenge>
    </Box>
    <Text weight="bold">{`${n}. ${title}`}</Text>
    <Text>{detail}</Text>
  </Inline>
);

const Checklist = ({ status }: { status: SetupStatus }) => {
  const { requests, approvals, demo, model, tests } = status;
  return (
    <Stack space="space.100">
      <StepRow n={1} title="Requests" done={requests.done} detail={requests.done ? 'Service desk and request type chosen.' : 'Choose the service desk and request type.'} />
      <StepRow
        n={2}
        title="Approvals"
        done={approvals.done}
        detail={approvals.done ? `Approved when set to ${approvals.approve.map((n) => `"${n}"`).join(' or ')}.` : 'Choose which outcome approves a request. Until then approvals stay off.'}
      />
      <StepRow
        n={3}
        title="Demo data"
        done={demo.done}
        detail={demo.done ? (demo.mode === 'registry' ? 'Kestrel Studio loaded in registry mode.' : 'Kestrel Studio loaded with Assets.') : 'Load Kestrel Studio, or add your own tool at the bottom.'}
      />
      <StepRow
        n={4}
        title="Model"
        done={model.current !== null}
        detail={model.current ? `${model.current}, ${model.automatic ? 'picked automatically' : 'chosen here'}.` : 'No Claude model could be read from this site. Reload to try again.'}
      />
      <StepRow
        n={5}
        title="Tests"
        done={tests.lastRun !== null}
        detail={tests.lastRun ? `40-question set last run ${dayAndTime(tests.lastRun)}.` : 'Run the false-Yes suite and the 40-question set.'}
      />
    </Stack>
  );
};

const BeforeYouStart = () => (
  <SectionMessage appearance="information" title="Before you start">
    <Text>Everyone who asks needs the Jira Service Management Customer role, given in Atlassian Administration.</Text>
    <Text>A service desk you have just created can take about 10 minutes before Jira counts you as one of its agents. Until then requests to it can fail: wait and try again.</Text>
    <Text>If this site has no Jira resolutions, step 2 uses the service desk&apos;s done statuses instead. Nothing else is needed.</Text>
    <Text>The Rovo agent needs Rovo turned on for this site. Everything else works without it.</Text>
  </SectionMessage>
);

type ChooseReply = { ok: true; model: string } | { ok: false; reason: string };

/** The model step: only active Claude models from this site's live list (spec section 13). */
const ModelSection = ({ model, onSaved }: { model: SetupStatus['model']; onSaved: () => void }) => {
  const options: Option[] = model.choices.map((m) => ({ label: m, value: m }));
  const [picked, setPicked] = useState<Option | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const value = picked ?? options.find((o) => o.value === model.current) ?? null;

  const save = async () => {
    if (!value) return;
    setBusy(true);
    try {
      const r = await call<ChooseReply>('chooseModel', { model: value.value });
      setMessage(r.ok ? { ok: true, text: `Saved. New questions are read by ${r.model}.` } : { ok: false, text: r.reason });
      if (r.ok) onSaved();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack space="space.150">
      <Heading as="h2">4. Model</Heading>
      <Text>
        {`The model only reads each question into catalog keys and values. Fixed rules decide the answer, and the model never sees facts, rules or groups. Without a choice here, the app uses the first of ${PREFERRED_MODELS.join(', ')} that is active on this site, and moves to the next one by itself if that model is retired.`}
      </Text>
      <Text>A new choice applies to questions the app has not read before. Questions it has already read keep their saved reading.</Text>
      {options.length ? (
        <Inline space="space.200" alignBlock="center" shouldWrap>
          <Box xcss={xcss({ width: '280px' })}>
            <Select options={options} value={value} onChange={(o: Option) => setPicked(o)} placeholder="Model" />
          </Box>
          <Button appearance="primary" onClick={() => void save()} isDisabled={busy || !value || (value.value === model.current && !model.automatic)}>
            Save
          </Button>
        </Inline>
      ) : (
        <Text>No active Claude model is listed on this site right now.</Text>
      )}
      {message ? (
        <SectionMessage appearance={message.ok ? 'success' : 'warning'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

const SetupPage = () => {
  const [status, setStatus] = useState<StatusReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const reload = () => {
    void call<StatusReply>('setupStatus')
      .then(setStatus)
      .catch((e: unknown) => setStatus({ ok: false, reason: String(e) }));
  };
  useEffect(reload, []);

  const run = async (resolver: 'loadDemo' | 'resetDemo', payload?: { mode: 'assets' | 'registry' }) => {
    setBusy(true);
    setConfirmReset(false);
    try {
      const r = await call<SeedResult>(resolver, payload);
      setResult(r);
      if (r.ok) reload();
    } catch (e) {
      setResult({ ok: false, reason: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const load = (mode: 'assets' | 'registry') => run('loadDemo', { mode });
  return (
    <Stack space="space.300">
      <Text>Work through the steps in order. Each one shows Done once it is set; you can come back and change any of them.</Text>
      {status === null ? <Spinner /> : null}
      {status?.ok ? <Checklist status={status} /> : null}
      {status && !status.ok ? (
        <SectionMessage appearance="warning">
          <Text>{status.reason}</Text>
        </SectionMessage>
      ) : null}
      <BeforeYouStart />
      <RequestSetupSection onSaved={reload} />
      <ApprovalSetupSection onSaved={reload} />
      <Stack space="space.150">
        <Heading as="h2">3. Demo data</Heading>
        <Text>
          Load demo data creates the fictional tool Kestrel Studio with KS-DEV and KS-PROD, its catalog, verified facts, policy rules and access
          mappings. You become its owner. In Assets it creates the Tool Passport Environments schema with the KS-DEV and KS-PROD records, or uses
          them if they are already there. It is safe to run again.
        </Text>
        <Text>
          No Assets on this site? Load it in registry mode: the environment values are recorded by the owner in Tool Passport instead, and answers
          label them Recorded by owner, which is weaker evidence than an Assets record.
        </Text>
        <Inline space="space.100">
          <Button appearance="primary" onClick={() => void load('assets')} isDisabled={busy}>
            Load demo data
          </Button>
          <Button onClick={() => void load('registry')} isDisabled={busy}>
            Load without Assets (registry mode)
          </Button>
          <Button appearance="subtle" onClick={() => setConfirmReset(true)} isDisabled={busy}>
            Reset demo
          </Button>
        </Inline>
        {confirmReset ? (
          <SectionMessage appearance="warning" title="Reset the demo?">
            <Text>
              This deletes everything Tool Passport holds about Kestrel Studio: questions, request records, approvals, version changes, release-note labels,
              facts, rules and mappings. Then it loads the demo again from the start, and in Assets it puts KS-DEV and KS-PROD back to version 13.2 and
              their first values. Jira requests already raised stay in the service desk. Other tools are not touched. This can't be undone.
            </Text>
            <Inline space="space.100">
              <Button appearance="danger" onClick={() => void run('resetDemo')}>
                Yes, reset the demo
              </Button>
              <Button appearance="subtle" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
            </Inline>
          </SectionMessage>
        ) : null}
        {busy ? <Spinner /> : null}
        {result?.ok ? (
          <SectionMessage appearance="success" title="Demo data loaded">
            <Text>
              {Object.entries(result.counts)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </Text>
            <Text>{result.environments.map((e) => `${e.name} → ${e.providerRef}`).join(' · ')}</Text>
          </SectionMessage>
        ) : null}
        {result?.ok && result.warnings?.length ? (
          <SectionMessage appearance="warning" title="One more step">
            {result.warnings.map((w) => (
              <Text key={w}>{w}</Text>
            ))}
          </SectionMessage>
        ) : null}
        {result && !result.ok ? (
          <SectionMessage appearance="error" title="Demo data not loaded">
            <Text>{result.reason}</Text>
          </SectionMessage>
        ) : null}
      </Stack>
      {status?.ok ? <ModelSection model={status.model} onSaved={reload} /> : null}
      <TestsSection onRan={reload} />
      <AddToolSection />
    </Stack>
  );
};

// ---- My tools: the owner's open questions (spec section 15, F5) -----------------------------------------

type QuestionsReply = { ok: true; tool: { id: number; name: string }; environments: EnvInfo[]; groups: QuestionGroup[] } | { ok: false; reason: string };
type PublishReply = { ok: true; settled: string[]; stillOpen: number } | { ok: false; reason: string };
interface EnvInfo {
  id: number;
  name: string;
  version: string | null;
}

const YES_NO: Option[] = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];
const EVERYWHERE = 'all';

/** One answer for one catalog key: value, scope and version (spec F5). The server checks all of it again. */
const AnswerForm = ({ toolId, k, environments, onPublished }: { toolId: number; k: QuestionGroup['keys'][number]; environments: EnvInfo[]; onPublished: (text: string) => void }) => {
  const scopes: Option[] = [{ label: 'All environments', value: EVERYWHERE }, ...environments.map((e) => ({ label: e.name, value: String(e.id) }))];
  const [value, setValue] = useState<Option | null>(k.valueType === 'boolean' ? YES_NO[0]! : null);
  const [raw, setRaw] = useState('');
  const [scope, setScope] = useState<Option>(scopes[0]!);
  const [version, setVersion] = useState(environments.find((e) => e.version)?.version ?? '');
  const [every, setEvery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    const v = k.valueType === 'boolean' ? value?.value === 'yes' : k.valueType === 'number' ? Number(raw) : raw;
    setBusy(true);
    setError(null);
    try {
      const r = await call<PublishReply>('publishAnswer', {
        toolId,
        key: k.key,
        value: v,
        environmentId: scope.value === EVERYWHERE ? null : Number(scope.value),
        version,
        everyVersion: every,
      });
      if (!r.ok) setError(r.reason);
      else onPublished(`Published. ${r.settled.length ? `Answered and closed: ${r.settled.join(', ')}.` : 'No open question was decided by it.'} Still open: ${r.stillOpen}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack space="space.100">
      <Text weight="bold">{k.label}</Text>
      <Inline space="space.150" alignBlock="center" shouldWrap>
        <Box xcss={xcss({ width: '160px' })}>
          {k.valueType === 'boolean' ? (
            <Select options={YES_NO} value={value} onChange={(o: Option) => setValue(o)} />
          ) : (
            <Textfield placeholder={k.unit ?? (k.valueType === 'number' ? 'Number' : 'Value')} value={raw} onChange={(e) => setRaw(String(e.target.value ?? ''))} />
          )}
        </Box>
        <Box xcss={xcss({ width: '180px' })}>
          <Select options={scopes} value={scope} onChange={(o: Option) => setScope(o)} />
        </Box>
        <Box xcss={xcss({ width: '110px' })}>
          <Textfield placeholder="Version" value={version} onChange={(e) => setVersion(String(e.target.value ?? ''))} />
        </Box>
        <Checkbox label="Holds for every version" isChecked={every} onChange={() => setEvery(!every)} />
        <Button appearance="primary" onClick={() => void publish()} isDisabled={busy || !version.trim() || (k.valueType !== 'boolean' && !raw.trim())}>
          Publish
        </Button>
      </Inline>
      {error ? (
        <SectionMessage appearance="warning">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

const QuestionsForTool = ({ toolId, refreshKey }: { toolId: number; refreshKey: number }) => {
  const [data, setData] = useState<QuestionsReply | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = () => void call<QuestionsReply>('openQuestions', { toolId }).then(setData);
  // Loaded again each time the tab is opened: a question asked meanwhile must show (found live, 4.15.0).
  useEffect(load, [toolId, refreshKey]);

  if (!data) return <Spinner />;
  if (!data.ok) {
    return (
      <SectionMessage appearance="warning">
        <Text>{data.reason}</Text>
      </SectionMessage>
    );
  }
  return (
    <Stack space="space.200">
      {message ? (
        <SectionMessage appearance="success">
          <Text>{message}</Text>
        </SectionMessage>
      ) : null}
      {data.groups.length === 0 ? <Text>No open questions for {data.tool.name}.</Text> : null}
      {data.groups.map((g) => (
        <Box key={g.target} xcss={cardStyle}>
          <Stack space="space.150">
            <Text>
              Asked in {g.environments.join(', ')} · {g.requests.length} open {g.requests.length === 1 ? 'request' : 'requests'}
            </Text>
            <Inline space="space.100" shouldWrap>
              {g.requests.map((r) =>
                r.key && r.url ? (
                  <Link key={r.key} href={r.url} openNewTab>
                    {r.key}
                  </Link>
                ) : null,
              )}
            </Inline>
            {g.missing.map((m) => (
              <Text key={m}>Not verified: {m}</Text>
            ))}
            {g.keys.map((k) => (
              <AnswerForm
                key={k.key}
                toolId={data.tool.id}
                k={k}
                environments={data.environments}
                onPublished={(text) => {
                  setMessage(text);
                  load();
                }}
              />
            ))}
            {g.keys.length === 0 ? <Text>Nothing here can be answered as a fact; settle it in the request.</Text> : null}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
};

const MyToolsPage = ({ tools, refreshKey }: { tools: Option[]; refreshKey: number }) => {
  const [tool, setTool] = useState<Option>(tools[0]!);
  // One Refresh for the whole tab: it used to reload the open questions only, so a version change found by the
  // sweep showed only after switching tabs (found live). Both counters only grow, so their sum changes with either.
  const [refreshed, setRefreshed] = useState(0);
  const key = refreshKey + refreshed;
  return (
    <Stack space="space.200">
      <Inline space="space.150" alignBlock="center">
        {tools.length > 1 ? (
          <Box xcss={xcss({ width: '240px' })}>
            <Select options={tools} value={tool} onChange={(o: Option) => setTool(o)} />
          </Box>
        ) : null}
        <Button appearance="subtle" onClick={() => setRefreshed((n) => n + 1)}>
          Refresh
        </Button>
      </Inline>
      <Heading as="h2">Open questions</Heading>
      <Text>Answer each question once. Publishing adds a verified fact and answers every open question it settles, each on the asker's own request.</Text>
      <QuestionsForTool key={tool.value} toolId={Number(tool.value)} refreshKey={key} />
      <ChangesSection key={`changes-${tool.value}`} toolId={Number(tool.value)} refreshKey={key} />
      <ToolRecords key={`records-${tool.value}`} toolId={Number(tool.value)} refreshKey={key} />
    </Stack>
  );
};

/** The global page: Ask for everyone, My tools for tool owners and Jira administrators. */
const HomePage = () => {
  const [mine, setMine] = useState<Option[]>([]);
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    void call<{ tools: Array<{ id: number; name: string }> }>('myTools').then((r) => setMine(r.tools.map((t) => ({ label: t.name, value: String(t.id) }))));
  }, []);
  if (mine.length === 0) return <AskPage />;
  return (
    <Tabs id="passport-tabs" onChange={(index: number) => index === 1 && setOpened((n) => n + 1)}>
      <TabList>
        <Tab>Ask</Tab>
        <Tab>My tools</Tab>
      </TabList>
      <TabPanel>
        <Box xcss={xcss({ paddingTop: 'space.200' })}>
          <AskPage />
        </Box>
      </TabPanel>
      <TabPanel>
        <Box xcss={xcss({ paddingTop: 'space.200' })}>
          <MyToolsPage tools={mine} refreshKey={opened} />
        </Box>
      </TabPanel>
    </Tabs>
  );
};

const App = () => {
  const context = useProductContext();
  if (!context) return <Spinner />;
  // Jira already shows the module title above the page, so the page adds no heading of its own.
  return context.moduleKey === 'passport-setup' ? <SetupPage /> : <HomePage />;
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

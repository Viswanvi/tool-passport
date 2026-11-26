import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Checkbox,
  DynamicTable,
  EmptyState,
  Heading,
  Icon,
  Inline,
  Link,
  Lozenge,
  Pressable,
  ProgressTracker,
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
import type { Card, CardRequest, Chip, PathStep, Stamp } from '../engine/card';
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
import type { QuickPlan, QuickSetupReply } from '../resolvers/quick-setup';
import type { PassportReply, PassportRow } from '../resolvers/passport-handlers';
import type { StoryContextReply, StoryShareReply } from '../resolvers/story-handlers';
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

/** "until Dec 26" on an approval that lapses; "on Dec 26" on one that has. */
const untilText = (c: Chip) => (c.until && day(c.until) ? ` · ${c.label === 'Approval expired' ? 'on' : 'until'} ${day(c.until)}` : '');

function chipText(c: Chip): string {
  if (c.label === 'Assets record') return `Assets record · read ${time(c.readAt)}`;
  if (c.label === 'Recorded by owner') return `Recorded by owner${c.changedAt ? ` · ${day(c.changedAt)}` : ''}`;
  return `${c.label} · ${c.detail}${untilText(c)}`;
}

function checkLine(c: Card['checks'][number]): string {
  const chip = c.chip;
  const extra = chip.label === 'Assets record' || chip.label === 'Recorded by owner' ? `${chip.detail}${chip.changedAt ? `, changed ${day(chip.changedAt)}` : ''}` : `${chip.detail}${untilText(chip)}`;
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

// How each stamp state looks. The state itself comes from the server's card; the page only picks colours.
type Look = { glyph: 'status-success' | 'clock' | 'status-warning' | 'question-circle' | 'status-error' | 'minus'; icon: IconColor; text: TextColor; box: ReturnType<typeof xcss> };
type IconColor = 'color.icon.success' | 'color.icon.information' | 'color.icon.warning' | 'color.icon.discovery' | 'color.icon.danger' | 'color.icon.subtle';
type TextColor = 'color.text.success' | 'color.text.information' | 'color.text.warning' | 'color.text.discovery' | 'color.text.danger' | 'color.text.subtle';

const TILE = { borderWidth: 'border.width', borderStyle: 'solid', borderRadius: 'radius.medium', padding: 'space.150', flexGrow: 1, flexBasis: '0', minWidth: '150px' } as const;

const NEUTRAL: Look = { glyph: 'minus', icon: 'color.icon.subtle', text: 'color.text.subtle', box: xcss({ ...TILE, backgroundColor: 'color.background.neutral', borderColor: 'color.border' }) };
const LOOK: Record<Stamp['state'], Look> = {
  pass: { glyph: 'status-success', icon: 'color.icon.success', text: 'color.text.success', box: xcss({ ...TILE, backgroundColor: 'color.background.success', borderColor: 'color.border.success' }) },
  approval: { glyph: 'clock', icon: 'color.icon.information', text: 'color.text.information', box: xcss({ ...TILE, backgroundColor: 'color.background.information', borderColor: 'color.border.information' }) },
  missing: { glyph: 'status-warning', icon: 'color.icon.warning', text: 'color.text.warning', box: xcss({ ...TILE, backgroundColor: 'color.background.warning', borderColor: 'color.border.warning' }) },
  unknown: { glyph: 'question-circle', icon: 'color.icon.discovery', text: 'color.text.discovery', box: xcss({ ...TILE, backgroundColor: 'color.background.discovery', borderColor: 'color.border.discovery' }) },
  fail: { glyph: 'status-error', icon: 'color.icon.danger', text: 'color.text.danger', box: xcss({ ...TILE, backgroundColor: 'color.background.danger', borderColor: 'color.border.danger' }) },
  not_checked: NEUTRAL,
  none: NEUTRAL,
};

/** One passport stamp: what was checked, the answer, and the evidence label it rests on. */
const StampTile = ({ stamp }: { stamp: Stamp }) => {
  const look = LOOK[stamp.state];
  return (
    <Box xcss={look.box}>
      <Stack space="space.050">
        <Inline space="space.075" alignBlock="center">
          <Icon glyph={look.glyph} color={look.icon} label={stamp.statusText} size="small" />
          <Text weight="semibold">{stamp.title}</Text>
        </Inline>
        <Text weight="bold" color={look.text}>
          {stamp.statusText}
        </Text>
        {stamp.detail ? <Text size="small">{stamp.detail}</Text> : null}
        {stamp.chip ? (
          <Text size="small" color="color.text.subtlest">
            {chipText(stamp.chip)}
          </Text>
        ) : null}
        {stamp.more ? (
          <Text size="small" color="color.text.subtlest">
            {`+${stamp.more} more ${stamp.more === 1 ? 'check' : 'checks'}`}
          </Text>
        ) : null}
      </Stack>
    </Box>
  );
};

/** The steps left before Yes. Done steps are filled; the first step not done is the current one. */
const PathToYes = ({ path }: { path: PathStep[] }) => {
  const current = path.findIndex((s) => s.state !== 'done');
  const items = path.map((s, i) => ({
    id: s.id,
    label: s.label,
    status: (s.state === 'done' ? 'visited' : i === current ? 'current' : 'unvisited') as 'visited' | 'current' | 'unvisited',
    // A step with an open request is half way to the next one.
    percentageComplete: s.state === 'done' ? 100 : s.state === 'requested' ? 50 : 0,
  }));
  return <ProgressTracker items={items} label="Path to Yes" spacing="cozy" />;
};

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
          {card.where ? <Text color="color.text.subtle">{card.where}</Text> : null}
        </Inline>
        <Heading size="small" as="h3">
          {card.reason}
        </Heading>
        {card.banner ? (
          <SectionMessage appearance="information">
            <Text>{card.banner}</Text>
          </SectionMessage>
        ) : null}
        {card.stamps.length ? (
          <Inline space="space.100" alignBlock="stretch" shouldWrap>
            {card.stamps.map((s) => (
              <StampTile key={s.dimension} stamp={s} />
            ))}
          </Inline>
        ) : card.chips.length ? (
          <Inline space="space.100" shouldWrap>
            {card.chips.map((c) => (
              <Tag key={`${c.label}|${c.detail}`} text={chipText(c)} />
            ))}
          </Inline>
        ) : null}
        {card.path.length ? <PathToYes path={card.path} /> : null}
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
              {open ? 'Hide checks' : card.checks.length === 1 ? 'Show the check' : `Show all ${card.checks.length} checks`}
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
        {card.checked.length && !card.stamps.length ? <Text size="small">I checked: {card.checked.join(' · ')}</Text> : null}
      </Stack>
    </Box>
  );
};

type Failure = Extract<AskReply, { ok: false }>['error'];
type Changed = { from: Card; to: Card; at: string; byItself: boolean };

/**
 * One answer on screen and everything its card can do: check again, raise a request, and, while a request is
 * open, check again by itself every 10 seconds (spec section 15). Ask, a Passport cell and the story panel share
 * it, so a card behaves the same wherever it was asked.
 */
function useAnswer(onAnswered?: () => void) {
  const [busy, setBusy] = useState(false);
  // What the spinner is waiting for, in plain words.
  const [working, setWorking] = useState('');
  const [card, setCard] = useState<Card | null>(null);
  const [askId, setAskId] = useState<number | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The answer before the last re-check, when the re-check changed it: shown as "Not ready → Yes, with approval".
  const [changed, setChanged] = useState<Changed | null>(null);
  // The poller's re-check runs from an interval, so it reads the card on screen through this ref.
  const shown = useRef<Card | null>(null);
  shown.current = card;
  // How to get this answer again when there is no stored ask to re-check.
  const again = useRef<(() => Promise<void>) | null>(null);

  const clear = () => {
    setCard(null);
    setAskId(null);
    setFailed(null);
    setNotice(null);
    setChanged(null);
  };

  /** Shows the answer `get` returns; `label` says what the spinner is waiting for. */
  const show = async (label: string, get: () => Promise<AskReply>): Promise<void> => {
    setBusy(true);
    setWorking(label);
    clear();
    again.current = () => show(label, get);
    try {
      const r = await get();
      setCard(r.card);
      setAskId(r.ok ? r.askId : null);
      setFailed(r.ok ? null : r.error);
    } catch {
      setFailed('try_again');
    } finally {
      setBusy(false);
      onAnswered?.();
    }
  };

  /** A stored ask, checked again with its keys (no model call); clears "may have changed". */
  const open = async (id: number) => {
    setBusy(true);
    setWorking('Checking again…');
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
      onAnswered?.();
    }
  };

  /** Evaluates the stored ask again (no model call). Without a stored ask, the answer is fetched again. */
  const recheck = async (quiet = false) => {
    if (askId === null) {
      if (!quiet && again.current) await again.current();
      return;
    }
    if (!quiet) {
      setBusy(true);
      setWorking('Checking again…');
    }
    try {
      const r = await call<RecheckReply>('recheck', { askId });
      if (r.ok) {
        const before = shown.current;
        const changedNow = before !== null && before.title !== r.card.title;
        if (changedNow) setChanged({ from: before, to: r.card, at: new Date().toISOString(), byItself: quiet });
        setCard(r.card);
        // The server saved the new answer: lists showing it (Your recent questions) read it again.
        if (changedNow || !quiet) onAnswered?.();
      } else if (!quiet) setNotice('Could not check again just now. Try again.');
    } catch {
      if (!quiet) setNotice('Could not check again just now. Try again.');
    } finally {
      if (!quiet) setBusy(false);
    }
  };

  /** Request the fix, Request approval or Ask the owner: the payload names only the ask; the server builds the request. */
  const request = async (kind: 'fix' | 'approval' | 'question') => {
    if (askId === null) {
      setNotice('Ask the question again, then try once more.');
      return;
    }
    setBusy(true);
    setWorking('Raising your private request…');
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

  return { busy, working, card, askId, failed, notice, changed, show, open, recheck, request, clear };
}

type AnswerState = ReturnType<typeof useAnswer>;

/** The spinner, the "changed by itself" note, any notice, and the card. */
const AnswerView = ({ a }: { a: AnswerState }) => (
  <Stack space="space.150">
    {a.busy ? (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text color="color.text.subtle">{a.working}</Text>
      </Inline>
    ) : null}
    {a.changed && a.card ? (
      <SectionMessage appearance={a.changed.to.verdict === 'yes' || a.changed.to.verdict === 'yes_with_approval' ? 'success' : 'information'}>
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Text>{a.changed.byItself ? `The answer changed by itself at ${time(a.changed.at)}:` : `Checked again at ${time(a.changed.at)}:`}</Text>
          <Lozenge appearance={a.changed.from.lozenge}>{a.changed.from.title}</Lozenge>
          <Text>→</Text>
          <Lozenge appearance={a.changed.to.lozenge} isBold>
            {a.changed.to.title}
          </Lozenge>
        </Inline>
      </SectionMessage>
    ) : null}
    {a.notice ? (
      <SectionMessage appearance="warning">
        <Text>{a.notice}</Text>
      </SectionMessage>
    ) : null}
    {a.card ? (
      <VerdictCard card={a.card} busy={a.busy} canRecheck={a.askId !== null} onRecheck={() => void a.recheck()} onRequest={(kind) => void a.request(kind)} />
    ) : null}
    {a.failed && !a.card ? (
      <SectionMessage appearance="warning">
        <Text>{a.failed === 'not_found' ? 'That tool or environment no longer exists.' : 'Something went wrong. Try again.'}</Text>
      </SectionMessage>
    ) : null}
  </Stack>
);

const NoTools = () => (
  <EmptyState
    header="No tools yet"
    description="A Jira administrator can load the demo data under Jira settings → Marketplace apps → Tool Passport setup. Then ask things like “Can I build a dashboard in KS-DEV?”"
  />
);

/** The tools anyone may ask about; the only one is picked for you. */
function useTools() {
  const [tools, setTools] = useState<Option[] | null>(null);
  const [tool, setTool] = useState<Option | null>(null);
  useEffect(() => {
    void call<{ tools: Array<{ id: number; name: string }> }>('tools').then((r) => {
      const list = r.tools.map((t) => ({ label: t.name, value: String(t.id) }));
      setTools(list);
      if (list.length) setTool(list[0]!);
    });
  }, []);
  return { tools, tool, setTool };
}

const AskPage = () => {
  const { tools, tool, setTool } = useTools();
  const [envs, setEnvs] = useState<Option[]>([]);
  const [env, setEnv] = useState<Option | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [asksMade, setAsksMade] = useState(0);
  const a = useAnswer(() => setAsksMade((n) => n + 1));

  useEffect(() => {
    if (!tool) return;
    setEnv(null);
    a.clear();
    void call<{ environments: Array<{ id: number; name: string }>; suggestions: string[] }>('environments', { toolId: Number(tool.value) }).then((r) => {
      const list = [...r.environments.map((e) => ({ label: e.name, value: String(e.id) })), { label: 'Any environment', value: ANY }];
      setEnvs(list);
      setEnv(list[0] ?? null);
      setSuggestions(r.suggestions);
    });
    // a.clear only resets the answer on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const ask = (q: string) => {
    if (!tool || !env || !q.trim()) return;
    const payload = { toolId: Number(tool.value), environmentId: env.value === ANY ? null : Number(env.value), question: q };
    void a.show('Reading your question, then checking the tool, policy, setup and access…', () => call<AskReply>('ask', payload));
  };

  if (tools === null) return <Spinner />;
  if (tools.length === 0) return <NoTools />;

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
        <Button appearance="primary" onClick={() => ask(question)} isDisabled={a.busy || !question.trim() || !env}>
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
              isDisabled={a.busy || !env}
            >
              {s}
            </Button>
          ))}
        </Inline>
      ) : null}
      <AnswerView a={a} />
      <RecentQuestions refreshKey={asksMade} onAskAgain={(id) => void a.open(id)} />
    </Stack>
  );
};

// ---- the Passport overview: every capability in every environment, for the person looking ----------------

const cellStyle = xcss({ padding: 'space.050', borderRadius: 'radius.small', ':hover': { backgroundColor: 'color.background.neutral.subtle.hovered' } });

type OpenCell = (row: PassportRow, cell: PassportRow['cells'][number], environment: string) => void;

/** Capabilities down the side, environments across the top; each cell opens its card. */
const PassportTable = ({ data, rows, picked, onOpen, label }: { data: Extract<PassportReply, { ok: true }>; rows: PassportRow[]; picked: string | null; onOpen: OpenCell; label: string }) => (
  <DynamicTable
    label={label}
    head={{
      cells: [
        { key: 'capability', content: 'Capability', width: 40 },
        ...data.environments.map((e) => ({ key: String(e.id), content: e.version ? `${e.name} · ${e.version}` : e.name })),
      ],
    }}
    rows={rows.map((row) => ({
      key: row.key,
      isHighlighted: picked === row.key,
      cells: [
        { key: 'capability', content: <Text>{row.label}</Text> },
        ...row.cells.map((cell) => {
          const environment = data.environments.find((e) => e.id === cell.environmentId)?.name ?? '';
          return {
            key: String(cell.environmentId),
            content: (
              <Pressable xcss={cellStyle} onClick={() => onOpen(row, cell, environment)}>
                <Lozenge appearance={cell.lozenge} isBold>
                  {cell.title}
                </Lozenge>
              </Pressable>
            ),
          };
        }),
      ],
    }))}
  />
);

const PassportPage = ({ refreshKey }: { refreshKey: number }) => {
  const { tools, tool, setTool } = useTools();
  const [data, setData] = useState<PassportReply | null>(null);
  const [picked, setPicked] = useState<{ key: string; label: string; environment: string } | null>(null);
  // Bumped by "Check again".
  const [round, setRound] = useState(0);
  const [showUnknown, setShowUnknown] = useState(false);
  const a = useAnswer();

  useEffect(() => {
    if (!tool) return;
    setData(null);
    void call<PassportReply>('passport', { toolId: Number(tool.value) })
      .then(setData)
      .catch((e: unknown) => setData({ ok: false, reason: String(e) }));
  }, [tool, refreshKey, round]);

  if (tools === null) return <Spinner />;
  if (tools.length === 0) return <NoTools />;

  // Rows nobody has verified anywhere are folded away, so the grid leads with what is known.
  const rows = data?.ok ? data.rows : [];
  const unknown = rows.filter((r) => r.cells.length > 0 && r.cells.every((c) => c.verdict === 'dont_know'));
  const known = rows.filter((r) => !unknown.includes(r));

  const openCell = (row: PassportRow, cell: PassportRow['cells'][number], environment: string) => {
    if (!tool) return;
    setPicked({ key: row.key, label: row.label, environment });
    void a.show('Checking the tool, policy, setup and access…', () => call<AskReply>('askKey', { toolId: Number(tool.value), environmentId: cell.environmentId, key: row.key }));
  };

  return (
    <Stack space="space.200">
      <Inline space="space.200" alignBlock="center" shouldWrap>
        {tools.length > 1 ? (
          <Box xcss={xcss({ width: '240px' })}>
            <Select options={tools} value={tool} onChange={(o: Option) => setTool(o)} placeholder="Tool" />
          </Box>
        ) : null}
        <Button appearance="subtle" onClick={() => setRound((n) => n + 1)} isDisabled={data === null}>
          Check again
        </Button>
      </Inline>
      {data === null ? (
        <Inline space="space.100" alignBlock="center">
          <Spinner size="small" />
          <Text color="color.text.subtle">Checking every capability in every environment, as you…</Text>
        </Inline>
      ) : !data.ok ? (
        <SectionMessage appearance="warning">
          <Text>{data.reason}</Text>
        </SectionMessage>
      ) : (
        <Stack space="space.150">
          <Heading as="h2" size="medium">{`Your passport for ${data.tool}`}</Heading>
          <Text color="color.text.subtle">
            {`What you can do, everywhere, checked as you at ${time(data.checkedAt)}. Each cell is the answer Ask would give, from the same checks and records. Click one to see why and what to do next.`}
          </Text>
          <PassportTable data={data} rows={known} picked={picked?.key ?? null} onOpen={openCell} label={`What you can do with ${data.tool}, by environment`} />
          {unknown.length ? (
            <Stack space="space.100">
              <Inline space="space.100" alignBlock="center" shouldWrap>
                <Lozenge appearance="new">{`Not verified yet · ${unknown.length}`}</Lozenge>
                <Text color="color.text.subtle">
                  {`Nobody has verified ${unknown.length === 1 ? 'this capability' : 'these capabilities'} for ${data.tool} yet, so every environment says Don't know yet. Open one to ask the owner.`}
                </Text>
                <Button appearance="subtle" onClick={() => setShowUnknown(!showUnknown)}>
                  {showUnknown ? 'Hide them' : 'Show them'}
                </Button>
              </Inline>
              {showUnknown ? <PassportTable data={data} rows={unknown} picked={picked?.key ?? null} onOpen={openCell} label={`Capabilities of ${data.tool} nobody has verified yet`} /> : null}
            </Stack>
          ) : null}
        </Stack>
      )}
      {picked ? <Heading as="h3" size="small">{`${picked.label} · ${picked.environment}`}</Heading> : null}
      <AnswerView a={a} />
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
            ? "This site has no Jira resolutions, so the service desk's done statuses decide instead. Jira won't let an agent resolve a request until resolutions exist: add Done and Declined under Jira settings → Work items → Resolutions, then reload this page."
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
    <Text>
      You need no extra role to try the demo yourself. Other people who ask need the Jira Service Management Customer role, given in Atlassian Administration.
    </Text>
    <Text>
      A service desk you have just created can take about 10 minutes before Jira counts you as one of its agents. Until then its requests open in the customer portal;
      you can still resolve them there with Resolve this issue.
    </Text>
    <Text>
      If Jira settings → Work items → Resolutions is empty on this site, add Done and Declined there before step 2. With no resolutions, Jira won&apos;t let an
      agent resolve a request.
    </Text>
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

type PlanReply = QuickPlan | { ok: false; reason: string };

const PlanRow = ({ state, text }: { state: 'done' | 'will' | 'stop'; text: string }) => (
  <Inline space="space.100" alignBlock="start">
    {state === 'done' ? (
      <Icon glyph="status-success" color="color.icon.success" label="Already set" size="small" />
    ) : state === 'will' ? (
      <Icon glyph="arrow-right" color="color.icon.brand" label="Will be set" size="small" />
    ) : (
      <Icon glyph="status-warning" color="color.icon.warning" label="Needs you" size="small" />
    )}
    <Text>{text}</Text>
  </Inline>
);

const quoted = (names: string[]) => names.map((n) => `“${n}”`).join(' or ');

/** Steps 1 to 3 in one click: the server proposes exactly what it would set, and sets it only on the click. */
const QuickSetup = ({ refreshKey, onDone }: { refreshKey: number; onDone: () => void }) => {
  const [plan, setPlan] = useState<PlanReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<QuickSetupReply | null>(null);

  useEffect(() => {
    void call<PlanReply>('quickSetupPlan')
      .then(setPlan)
      .catch((e: unknown) => setPlan({ ok: false, reason: String(e) }));
  }, [refreshKey]);

  const apply = async (mode: 'assets' | 'registry') => {
    setBusy(true);
    setReply(null);
    try {
      const r = await call<QuickSetupReply>('quickSetup', { mode });
      setReply(r);
      onDone();
    } catch (e) {
      setReply({ ok: false, reason: String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (plan === null) return <Spinner />;
  if (!plan.ok) {
    return (
      <SectionMessage appearance="warning">
        <Text>{plan.reason}</Text>
      </SectionMessage>
    );
  }
  const { requests, approvals, demo } = plan;
  const allSet = requests.state === 'done' && approvals.state === 'done' && demo.state === 'done';
  const warnings = reply?.ok ? (reply.seed?.ok ? (reply.seed.warnings ?? []) : []) : [];
  return (
    <Box xcss={cardStyle}>
      <Stack space="space.150">
        <Heading as="h2" size="medium">
          {allSet ? 'Ready to ask' : 'Set up in one click'}
        </Heading>
        {allSet ? (
          <Text>Steps 1 to 3 are done. Open Tool Passport from the sidebar (Apps → Tool Passport), pick KS-DEV and ask the first suggested question.</Text>
        ) : (
          <Text>One click does steps 1 to 3 below for you. Here is exactly what it will set; change any of it later in its own step.</Text>
        )}
        <Stack space="space.075">
          <PlanRow
            state={requests.state === 'done' ? 'done' : requests.state === 'will_set' ? 'will' : 'stop'}
            text={
              requests.state === 'blocked'
                ? (requests.reason ?? 'Choose a service desk under 1. Requests.')
                : `Requests ${requests.state === 'done' ? 'go' : 'will go'} to ${requests.desk} as “${requests.requestType}”.`
            }
          />
          <PlanRow
            state={approvals.state === 'done' ? 'done' : approvals.state === 'will_set' ? 'will' : 'stop'}
            text={
              approvals.state === 'manual'
                ? (approvals.reason ?? 'Choose which outcome approves under 2. Approvals.')
                : `Resolution ${quoted(approvals.approve)} ${approvals.state === 'done' ? 'approves' : 'will approve'}${approvals.decline.length ? ` and ${quoted(approvals.decline)} ${approvals.state === 'done' ? 'declines' : 'will decline'}` : ''}. Any other outcome leaves an approval pending.`
            }
          />
          <PlanRow
            state={demo.state === 'done' ? 'done' : 'will'}
            text={
              demo.state === 'done'
                ? 'Kestrel Studio is loaded.'
                : 'Load Kestrel Studio: the tool, its verified facts, policy rules and access, two Assets records and two groups. You become its owner.'
            }
          />
        </Stack>
        {!allSet ? (
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Button appearance="primary" onClick={() => void apply('assets')} isDisabled={busy || !plan.ready}>
              Set it all up
            </Button>
            {demo.state === 'will_load' ? (
              <Button appearance="subtle" onClick={() => void apply('registry')} isDisabled={busy || !plan.ready}>
                No Assets? Set up in registry mode
              </Button>
            ) : null}
          </Inline>
        ) : null}
        {busy ? (
          <Inline space="space.100" alignBlock="center">
            <Spinner size="small" />
            <Text color="color.text.subtle">Setting up. Loading the demo takes up to a minute…</Text>
          </Inline>
        ) : null}
        {reply && !reply.ok ? (
          <SectionMessage appearance="warning">
            <Text>{reply.reason}</Text>
          </SectionMessage>
        ) : null}
        {warnings.length ? (
          <SectionMessage appearance="warning" title="One more step">
            {warnings.map((w) => (
              <Text key={w}>{w}</Text>
            ))}
          </SectionMessage>
        ) : null}
      </Stack>
    </Box>
  );
};

const SetupPage = () => {
  const [status, setStatus] = useState<StatusReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  // Bumped after one-click setup, so the step sections below read what it saved.
  const [version, setVersion] = useState(0);
  // Bumped after any step saves, so the one-click plan reads it again.
  const [planKey, setPlanKey] = useState(0);

  const readStatus = () => {
    void call<StatusReply>('setupStatus')
      .then(setStatus)
      .catch((e: unknown) => setStatus({ ok: false, reason: String(e) }));
  };
  useEffect(readStatus, []);
  const reload = () => {
    readStatus();
    setPlanKey((k) => k + 1);
  };

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
      <QuickSetup
        refreshKey={planKey}
        onDone={() => {
          reload();
          setVersion((v) => v + 1);
        }}
      />
      <Text>Or work through the steps in order. Each one shows Done once it is set; you can come back and change any of them.</Text>
      {status === null ? <Spinner /> : null}
      {status?.ok ? <Checklist status={status} /> : null}
      {status && !status.ok ? (
        <SectionMessage appearance="warning">
          <Text>{status.reason}</Text>
        </SectionMessage>
      ) : null}
      <BeforeYouStart />
      <RequestSetupSection key={`requests-${version}`} onSaved={reload} />
      <ApprovalSetupSection key={`approvals-${version}`} onSaved={reload} />
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

// ---- "Check this story": the panel on a Jira work item --------------------------------------------------------

/** The work item comes from the panel's Forge context on the server; the page sends only the tool and environment. */
/**
 * "Add to story" under a story's answer: posts it as the person's comment, built on the server from the stored ask.
 * One click per answer shown; a changed answer can be added again.
 */
const AddToStory = ({ a }: { a: AnswerState }) => {
  const [sending, setSending] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const card = a.card;
  if (!card || card.kind !== 'verdict' || !card.verdict || a.askId === null) return null;
  const key = `${a.askId}:${card.title}`;
  const add = async () => {
    setSending(true);
    setNote(null);
    try {
      const r = await call<StoryShareReply>('storyShare', { askId: a.askId });
      if (r.ok) {
        setAdded(key);
        setNote({
          ok: true,
          text: r.following
            ? 'Added to this work item as your comment. When a request for it is resolved, Tool Passport adds the new answer there too.'
            : 'Added to this work item as your comment.',
        });
      } else setNote({ ok: false, text: r.message });
    } catch {
      setNote({ ok: false, text: "The answer couldn't be added just now. Try again." });
    } finally {
      setSending(false);
    }
  };
  return (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Button onClick={() => void add()} isDisabled={a.busy || sending || added === key}>
          {added === key ? 'Added to story' : 'Add to story'}
        </Button>
        {added === key ? null : <Text size="small" color="color.text.subtlest">Posts this answer, its stamps and the path to Yes as your comment, so the team sees it.</Text>}
      </Inline>
      {note ? (
        <SectionMessage appearance={note.ok ? 'success' : 'warning'}>
          <Text>{note.text}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

const StoryPanel = () => {
  const [ctx, setCtx] = useState<StoryContextReply | null>(null);
  const [tool, setTool] = useState<Option | null>(null);
  const [env, setEnv] = useState<Option | null>(null);
  const a = useAnswer();

  useEffect(() => {
    void call<StoryContextReply>('storyContext')
      .then((r) => {
        setCtx(r);
        if (!r.ok || !r.tools.length) return;
        const suggested = r.environments.find((e) => e.id === r.suggestedEnvironmentId);
        const t = r.tools.find((x) => x.id === (suggested?.toolId ?? r.tools[0]!.id))!;
        setTool({ label: t.name, value: String(t.id) });
        setEnv(suggested ? { label: suggested.name, value: String(suggested.id) } : null);
      })
      .catch((e: unknown) => setCtx({ ok: false, reason: String(e) }));
  }, []);

  if (ctx === null) return <Spinner />;
  if (!ctx.ok) {
    return (
      <SectionMessage appearance="warning">
        <Text>{ctx.reason}</Text>
      </SectionMessage>
    );
  }
  if (!ctx.tools.length) return <Text>No tools are set up in Tool Passport yet.</Text>;
  const toolOptions = ctx.tools.map((t) => ({ label: t.name, value: String(t.id) }));
  const envOptions = [...ctx.environments.filter((e) => String(e.toolId) === tool?.value).map((e) => ({ label: e.name, value: String(e.id) })), { label: 'Any environment', value: ANY }];
  const named = ctx.environments.find((e) => e.id === ctx.suggestedEnvironmentId);
  const check = () => {
    if (!tool || !env) return;
    const payload = { toolId: Number(tool.value), environmentId: env.value === ANY ? null : Number(env.value) };
    void a.show('Reading the story, then checking the tool, policy, setup and access…', () => call<AskReply>('storyCheck', payload));
  };

  return (
    <Stack space="space.150">
      <Text>Can this story be built where it will run? Tool Passport reads it, matches it to the tool&apos;s catalog and checks it as you, before the work starts.</Text>
      <Inline space="space.100" alignBlock="center" shouldWrap>
        {toolOptions.length > 1 ? (
          <Box xcss={xcss({ width: '180px' })}>
            <Select
              options={toolOptions}
              value={tool}
              onChange={(o: Option) => {
                setTool(o);
                setEnv(null);
              }}
              placeholder="Tool"
            />
          </Box>
        ) : null}
        <Box xcss={xcss({ width: '180px' })}>
          <Select options={envOptions} value={env} onChange={(o: Option) => setEnv(o)} placeholder="Environment" />
        </Box>
        <Button appearance="primary" onClick={check} isDisabled={a.busy || !tool || !env}>
          Check this story
        </Button>
      </Inline>
      {named && env?.value === String(named.id) ? <Text size="small" color="color.text.subtlest">{`${named.name} is named in the story.`}</Text> : null}
      <AnswerView a={a} />
      <AddToStory a={a} />
    </Stack>
  );
};

const tabBody = xcss({ paddingTop: 'space.200' });

/** The global page: Ask and Passport for everyone, My tools for tool owners and Jira administrators. */
const HomePage = () => {
  const [mine, setMine] = useState<Option[]>([]);
  // Opening a tab reads it again: Passport is tab 1, My tools tab 2.
  const [opened, setOpened] = useState({ passport: 0, mine: 0 });
  useEffect(() => {
    void call<{ tools: Array<{ id: number; name: string }> }>('myTools').then((r) => setMine(r.tools.map((t) => ({ label: t.name, value: String(t.id) }))));
  }, []);
  const onChange = (index: number) =>
    setOpened((o) => (index === 1 ? { ...o, passport: o.passport + 1 } : index === 2 ? { ...o, mine: o.mine + 1 } : o));
  const ask = (
    <TabPanel>
      <Box xcss={tabBody}>
        <AskPage />
      </Box>
    </TabPanel>
  );
  const passport = (
    <TabPanel>
      <Box xcss={tabBody}>
        <PassportPage refreshKey={opened.passport} />
      </Box>
    </TabPanel>
  );
  if (mine.length === 0) {
    return (
      <Tabs id="passport-tabs" onChange={onChange}>
        <TabList>
          <Tab>Ask</Tab>
          <Tab>Passport</Tab>
        </TabList>
        {ask}
        {passport}
      </Tabs>
    );
  }
  return (
    <Tabs id="passport-tabs" onChange={onChange}>
      <TabList>
        <Tab>Ask</Tab>
        <Tab>Passport</Tab>
        <Tab>My tools</Tab>
      </TabList>
      {ask}
      {passport}
      <TabPanel>
        <Box xcss={tabBody}>
          <MyToolsPage tools={mine} refreshKey={opened.mine} />
        </Box>
      </TabPanel>
    </Tabs>
  );
};

const App = () => {
  const context = useProductContext();
  if (!context) return <Spinner />;
  // Jira already shows the module title above the page, so the page adds no heading of its own.
  if (context.moduleKey === 'passport-setup') return <SetupPage />;
  if (context.moduleKey === 'passport-story') return <StoryPanel />;
  return <HomePage />;
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

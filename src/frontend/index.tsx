import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Link,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Tag,
  Text,
  Textfield,
  User,
  useProductContext,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import type { Card, CardRequest, Chip } from '../engine/card';
import type { RaiseReply, RecheckReply, RequestSetup } from '../loop/requests';
import type { AskReply } from '../resolvers/handlers';
import type { Option as DeskOption } from '../resolvers/request-handlers';
import type { SeedResult } from '../seed/demo';

/**
 * UI Kit screens (spec section 15). The page shows what the resolvers return and decides nothing: verdicts,
 * reasons, chips and actions all come from the server's card. Times are formatted here, in the viewer's own
 * time zone. Actions that aren't wired yet (request the fix, request approval, ask the owner: Phase 1 step 6
 * and Phase 2) are shown as the next step in words, not as buttons that do nothing.
 */

interface Option {
  label: string;
  value: string;
}

const ANY = 'any';
const POLL_MS = 10_000;
const POLL_LIMIT = 90;

const cardStyle = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'radius.medium',
  padding: 'space.200',
});

/** invoke() resolves to the resolver's return value when no metadata is asked for. */
async function call<T>(key: string, payload: Record<string, unknown> = {}): Promise<T> {
  return (await invoke(key, payload)) as T;
}

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
const NEXT_STEP: Record<string, string> = {
  request_approval: 'Next step: request approval.',
  ask_owner: 'Next step: ask the tool owner.',
};

/** "Fix requested from Marco · view request", one line per open request. Names are looked up by the page. */
const OpenRequests = ({ requests }: { requests: CardRequest[] }) => (
  <Stack space="space.050">
    {requests.map((r, i) => (
      <Inline key={r.key ?? `raising-${i}`} space="space.100" alignBlock="center" shouldWrap>
        <Text>{r.key ? `Fix requested (${r.key}) from` : 'Fix being requested from'}</Text>
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
  onRequestFix: () => void;
  canRecheck: boolean;
}

const VerdictCard = ({ card, busy, onRecheck, onRequestFix, canRecheck }: { card: Card } & CardActions) => {
  const [open, setOpen] = useState(false);
  const kind = card.action?.kind;
  const button = kind === 'recheck' || kind === 'try_again' || kind === 'request_fix';
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
        {kind === 'fix_requested' && card.action?.requests ? <OpenRequests requests={card.action.requests} /> : null}
        <Inline space="space.150" alignBlock="center" shouldWrap>
          {button && card.action ? (
            <Button appearance="primary" onClick={kind === 'request_fix' ? onRequestFix : onRecheck} isDisabled={busy}>
              {card.action.label}
            </Button>
          ) : null}
          {card.action && NEXT_STEP[card.action.kind] ? (
            <Text>{card.action.kind === 'request_approval' && card.action.requestKey ? card.action.label : NEXT_STEP[card.action.kind]}</Text>
          ) : null}
          {kind === 'fix_requested' && canRecheck ? (
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

  const requestFix = async () => {
    if (askId === null) {
      setNotice('Ask the question again, then request the fix.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await call<RaiseReply>('requestFix', { askId });
      if (r.card) setCard(r.card);
      if (!r.ok) setNotice(r.message);
    } catch {
      setNotice("The request couldn't be raised just now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // While a fix request is open the card checks again every 10 seconds (spec section 15), for 15 minutes.
  const polling = card?.action?.kind === 'fix_requested' && askId !== null;
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
        <VerdictCard card={card} busy={busy} canRecheck={askId !== null} onRecheck={() => void recheck()} onRequestFix={() => void requestFix()} />
      ) : null}
      {failed && !card ? (
        <SectionMessage appearance="warning">
          <Text>{failed === 'not_found' ? 'That tool or environment no longer exists.' : 'Something went wrong. Try again.'}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

type SetupReply = { ok: true; current: RequestSetup | null; desks: DeskOption[] } | { ok: false; reason: string };
type TypesReply = { ok: true; types: DeskOption[] } | { ok: false; reason: string };
type SaveReply = { ok: true; setup: RequestSetup } | { ok: false; reason: string };

const asOption = (o: DeskOption): Option => ({ label: o.name, value: o.id });

/** Where Request the fix goes. Jira administrators only; the server checks that again on save. */
const RequestSetupSection = () => {
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
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack space="space.150">
      <Heading as="h2">Requests</Heading>
      <Text>
        Request the fix raises a private request in this service desk for the person asking, assigned to the owner. Pick a request type that needs only a summary
        and a description. Everyone who asks needs the Jira Service Management Customer role, given in Atlassian Administration.
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

const SetupPage = () => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const load = async () => {
    setBusy(true);
    try {
      setResult(await call<SeedResult>('loadDemo'));
    } catch (e) {
      setResult({ ok: false, reason: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack space="space.200">
      <Text>
        Load demo data creates the fictional tool Kestrel Studio with KS-DEV and KS-PROD, its catalog, verified facts, policy rules and access
        mappings. You become its owner. It links to the KS-DEV and KS-PROD objects already in the Tool Passport Environments schema in Assets.
      </Text>
      <Inline>
        <Button appearance="primary" onClick={() => void load()} isDisabled={busy}>
          Load demo data
        </Button>
      </Inline>
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
      {result && !result.ok ? (
        <SectionMessage appearance="error" title="Demo data not loaded">
          <Text>{result.reason}</Text>
        </SectionMessage>
      ) : null}
      <RequestSetupSection />
      <Text>The rest of the setup wizard (approval and question request types, resolution mapping, model choice) arrives in Phase 4.</Text>
    </Stack>
  );
};

const App = () => {
  const context = useProductContext();
  if (!context) return <Spinner />;
  const isSetup = context.moduleKey === 'passport-setup';
  return (
    <Stack space="space.300">
      <Heading as="h1">{isSetup ? 'Tool Passport setup' : 'Tool Passport'}</Heading>
      {isSetup ? <SetupPage /> : <AskPage />}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

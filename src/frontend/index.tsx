import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Tag,
  Text,
  Textfield,
  useProductContext,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import type { Card, Chip } from '../engine/card';
import type { AskReply } from '../resolvers/handlers';
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

const NEXT_STEP: Record<string, string> = {
  request_fix: 'Next step: request the fix.',
  request_approval: 'Next step: request approval.',
  ask_owner: 'Next step: ask the tool owner.',
};

const VerdictCard = ({ card, onRecheck, busy }: { card: Card; onRecheck: () => void; busy: boolean }) => {
  const [open, setOpen] = useState(false);
  const wired = card.action && (card.action.kind === 'recheck' || card.action.kind === 'try_again');
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
        <Inline space="space.150" alignBlock="center" shouldWrap>
          {wired && card.action ? (
            <Button appearance="primary" onClick={onRecheck} isDisabled={busy}>
              {card.action.label}
            </Button>
          ) : null}
          {card.action && !wired ? <Text>{card.action.kind === 'request_approval' && card.action.requestKey ? card.action.label : NEXT_STEP[card.action.kind]}</Text> : null}
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
  const [reply, setReply] = useState<AskReply | null>(null);
  const [asked, setAsked] = useState<{ toolId: number; environmentId: number | null; question: string } | null>(null);

  useEffect(() => {
    void call<{ tools: Array<{ id: number; name: string }> }>('tools').then((r) => {
      const list = r.tools.map((t) => ({ label: t.name, value: String(t.id) }));
      setTools(list);
      if (list.length === 1) setTool(list[0]!);
    });
  }, []);

  useEffect(() => {
    if (!tool) return;
    setEnv(null);
    setReply(null);
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
    try {
      setReply(await call<AskReply>('ask', payload));
    } catch {
      setReply({ ok: false, error: 'try_again', card: null });
    } finally {
      setBusy(false);
    }
  };

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

  const card = reply?.card ?? null;
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
      {card ? <VerdictCard card={card} busy={busy} onRecheck={() => asked && void run(asked)} /> : null}
      {reply && !reply.ok && !reply.card ? (
        <SectionMessage appearance="warning">
          <Text>{reply.error === 'not_found' ? 'That tool or environment no longer exists.' : 'Something went wrong. Try again.'}</Text>
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
      <Text>The rest of the setup wizard (service desk, request types, resolution mapping, model choice) arrives in Phase 4.</Text>
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

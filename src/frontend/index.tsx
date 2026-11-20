import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  CodeBlock,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';

interface RunRow {
  id: number;
  experiment: string;
  context: string;
  ok: boolean;
  summary: string;
  ran_at: string;
}

interface Status {
  migrations: { ok: boolean; appliedNow?: string[]; error?: string };
  e10?: { ticks: number; first?: string; last?: string; maxGapMinutes: number; gapsOver10: number };
  runs?: RunRow[];
}

/** invoke() may wrap the resolver's return value as { body, metadata }; our replies never have a top-level body. */
async function call<T>(key: string, payload?: Record<string, unknown>): Promise<T> {
  const res: unknown = await invoke<T>(key, payload);
  return (res !== null && typeof res === 'object' && 'body' in res ? (res as { body: T }).body : res) as T;
}

/** Phase 0 only: buttons for the experiments that need a signed-in person. Removed after Phase 0. */
const Experiments = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [output, setOutput] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await call<Status>('exp.status'));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (label: string, key: string, payload?: Record<string, unknown>) => {
    setBusy(label);
    try {
      const res = await call<unknown>(key, payload);
      setOutput(JSON.stringify(res, null, 2));
    } catch (e) {
      setOutput(`Error: ${String(e)}`);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  return (
    <Stack space="space.200">
      <SectionMessage appearance="warning" title="Phase 0 experiments (temporary)">
        <Text>These buttons exist only to run spec experiments E1 and E3 as a signed-in person. They are removed before Phase 0 sign-off.</Text>
      </SectionMessage>

      <ButtonGroup>
        <Button isDisabled={busy !== null} onClick={() => run('setup', 'exp.e1.setup')}>
          E1 · Create test schema (admin)
        </Button>
        <Button appearance="primary" isDisabled={busy !== null} onClick={() => run('read', 'exp.e1.read')}>
          E1 · Read as me
        </Button>
        <Button isDisabled={busy !== null} onClick={() => run('status', 'exp.status')}>
          Refresh status
        </Button>
      </ButtonGroup>
      {busy && (
        <Inline space="space.100" alignBlock="center">
          <Spinner />
          <Text>Running {busy}…</Text>
        </Inline>
      )}

      {status && (
        <Stack space="space.100">
          <Heading as="h3">Status</Heading>
          <Text>
            Migrations: {status.migrations.ok ? 'ok' : `failed: ${status.migrations.error ?? ''}`}
          </Text>
          {status.e10 && (
            <Text>
              E10: {status.e10.ticks} ticks, max gap {status.e10.maxGapMinutes} min, gaps over 10 min: {status.e10.gapsOver10}
              {status.e10.first ? ` (from ${status.e10.first} to ${status.e10.last})` : ''}
            </Text>
          )}
          {(status.runs ?? [])
            .filter((r) => r.experiment !== 'E10')
            .slice(0, 12)
            .map((r) => (
              <Inline key={r.id} space="space.100" alignBlock="center">
                <Lozenge appearance={r.ok ? 'success' : 'removed'}>{r.ok ? 'ok' : 'fail'}</Lozenge>
                <Text>
                  #{r.id} {r.experiment} {r.context} · {r.ran_at} · {r.summary}
                </Text>
                <Button appearance="subtle" onClick={() => run(`run ${r.id}`, 'exp.run', { id: r.id })}>
                  detail
                </Button>
              </Inline>
            ))}
        </Stack>
      )}

      {output && (
        <Box>
          <CodeBlock language="json" text={output} />
        </Box>
      )}
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
      {isSetup ? (
        <Text>The setup wizard arrives in Phase 4.</Text>
      ) : (
        <>
          <Text>Ask whether you can do something with a company tool, here and now. The Ask page arrives in Phase 1.</Text>
          <Experiments />
        </>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

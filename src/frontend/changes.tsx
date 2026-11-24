import React, { useEffect, useState } from 'react';
import { Box, Button, Heading, Inline, Lozenge, SectionMessage, Select, Spinner, Stack, Text, TextArea, Textfield, xcss } from '@forge/react';
import type { LabelKind } from '../change/release-notes';
import type { ChangeView, RecentAsk } from '../resolvers/change-handlers';
import { call, cardStyle, type Option } from './common';

/**
 * Version changes (spec F6, section 15): the owner's Changes list, with "Still true" in one click and "Changed"
 * opening the fact form; and the asker's recent questions with "May have changed: ask again".
 */

type ChangesReply = { ok: true; changes: ChangeView[] } | { ok: false; reason: string };
type Reply = { ok: true; settled?: string[] } | { ok: false; reason: string };

const show = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : v === null || v === undefined ? 'nothing' : String(v));
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const YES_NO: Option[] = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

/** Release-note labels (F9): suggestions only, worded so they never read as a verification. */
const SUGGESTION: Record<LabelKind, { text: string; appearance: 'success' | 'moved' | 'removed' | 'default' }> = {
  still_true: { text: 'Notes: still true', appearance: 'success' },
  changed: { text: 'Notes: changed', appearance: 'moved' },
  removed: { text: 'Notes: removed', appearance: 'removed' },
  cant_tell: { text: "Notes don't say", appearance: 'default' },
};

/** The labeller's limit (MAX_NOTES_CHARS in change/release-notes.ts; not imported, it pulls server code in). */
const MAX_NOTES = 20000;

type LabelReply = { ok: true; labelled: number; grounded: number } | { ok: false; reason: string };

/** "Changed": the new value for the new version, saved through the same fact write as My tools → Records. */
const ChangedForm = ({ toolId, to, fact, onDone }: { toolId: number; to: string; fact: ChangeView['toRecheck'][number]; onDone: (text: string, ok: boolean) => void }) => {
  const [yes, setYes] = useState(fact.was === false ? 'no' : 'yes');
  const [raw, setRaw] = useState('');
  const save = async () => {
    const value = fact.valueType === 'boolean' ? yes === 'yes' : fact.valueType === 'number' ? Number(raw) : raw;
    const r = await call<Reply>('edit', {
      entity: 'fact',
      toolId,
      key: fact.key,
      environmentId: fact.environmentId,
      audienceGroup: fact.audienceGroup,
      value,
      version: to,
      everyVersion: false,
      quote: null,
    });
    onDone(r.ok ? `${fact.label}: changed on ${to}.` : r.reason, r.ok);
  };
  return (
    <Inline space="space.100" alignBlock="center">
      <Box xcss={xcss({ width: '140px' })}>
        {fact.valueType === 'boolean' ? (
          <Select options={YES_NO} value={YES_NO.find((o) => o.value === yes)} onChange={(o: Option) => setYes(o.value)} />
        ) : (
          <Textfield value={raw} placeholder={fact.unit ?? 'New value'} onChange={(e) => setRaw(String(e.target.value ?? ''))} />
        )}
      </Box>
      <Button appearance="primary" onClick={() => void save()} isDisabled={fact.valueType !== 'boolean' && !raw.trim()}>
        Save
      </Button>
    </Inline>
  );
};

export const ChangesSection = ({ toolId, refreshKey }: { toolId: number; refreshKey: number }) => {
  const [data, setData] = useState<ChangesReply | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [labelling, setLabelling] = useState<number | null>(null);
  const load = () => void call<ChangesReply>('changes', { toolId }).then(setData);
  useEffect(load, [toolId, refreshKey]);

  const suggest = async (changeId: number) => {
    setLabelling(changeId);
    try {
      const r = await call<LabelReply>('releaseNotes', { changeId, notes: notes[changeId] ?? '' });
      setMessage(
        r.ok
          ? { ok: true, text: `Suggested a label for ${r.labelled} ${r.labelled === 1 ? 'fact' : 'facts'} (${r.grounded} with a quote from the notes). Check each one, then choose Still true or Changed.` }
          : { ok: false, text: r.reason },
      );
      if (r.ok) load();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setLabelling(null);
    }
  };

  const done = (text: string, ok: boolean) => {
    setMessage({ ok, text });
    setChanging(null);
    if (ok) load();
  };
  const keep = async (changeId: number, factId: number, label: string, to: string) => {
    const r = await call<Reply>('stillTrue', { changeId, factId });
    done(r.ok ? `${label}: still true on ${to}.${r.settled?.length ? ` Answered and closed: ${r.settled.join(', ')}.` : ''}` : r.reason, r.ok);
  };

  if (!data) return <Spinner />;
  if (!data.ok) return null;
  return (
    <Stack space="space.150">
      <Heading as="h2">Changes</Heading>
      {data.changes.length === 0 ? <Text>No version changes yet.</Text> : null}
      {message ? (
        <SectionMessage appearance={message.ok ? 'success' : 'warning'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      ) : null}
      {data.changes.map((c) => (
        <Box key={c.id} xcss={cardStyle}>
          <Stack space="space.100">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Text weight="bold">{`${c.environment}: ${c.from} → ${c.to}`}</Text>
              <Lozenge appearance={c.found === 'Recorded by owner' ? 'default' : 'inprogress'}>{c.found}</Lozenge>
              <Text size="small">{day(c.createdAt)}</Text>
            </Inline>
            {c.status === 'open' ? <Text>Building the list of facts to re-verify…</Text> : null}
            {c.status === 'failed' ? <Text>{`The list could not be built (${c.error ?? 'unknown error'}). Answers are still right: they compare versions when asked.`}</Text> : null}
            {c.status === 'listed' && c.toRecheck.length === 0 ? <Text>{`Every version-dependent fact is verified on ${c.to}.`}</Text> : null}
            {c.toRecheck.length ? <Text>{`Facts to re-verify on ${c.to}:`}</Text> : null}
            {c.toRecheck.map((f) => (
              <Stack key={f.factId} space="space.050">
                <Inline space="space.150" alignBlock="center" shouldWrap>
                  <Text>{`${f.label} · ${f.scope} · was ${show(f.was)}${f.unit && typeof f.was === 'number' ? ` (${f.unit})` : ''} on ${c.from}`}</Text>
                  <Button appearance="primary" onClick={() => void keep(c.id, f.factId, f.label, c.to)}>
                    {`Still true on ${c.to}`}
                  </Button>
                  <Button appearance="subtle" onClick={() => setChanging(changing === `${c.id}:${f.factId}` ? null : `${c.id}:${f.factId}`)}>
                    Changed
                  </Button>
                </Inline>
                {f.suggestion ? (
                  <Inline space="space.100" alignBlock="center" shouldWrap>
                    <Lozenge appearance={SUGGESTION[f.suggestion.label].appearance}>{SUGGESTION[f.suggestion.label].text}</Lozenge>
                    {f.suggestion.quote ? <Text size="small">{`“${f.suggestion.quote}”`}</Text> : null}
                  </Inline>
                ) : null}
                {changing === `${c.id}:${f.factId}` ? <ChangedForm toolId={toolId} to={c.to} fact={f} onDone={done} /> : null}
              </Stack>
            ))}
            {c.status === 'listed' && c.toRecheck.length ? (
              <Stack space="space.050">
                <Text size="small">{`Release notes for ${c.to} (optional): paste them to get a suggested label for each fact, with the line that shows it. Nothing is fetched, and nothing is verified until you choose Still true or Changed.`}</Text>
                <TextArea
                  value={notes[c.id] ?? ''}
                  placeholder={`Paste the ${c.to} release notes`}
                  minimumRows={3}
                  maxLength={MAX_NOTES}
                  onChange={(e) => setNotes({ ...notes, [c.id]: String(e.target.value ?? '') })}
                />
                <Inline space="space.100" alignBlock="center">
                  <Button onClick={() => void suggest(c.id)} isDisabled={labelling !== null || !(notes[c.id] ?? '').trim()}>
                    Suggest labels
                  </Button>
                  {labelling === c.id ? <Spinner /> : null}
                </Inline>
              </Stack>
            ) : null}
            <Text size="small">
              {`Not listed: ${c.notListed} ${c.notListed === 1 ? 'fact that doesn’t' : 'facts that don’t'} depend on the version. Policy rules untouched: ${c.rulesUntouched}. Other environments untouched: ${c.otherEnvironments.join(', ') || 'none'}.`}
            </Text>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
};

const VERDICT: Record<string, string> = {
  yes: 'Yes',
  yes_with_approval: 'Yes, with approval',
  not_ready: 'Not ready',
  no: 'No',
  dont_know: "Don't know yet",
  unsupported: "Don't know yet",
};

/** The asker's own recent questions; "May have changed: ask again" where a version change touched the evidence. */
export const RecentQuestions = ({ refreshKey, onAskAgain }: { refreshKey: number; onAskAgain: (askId: number) => void }) => {
  const [asks, setAsks] = useState<RecentAsk[] | null>(null);
  useEffect(() => {
    void call<{ asks: RecentAsk[] }>('recentAsks').then((r) => setAsks(r.asks));
  }, [refreshKey]);
  if (!asks || asks.length === 0) return null;
  return (
    <Stack space="space.100">
      <Heading as="h3">Your recent questions</Heading>
      {asks.map((a) => (
        <Inline key={a.askId} space="space.100" alignBlock="center" shouldWrap>
          <Text>{`${a.question ?? 'An earlier question'} · ${a.environment} · ${VERDICT[a.verdict ?? ''] ?? '—'}`}</Text>
          {a.mayHaveChanged ? <Lozenge appearance="moved">May have changed</Lozenge> : null}
          <Button appearance={a.mayHaveChanged ? 'primary' : 'subtle'} onClick={() => onAskAgain(a.askId)}>
            Ask again
          </Button>
        </Inline>
      ))}
    </Stack>
  );
};

import React, { useState } from 'react';
import { Box, Button, Checkbox, Heading, Icon, Inline, Lozenge, SectionMessage, Spinner, Stack, Text, TextArea, Textfield, Tooltip, xcss } from '@forge/react';
import type { DocDraft, DocReply } from '../resolvers/doc-handlers';
import { call, cardStyle } from './common';

/**
 * "Fill in from your docs" on My tools (D58): the owner pastes documentation, the AI drafts facts, each with the
 * line it came from, and the owner accepts or skips each one. The page decides nothing: the server drafts and
 * checks the quotes, and an accepted draft is published with publishAnswer like any answer the owner types.
 */

type PublishReply = { ok: true; settled: string[]; stillOpen: number } | { ok: false; reason: string };

// The server's limit (MAX_DOC_CHARS); the server checks it again.
const MAX_DOCS = 20000;

const rowStyle = xcss({ padding: 'space.100', borderRadius: 'radius.medium', backgroundColor: 'color.background.neutral.subtle', borderColor: 'color.border', borderWidth: 'border.width', borderStyle: 'solid' });

/** "GB" from "file size in gigabytes (GB)". */
const unitOf = (unit: string | null) => unit?.match(/\(([^)]{1,12})\)\s*$/)?.[1] ?? '';

function shown(value: unknown, unit: string | null): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return `${String(value)}${unitOf(unit) ? ` ${unitOf(unit)}` : ''}`;
}

/** What a draft adds: something new, the same as recorded, or a different value, so the owner looks twice. */
function compared(d: DocDraft): { text: string; appearance: 'new' | 'success' | 'moved' } {
  if (d.recorded === null || d.recorded === undefined) return { text: 'New', appearance: 'new' };
  return JSON.stringify(d.recorded) === JSON.stringify(d.value) ? { text: 'Same as recorded', appearance: 'success' } : { text: `Recorded: ${shown(d.recorded, d.unit)}`, appearance: 'moved' };
}

export const DocAssistant = ({ toolId, toolName, onSaved }: { toolId: number; toolName: string; onSaved: () => void }) => {
  const [docs, setDocs] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<DocReply | null>(null);
  const [version, setVersion] = useState('');
  const [every, setEvery] = useState(false);
  // What happened to each draft: "Saved" or "Skipped".
  const [done, setDone] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const draft = async () => {
    setBusy(true);
    setNote(null);
    setDone({});
    try {
      const r = await call<DocReply>('docFacts', { toolId, docs });
      setReply(r);
      if (r.ok) setVersion(r.version ?? '');
    } catch (e) {
      setReply({ ok: false, reason: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const accept = async (d: DocDraft) => {
    setSaving(d.key);
    setNote(null);
    try {
      const r = await call<PublishReply>('publishAnswer', { toolId, key: d.key, value: d.value, environmentId: null, version: version.trim(), everyVersion: every, quote: d.quote });
      if (r.ok) {
        setDone((x) => ({ ...x, [d.key]: 'Saved' }));
        setNote({ ok: true, text: `${d.label}: saved.${r.settled.length ? ` Answered and closed: ${r.settled.join(', ')}.` : ''}` });
        onSaved();
      } else setNote({ ok: false, text: r.reason });
    } catch (e) {
      setNote({ ok: false, text: String(e) });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Box xcss={cardStyle}>
      <Stack space="space.150">
        <Inline space="space.100" alignBlock="center">
          <Icon glyph="magic-wand" color="color.icon.discovery" label="AI" size="medium" />
          <Heading as="h2">Fill in from your docs</Heading>
          <Lozenge appearance="discovery">AI</Lozenge>
        </Inline>
        <Text color="color.text.subtle">{`Paste a page of ${toolName}'s documentation. AI drafts the facts it states, each with the line that proves it. Nothing is saved until you accept.`}</Text>
        <TextArea value={docs} placeholder="Paste documentation, a feature list or release notes" minimumRows={4} maxLength={MAX_DOCS} onChange={(e) => setDocs(String(e.target.value ?? ''))} />
        <Inline space="space.100" alignBlock="center">
          <Button appearance="primary" onClick={() => void draft()} isDisabled={busy || !docs.trim()}>
            Draft facts with AI
          </Button>
          {busy ? (
            <Inline space="space.075" alignBlock="center">
              <Spinner size="small" />
              <Text color="color.text.subtle">AI is reading…</Text>
            </Inline>
          ) : null}
        </Inline>
        {reply && !reply.ok ? (
          <SectionMessage appearance="warning">
            <Text>{reply.reason}</Text>
          </SectionMessage>
        ) : null}
        {reply?.ok && reply.drafts.length === 0 ? <Text>{`The text doesn't clearly say anything about ${toolName}'s capabilities.`}</Text> : null}
        {reply?.ok && reply.drafts.length ? (
          <Stack space="space.100">
            <Inline space="space.150" alignBlock="center" shouldWrap>
              <Text weight="semibold">{`${reply.drafts.length} ${reply.drafts.length === 1 ? 'draft' : 'drafts'}${reply.dropped ? ` · ${reply.dropped} dropped: no matching line in your text` : ''}`}</Text>
              <Text>Verified on version</Text>
              <Box xcss={xcss({ width: '90px' })}>
                <Textfield value={version} placeholder="13.2" maxLength={32} onChange={(e) => setVersion(String(e.target.value ?? ''))} />
              </Box>
              <Checkbox label="Holds for every version" isChecked={every} onChange={() => setEvery(!every)} />
            </Inline>
            {reply.drafts.map((d) => {
              const c = compared(d);
              return (
                <Box key={d.key} xcss={rowStyle}>
                  <Stack space="space.050">
                    <Inline space="space.100" alignBlock="center" spread="space-between" shouldWrap>
                      <Inline space="space.100" alignBlock="center" shouldWrap>
                        <Lozenge appearance={c.appearance}>{c.text}</Lozenge>
                        {d.linked ? null : (
                          <Tooltip content="Saved as a fact, but answers use it only once you link the checks this capability needs (Records → Show records → Capability links). Until then it stays Not verified.">
                            <Lozenge appearance="default">Checks not linked</Lozenge>
                          </Tooltip>
                        )}
                        <Text weight="semibold">{d.label}</Text>
                        <Text weight="bold" color={d.value === true ? 'color.text.success' : d.value === false ? 'color.text.danger' : 'color.text'}>
                          {shown(d.value, d.unit)}
                        </Text>
                      </Inline>
                      {done[d.key] ? (
                        <Lozenge appearance={done[d.key] === 'Saved' ? 'success' : 'default'}>{done[d.key]}</Lozenge>
                      ) : (
                        <Inline space="space.050">
                          <Button appearance="primary" onClick={() => void accept(d)} isDisabled={saving !== null || !version.trim()}>
                            Accept
                          </Button>
                          <Button appearance="subtle" onClick={() => setDone((x) => ({ ...x, [d.key]: 'Skipped' }))} isDisabled={saving !== null}>
                            Skip
                          </Button>
                        </Inline>
                      )}
                    </Inline>
                    <Text size="small" color="color.text.subtle">{`“${d.quote}”`}</Text>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        ) : null}
        {note ? (
          <SectionMessage appearance={note.ok ? 'success' : 'warning'}>
            <Text>{note.text}</Text>
          </SectionMessage>
        ) : null}
      </Stack>
    </Box>
  );
};

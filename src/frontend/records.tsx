import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, Heading, Inline, SectionMessage, Select, Spinner, Stack, Text, TextArea, Textfield, User, xcss } from '@forge/react';
import type { ToolDetails } from '../resolvers/edit-handlers';
import { call, cardStyle, type Option } from './common';

/**
 * My tools → the tool's records (spec F1, section 15): environments, catalog keys, capability links, facts,
 * policy rules, readiness keys and access mappings, each listed with a form to add or change one. Saving with
 * an existing key or name changes that record. The server checks the owner and every field again (rule 4).
 */

type Reply = { ok: true; settled?: string[] } | { ok: false; reason: string };
type DetailsReply = ToolDetails | { ok: false; reason: string };
type Details = ToolDetails;
type Save = (payload: Record<string, unknown>) => Promise<boolean>;

const VIEWS: Option[] = [
  { label: 'Environments', value: 'environment' },
  { label: 'Catalog keys', value: 'catalogKey' },
  { label: 'Capability links', value: 'link' },
  { label: 'Facts', value: 'fact' },
  { label: 'Policy rules', value: 'rule' },
  { label: 'Readiness keys', value: 'readinessKey' },
  { label: 'Access mappings', value: 'accessMapping' },
];

const opt = (label: string, value: string): Option => ({ label, value });
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const orNull = (s: string) => (s.trim() ? s.trim() : null);
const w = (px: number) => xcss({ width: `${px}px` });

const ROUTES = [opt('Tool owner', 'tool_owner'), opt('Environment owner', 'environment_owner')];
const ALL = 'all';

const Field = ({ label, width, children }: { label: string; width: number; children: React.ReactNode }) => (
  <Box xcss={w(width)}>
    <Stack space="space.050">
      <Text size="small">{label}</Text>
      {children}
    </Stack>
  </Box>
);

const Input = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <Textfield value={value} placeholder={placeholder} onChange={(e) => onChange(String(e.target.value ?? ''))} />
);

const Pick = ({ options, value, onChange }: { options: Option[]; value: string; onChange: (v: string) => void }) => (
  <Select options={options} value={options.find((o) => o.value === value) ?? null} onChange={(o: Option) => onChange(o.value)} />
);

const SaveButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
  <Button appearance="primary" onClick={onClick} isDisabled={disabled}>
    Save
  </Button>
);

function scopeOptions(d: Details): Option[] {
  return [opt('All environments', ALL), ...d.environments.map((e) => opt(e.name, String(e.id)))];
}
const envId = (v: string) => (v === ALL ? null : Number(v));
const envName = (d: Details, id: number | null) => (id === null ? 'all environments' : (d.environments.find((e) => e.id === id)?.name ?? `environment ${id}`));
const showList = (l: string[] | null) => (l === null ? 'not recorded' : l.length ? l.join(', ') : 'none');

// ---- one form per kind -------------------------------------------------------------------------------------

const EnvironmentForm = ({ d, save }: { d: Details; save: Save }) => {
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('assets');
  const [ref, setRef] = useState('');
  const [values, setValues] = useState('Version: ');
  const [group, setGroup] = useState('');
  const recorded = () =>
    Object.fromEntries(
      values
        .split('\n')
        .map((line) => line.split(':'))
        .filter((parts) => parts.length >= 2 && parts[0]!.trim())
        .map(([attr, ...rest]) => [attr!.trim(), list(rest.join(':'))]),
    );
  return (
    <Stack space="space.100">
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Name" width={160}>
          <Input value={name} onChange={setName} placeholder="KS-DEV" />
        </Field>
        <Field label="Values come from" width={200}>
          <Pick options={[opt('An Assets record', 'assets'), opt('Recorded by the owner', 'registry')]} value={provider} onChange={setProvider} />
        </Field>
        {provider === 'assets' ? (
          <Field label="Assets object key" width={160}>
            <Input value={ref} onChange={setRef} placeholder="Like TPENV-1" />
          </Field>
        ) : null}
        <Field label="Only for group (optional)" width={200}>
          <Input value={group} onChange={setGroup} />
        </Field>
      </Inline>
      {provider === 'registry' ? (
        <Field label='Recorded values, one attribute per line: "Attribute: value, value"' width={480}>
          <TextArea value={values} onChange={(e) => setValues(String(e.target.value ?? ''))} />
        </Field>
      ) : null}
      <Inline>
        <SaveButton
          disabled={!name.trim()}
          onClick={() =>
            void save({
              entity: 'environment',
              toolId: d.tool.id,
              name,
              provider,
              providerRef: provider === 'assets' ? orNull(ref) : null,
              audienceGroup: orNull(group),
              recordedValues: provider === 'registry' ? recorded() : null,
            })
          }
        />
      </Inline>
    </Stack>
  );
};

const COMPARISONS: Record<string, Option[]> = {
  boolean: [opt('Has it', 'has')],
  number: [opt('At least', 'gte'), opt('At most', 'lte'), opt('Exactly', 'eq')],
  text: [opt('Exactly', 'eq')],
};

const CatalogKeyForm = ({ d, save }: { d: Details; save: Save }) => {
  const [key, setKey] = useState('');
  const [kind, setKind] = useState('capability');
  const [label, setLabel] = useState('');
  const [valueType, setValueType] = useState('boolean');
  const [comparison, setComparison] = useState('has');
  const [unit, setUnit] = useState('');
  const [synonyms, setSynonyms] = useState('');
  const setType = (t: string) => {
    setValueType(t);
    setComparison(COMPARISONS[t]![0]!.value);
  };
  return (
    <Stack space="space.100">
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Key" width={170}>
          <Input value={key} onChange={setKey} placeholder="websockets" />
        </Field>
        <Field label="Kind" width={170}>
          <Pick options={[opt('Capability', 'capability'), opt('Policy action', 'action'), opt('Readiness', 'readiness')]} value={kind} onChange={setKind} />
        </Field>
        <Field label="Label" width={280}>
          <Input value={label} onChange={setLabel} />
        </Field>
      </Inline>
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Value" width={150}>
          <Pick options={[opt('Yes or no', 'boolean'), opt('Number', 'number'), opt('Text', 'text')]} value={valueType} onChange={setType} />
        </Field>
        <Field label="Compared as" width={150}>
          <Pick options={COMPARISONS[valueType]!} value={comparison} onChange={setComparison} />
        </Field>
        {valueType === 'number' ? (
          <Field label="Unit" width={220}>
            <Input value={unit} onChange={setUnit} placeholder="file size in gigabytes (GB)" />
          </Field>
        ) : null}
        <Field label="Other words for it, comma-separated" width={300}>
          <Input value={synonyms} onChange={setSynonyms} />
        </Field>
      </Inline>
      <Inline>
        <SaveButton
          disabled={!key.trim() || !label.trim()}
          onClick={() =>
            void save({ entity: 'catalogKey', toolId: d.tool.id, key: key.trim(), kind, label, valueType, comparison, unit: valueType === 'number' ? orNull(unit) : null, synonyms: list(synonyms) })
          }
        />
      </Inline>
    </Stack>
  );
};

const LIST_MODES = [opt('Not recorded', 'unknown'), opt('None', 'none'), opt('These', 'list')];
const fromMode = (mode: string, text: string) => (mode === 'unknown' ? null : mode === 'none' ? [] : list(text));

const LinkForm = ({ d, save }: { d: Details; save: Save }) => {
  const capabilities = d.catalogKeys.filter((k) => k.kind === 'capability').map((k) => opt(k.label, k.key));
  const [cap, setCap] = useState(capabilities[0]?.value ?? '');
  const [actionMode, setActionMode] = useState('unknown');
  const [actions, setActions] = useState('');
  const [readyMode, setReadyMode] = useState('unknown');
  const [ready, setReady] = useState('');
  return (
    <Stack space="space.100">
      <Text>A link left as "Not recorded" means the answer is Not verified. Choose "None" when nothing else is needed.</Text>
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Capability" width={280}>
          <Pick options={capabilities} value={cap} onChange={setCap} />
        </Field>
        <Field label="Policy actions it needs" width={150}>
          <Pick options={LIST_MODES} value={actionMode} onChange={setActionMode} />
        </Field>
        {actionMode === 'list' ? (
          <Field label="Action keys, comma-separated" width={220}>
            <Input value={actions} onChange={setActions} placeholder="custom_ui" />
          </Field>
        ) : null}
        <Field label="Readiness it needs" width={150}>
          <Pick options={LIST_MODES} value={readyMode} onChange={setReadyMode} />
        </Field>
        {readyMode === 'list' ? (
          <Field label="Readiness keys, comma-separated" width={220}>
            <Input value={ready} onChange={setReady} placeholder="frontend_build" />
          </Field>
        ) : null}
      </Inline>
      <Inline>
        <SaveButton disabled={!cap} onClick={() => void save({ entity: 'link', toolId: d.tool.id, capabilityKey: cap, actions: fromMode(actionMode, actions), readinessKeys: fromMode(readyMode, ready) })} />
      </Inline>
    </Stack>
  );
};

const FactForm = ({ d, save }: { d: Details; save: Save }) => {
  const capabilities = d.catalogKeys.filter((k) => k.kind === 'capability');
  const [key, setKey] = useState(capabilities[0]?.key ?? '');
  const k = capabilities.find((c) => c.key === key);
  const [yes, setYes] = useState('yes');
  const [raw, setRaw] = useState('');
  const [scope, setScope] = useState(ALL);
  const [group, setGroup] = useState('');
  const [version, setVersion] = useState(d.environments.find((e) => e.lastSeenVersion)?.lastSeenVersion ?? '');
  const [every, setEvery] = useState(false);
  const [quote, setQuote] = useState('');
  const value = k?.valueType === 'boolean' ? yes === 'yes' : k?.valueType === 'number' ? Number(raw) : raw;
  return (
    <Stack space="space.100">
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Capability" width={280}>
          <Pick options={capabilities.map((c) => opt(c.label, c.key))} value={key} onChange={setKey} />
        </Field>
        <Field label="Value" width={140}>
          {k?.valueType === 'boolean' ? <Pick options={[opt('Yes', 'yes'), opt('No', 'no')]} value={yes} onChange={setYes} /> : <Input value={raw} onChange={setRaw} placeholder={k?.unit ?? ''} />}
        </Field>
        <Field label="Where" width={170}>
          <Pick options={scopeOptions(d)} value={scope} onChange={setScope} />
        </Field>
        <Field label="Only for group (optional)" width={190}>
          <Input value={group} onChange={setGroup} />
        </Field>
      </Inline>
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Version" width={110}>
          <Input value={version} onChange={setVersion} />
        </Field>
        <Checkbox label="Holds for every version" isChecked={every} onChange={() => setEvery(!every)} />
        <Field label="Source or quote (optional)" width={320}>
          <Input value={quote} onChange={setQuote} />
        </Field>
        <SaveButton
          disabled={!key || !version.trim() || (k?.valueType !== 'boolean' && !raw.trim())}
          onClick={() => void save({ entity: 'fact', toolId: d.tool.id, key, value, environmentId: envId(scope), audienceGroup: orNull(group), version, everyVersion: every, quote: orNull(quote) })}
        />
      </Inline>
    </Stack>
  );
};

const RuleForm = ({ d, save }: { d: Details; save: Save }) => {
  const known = [...new Set([...d.catalogKeys.filter((k) => k.kind === 'action').map((k) => k.key), ...d.links.flatMap((l) => l.actions ?? [])])];
  const [action, setAction] = useState('');
  const [scope, setScope] = useState(ALL);
  const [group, setGroup] = useState('');
  const [effect, setEffect] = useState('approval');
  const [route, setRoute] = useState('tool_owner');
  const [reason, setReason] = useState('');
  return (
    <Stack space="space.100">
      {known.length ? <Text>Actions in use: {known.join(', ')}</Text> : null}
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Action key" width={170}>
          <Input value={action} onChange={setAction} placeholder="custom_ui" />
        </Field>
        <Field label="Where" width={170}>
          <Pick options={scopeOptions(d)} value={scope} onChange={setScope} />
        </Field>
        <Field label="Only for group (optional)" width={190}>
          <Input value={group} onChange={setGroup} />
        </Field>
        <Field label="Policy" width={170}>
          <Pick options={[opt('Allowed', 'allow'), opt('Not allowed', 'deny'), opt('Needs approval', 'approval')]} value={effect} onChange={setEffect} />
        </Field>
        {effect === 'approval' ? (
          <Field label="Approved by" width={170}>
            <Pick options={ROUTES} value={route} onChange={setRoute} />
          </Field>
        ) : null}
      </Inline>
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Reason shown on the card" width={360}>
          <Input value={reason} onChange={setReason} placeholder="Needs design review" />
        </Field>
        <SaveButton
          disabled={!action.trim()}
          onClick={() =>
            void save({
              entity: 'rule',
              toolId: d.tool.id,
              actionKey: action.trim(),
              environmentId: envId(scope),
              audienceGroup: orNull(group),
              effect,
              approvalRoute: effect === 'approval' ? route : null,
              reason: orNull(reason),
            })
          }
        />
      </Inline>
    </Stack>
  );
};

const ReadinessForm = ({ d, save }: { d: Details; save: Save }) => {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [attribute, setAttribute] = useState('');
  const [match, setMatch] = useState('has');
  const [expected, setExpected] = useState('');
  const [route, setRoute] = useState('environment_owner');
  return (
    <Stack space="space.100">
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Key" width={160}>
          <Input value={key} onChange={setKey} placeholder="frontend_build" />
        </Field>
        <Field label="Label" width={200}>
          <Input value={label} onChange={setLabel} placeholder="Frontend build" />
        </Field>
        <Field label="Record attribute" width={200}>
          <Input value={attribute} onChange={setAttribute} placeholder="Build environments" />
        </Field>
        <Field label="Ready when it" width={150}>
          <Pick options={[opt('Includes', 'has'), opt('Equals', 'eq'), opt('Is at least', 'gte')]} value={match} onChange={setMatch} />
        </Field>
        <Field label="Value" width={140}>
          <Input value={expected} onChange={setExpected} placeholder="frontend" />
        </Field>
        <Field label="Fixed by" width={170}>
          <Pick options={ROUTES} value={route} onChange={setRoute} />
        </Field>
      </Inline>
      <Inline>
        <SaveButton
          disabled={!key.trim() || !label.trim() || !attribute.trim() || !expected.trim()}
          onClick={() => void save({ entity: 'readinessKey', toolId: d.tool.id, key: key.trim(), label, providerAttribute: attribute, match, expected, fixRoute: route })}
        />
      </Inline>
    </Stack>
  );
};

const AccessForm = ({ d, save }: { d: Details; save: Save }) => {
  const [env, setEnv] = useState(d.environments[0] ? String(d.environments[0].id) : '');
  const [action, setAction] = useState('');
  const [none, setNone] = useState(false);
  const [group, setGroup] = useState('');
  const [grants, setGrants] = useState('');
  const [source, setSource] = useState('idp_synced');
  const [route, setRoute] = useState('tool_owner');
  return (
    <Stack space="space.100">
      <Text>You attest this mapping: it is saved under your name.</Text>
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Environment" width={150}>
          <Pick options={d.environments.map((e) => opt(e.name, String(e.id)))} value={env} onChange={setEnv} />
        </Field>
        <Field label="Action key" width={160}>
          <Input value={action} onChange={setAction} placeholder="custom_ui" />
        </Field>
        <Checkbox label="No access needed" isChecked={none} onChange={() => setNone(!none)} />
        {!none ? (
          <>
            <Field label="Group" width={200}>
              <Input value={group} onChange={setGroup} placeholder="kestrel-dev-builders" />
            </Field>
            <Field label="What it gives" width={200}>
              <Input value={grants} onChange={setGrants} placeholder="Developer role in Kestrel" />
            </Field>
          </>
        ) : null}
      </Inline>
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Membership comes from" width={230}>
          <Pick options={[opt('The identity provider (synced)', 'idp_synced'), opt('Set by hand', 'manual')]} value={source} onChange={setSource} />
        </Field>
        {!none ? (
          <Field label="Access granted by" width={170}>
            <Pick options={ROUTES} value={route} onChange={setRoute} />
          </Field>
        ) : null}
        <SaveButton
          disabled={!env || !action.trim() || (!none && !group.trim())}
          onClick={() =>
            void save({
              entity: 'accessMapping',
              toolId: d.tool.id,
              environmentId: Number(env),
              actionKey: action.trim(),
              noAccessNeeded: none,
              groupName: none ? null : orNull(group),
              grants: none ? null : orNull(grants),
              source,
              grantRoute: none ? null : route,
            })
          }
        />
      </Inline>
    </Stack>
  );
};

// ---- what is recorded now ------------------------------------------------------------------------------

const Current = ({ d, view }: { d: Details; view: string }) => {
  const lines: React.ReactNode[] = [];
  const r = d.registry;
  if (view === 'environment') {
    for (const e of d.environments) {
      lines.push(
        <Inline key={e.id} space="space.100" alignBlock="center" shouldWrap>
          <Text>
            {`${e.name} · ${e.provider === 'assets' ? `Assets record ${e.providerRef ?? '?'}` : 'recorded by the owner'} · version ${e.lastSeenVersion ?? 'not seen yet'}${e.audienceGroup ? ` · only ${e.audienceGroup}` : ''} · owner`}
          </Text>
          <User accountId={e.ownerAccountId} />
        </Inline>,
      );
    }
  }
  if (view === 'catalogKey') for (const k of d.catalogKeys) lines.push(<Text key={k.key}>{`${k.key}: ${k.label} (${k.kind}, ${k.valueType}, ${k.comparison}${k.unit ? `, ${k.unit}` : ''})`}</Text>);
  if (view === 'link') for (const l of d.links) lines.push(<Text key={l.capabilityKey}>{`${l.capabilityKey}: actions ${showList(l.actions)}; readiness ${showList(l.readinessKeys)}`}</Text>);
  if (view === 'fact') {
    for (const f of r.facts) {
      const versions = f.versions.map((v) => `${v.version} = ${JSON.stringify(v.value)}`).join('; ') || 'no verification';
      lines.push(<Text key={f.id}>{`${f.factKey} · ${envName(d, f.environmentId)}${f.audienceGroup ? ` · ${f.audienceGroup}` : ''} · ${f.versionSensitive ? 'per version' : 'every version'}: ${versions}${f.status === 'retired' ? ' (retired)' : ''}`}</Text>);
    }
  }
  if (view === 'rule') {
    const effect = { allow: 'allowed', deny: 'not allowed', approval: 'needs approval' } as const;
    for (const x of r.rules) lines.push(<Text key={x.id}>{`${x.actionKey} · ${envName(d, x.environmentId)}${x.audienceGroup ? ` · ${x.audienceGroup}` : ''}: ${effect[x.effect]}${x.reason ? ` (${x.reason})` : ''}`}</Text>);
  }
  if (view === 'readinessKey') for (const k of r.readinessKeys) lines.push(<Text key={k.id}>{`${k.key}: ${k.providerAttribute} ${k.match} "${k.expected}" (${k.label})`}</Text>);
  if (view === 'accessMapping') {
    for (const m of r.accessMappings) {
      lines.push(<Text key={m.id}>{`${envName(d, m.environmentId)} · ${m.actionKey}: ${m.groupName ?? 'no access needed'}${m.grants ? `, gives ${m.grants}` : ''} (${m.source === 'idp_synced' ? 'synced' : 'set by hand'})`}</Text>);
    }
  }
  return <Stack space="space.050">{lines.length ? lines : <Text>Nothing recorded yet.</Text>}</Stack>;
};

const FORMS: Record<string, (p: { d: Details; save: Save }) => React.ReactElement> = {
  environment: EnvironmentForm,
  catalogKey: CatalogKeyForm,
  link: LinkForm,
  fact: FactForm,
  rule: RuleForm,
  readinessKey: ReadinessForm,
  accessMapping: AccessForm,
};

/** The tool's records, one kind at a time, with a form to add or change one. Owner or Jira administrator only. */
export const ToolRecords = ({ toolId, refreshKey }: { toolId: number; refreshKey: number }) => {
  const [d, setD] = useState<DetailsReply | null>(null);
  const [view, setView] = useState('environment');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => void call<DetailsReply>('toolDetails', { toolId }).then(setD);
  useEffect(load, [toolId, refreshKey]);

  const save: Save = async (payload) => {
    try {
      const r = await call<Reply>('edit', payload);
      setMessage(r.ok ? { ok: true, text: `Saved.${r.settled?.length ? ` Answered and closed: ${r.settled.join(', ')}.` : ''}` } : { ok: false, text: r.reason });
      if (r.ok) load();
      return r.ok;
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
      return false;
    }
  };

  if (!d) return <Spinner />;
  if (!d.ok) {
    return (
      <SectionMessage appearance="warning">
        <Text>{d.reason}</Text>
      </SectionMessage>
    );
  }
  const Form = FORMS[view]!;
  return (
    <Stack space="space.200">
      <Heading as="h2">Records</Heading>
      <Text>What {d.tool.name} can do, what policy allows, what proves readiness and which groups grant access. Every change is saved under your name.</Text>
      <Box xcss={w(240)}>
        <Pick
          options={VIEWS}
          value={view}
          onChange={(v) => {
            setView(v);
            setMessage(null);
          }}
        />
      </Box>
      <Current d={d} view={view} />
      <Box xcss={cardStyle}>
        <Stack space="space.100">
          <Text weight="bold">Add or change</Text>
          <Form d={d} save={save} />
        </Stack>
      </Box>
      {message ? (
        <SectionMessage appearance={message.ok ? 'success' : 'warning'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

/** Setup: a new tool, owned by the Jira administrator who adds it. */
export const AddToolSection = () => {
  const [name, setName] = useState('');
  const [granularity, setGranularity] = useState('minor');
  const [policy, setPolicy] = useState('none');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const create = async () => {
    const r = await call<{ ok: true; toolId: number } | { ok: false; reason: string }>('createTool', { name, versionGranularity: granularity, defaultPolicy: policy });
    setMessage(r.ok ? { ok: true, text: `Added ${name}. You own it: record its environments and catalog under Tool Passport → My tools.` } : { ok: false, text: r.reason });
  };
  return (
    <Stack space="space.150">
      <Heading as="h2">Tools</Heading>
      <Inline space="space.150" shouldWrap alignBlock="end">
        <Field label="Tool name" width={240}>
          <Input value={name} onChange={setName} />
        </Field>
        <Field label="Versions compared by" width={170}>
          <Pick options={[opt('Major (13)', 'major'), opt('Minor (13.2)', 'minor'), opt('Exact (13.2.1)', 'exact')]} value={granularity} onChange={setGranularity} />
        </Field>
        <Field label="With no policy rule" width={200}>
          <Pick options={[opt('Not verified', 'none'), opt('Allowed', 'allow')]} value={policy} onChange={setPolicy} />
        </Field>
        <Button appearance="primary" onClick={() => void create()} isDisabled={!name.trim()}>
          Add tool
        </Button>
      </Inline>
      {message ? (
        <SectionMessage appearance={message.ok ? 'success' : 'warning'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

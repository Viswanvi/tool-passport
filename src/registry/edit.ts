import { z } from 'zod';
import type { CatalogKey } from '../engine/catalog';
import type { Environment, Tool } from '../engine/model';
import { checkAnswer, settleOpenQuestions, writeFact } from '../loop/questions';
import type { LoopDeps } from '../loop/requests';
import type { RegistryWriter } from './write';

/**
 * Owner edits (spec F1 / P0-1), without Forge. One payload shape per kind of write, parsed with zod (which
 * drops any field it doesn't name: an account id in a payload is never read). The permission check is in
 * the resolver (owner or Jira administrator, on the server); this file checks what each write must say,
 * writes through the same layer as the demo seed, moves the catalog revision on and audits it.
 */

const KEY = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'Keys use lower-case letters, digits and _');
const Id = z.number().int().positive();
const Name = z.string().trim().min(1).max(255);
const Group = z.string().trim().min(1).max(255).nullable();
const Route = z.enum(['environment_owner', 'tool_owner']).nullable();
const Short = (n: number) => z.string().trim().max(n).nullable();

export const EditPayload = z.discriminatedUnion('entity', [
  z.object({
    entity: z.literal('environment'),
    toolId: Id,
    name: Name,
    provider: z.enum(['assets', 'registry']),
    providerRef: Short(64),
    audienceGroup: Group,
    recordedValues: z.record(z.string().trim().min(1).max(255), z.array(z.string().trim().max(255)).max(50)).nullable(),
  }),
  z.object({
    entity: z.literal('catalogKey'),
    toolId: Id,
    key: KEY,
    kind: z.enum(['capability', 'action', 'readiness']),
    label: z.string().trim().min(1).max(200),
    valueType: z.enum(['boolean', 'number', 'text']),
    comparison: z.enum(['has', 'eq', 'gte', 'lte']),
    unit: Short(128),
    synonyms: z.array(z.string().trim().min(1).max(100)).max(20),
  }),
  // null = not recorded (Not verified); [] = the owner says none. Both fields must be present.
  z.object({ entity: z.literal('link'), toolId: Id, capabilityKey: KEY, actions: z.array(KEY).max(10).nullable(), readinessKeys: z.array(KEY).max(10).nullable() }),
  z.object({
    entity: z.literal('fact'),
    toolId: Id,
    key: KEY,
    environmentId: Id.nullable(),
    audienceGroup: Group,
    value: z.union([z.boolean(), z.number(), z.string().max(500)]),
    version: z.string().min(1).max(32),
    everyVersion: z.boolean(),
    quote: Short(1000),
  }),
  z.object({
    entity: z.literal('rule'),
    toolId: Id,
    actionKey: KEY,
    environmentId: Id.nullable(),
    audienceGroup: Group,
    effect: z.enum(['allow', 'deny', 'approval']),
    approvalRoute: Route,
    reason: Short(200),
  }),
  z.object({
    entity: z.literal('readinessKey'),
    toolId: Id,
    key: KEY,
    providerAttribute: Name,
    match: z.enum(['has', 'eq', 'gte']),
    expected: z.string().trim().min(1).max(255),
    label: z.string().trim().min(1).max(200),
    fixRoute: Route,
  }),
  z.object({
    entity: z.literal('accessMapping'),
    toolId: Id,
    environmentId: Id,
    actionKey: KEY,
    noAccessNeeded: z.boolean(),
    groupName: Group,
    grants: Short(200),
    source: z.enum(['idp_synced', 'manual']),
    grantRoute: Route,
  }),
]);

export type Edit = z.infer<typeof EditPayload>;
export type EditResult = { ok: true; settled?: string[] } | { ok: false; reason: string };

export interface ApplyDeps {
  writer: RegistryWriter;
  loop: LoopDeps;
  listEnvironments(toolId: number): Promise<Environment[]>;
  /** A verification for a version closes that fact's re-verify items for changes to it (spec F6, "Changed"). */
  closeFactRechecks?(factId: number, version: string): Promise<void>;
  /** Version bookkeeping: a registry environment saved with a new Version is a change "Recorded by owner" (spec 11). */
  noteVersion?(tool: Tool, environment: Environment, observed: string | null): Promise<unknown>;
  now?(): string;
}

const OBJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}-\d{1,12}$/;
const refuse = (reason: string): EditResult => ({ ok: false, reason });

/** A catalog key's comparison is fixed by its value type; actions and readiness keys are yes/no. */
export function checkCatalogKey(k: Extract<Edit, { entity: 'catalogKey' }>): { ok: true; key: CatalogKey } | { ok: false; reason: string } {
  const allowed = { boolean: ['has'], number: ['eq', 'gte', 'lte'], text: ['eq'] }[k.valueType];
  if (!allowed.includes(k.comparison)) return { ok: false, reason: `A ${k.valueType} key compares with ${allowed.join(' or ')}, not ${k.comparison}` };
  if (k.kind !== 'capability' && k.valueType !== 'boolean') return { ok: false, reason: 'Policy actions and readiness keys are yes or no' };
  if (k.unit && k.valueType !== 'number') return { ok: false, reason: 'Only a number key has a unit' };
  const key: CatalogKey = {
    key: k.key,
    kind: k.kind,
    label: k.label,
    valueType: k.valueType,
    comparison: k.comparison,
    requiresValue: k.valueType !== 'boolean',
    synonyms: k.synonyms,
    ...(k.unit ? { unit: k.unit } : {}),
  };
  return { ok: true, key };
}

/** Check and write one edit, then move the catalog revision on and audit it. Permission is checked before. */
export async function applyEdit(edit: Edit, tool: Tool, actor: string, deps: ApplyDeps): Promise<EditResult> {
  const { writer } = deps;
  const environments = await deps.listEnvironments(tool.id);
  const ownEnv = (id: number | null) => id === null || environments.some((e) => e.id === id && e.toolId === tool.id);
  let after: unknown = edit;
  let settle = false;

  switch (edit.entity) {
    case 'environment': {
      const existing = environments.find((e) => e.name === edit.name);
      if (edit.provider === 'assets') {
        if (!edit.providerRef || !OBJECT_KEY.test(edit.providerRef)) return refuse('An Assets environment needs the object key of its record, like TPENV-1');
        if (edit.recordedValues) return refuse('An Assets environment reads its values from the record, not from recorded values');
      } else if (!edit.recordedValues || Object.keys(edit.recordedValues).length === 0) {
        return refuse('A registry environment needs its recorded values');
      }
      const recorded = edit.provider === 'registry' ? { values: edit.recordedValues!, recordedAt: deps.now?.() ?? new Date().toISOString(), recordedBy: actor } : null;
      const input = {
        toolId: tool.id,
        name: edit.name,
        provider: edit.provider,
        providerRef: edit.provider === 'assets' ? edit.providerRef : null,
        // The person saving a new environment owns it; an existing one keeps its owner (CLAUDE.md rule 3).
        ownerAccountId: existing?.ownerAccountId || actor,
        audienceGroup: edit.audienceGroup,
        recordedValues: recorded,
      };
      await writer.upsertEnvironment(input);
      after = input;
      const recordedVersion = recorded?.values.Version?.[0];
      if (recordedVersion && deps.noteVersion) {
        const saved = (await deps.listEnvironments(tool.id)).find((e) => e.name === edit.name);
        if (saved) await deps.noteVersion(tool, saved, recordedVersion);
      }
      break;
    }
    case 'catalogKey': {
      const checked = checkCatalogKey(edit);
      if (!checked.ok) return checked;
      await writer.upsertCatalogKey(tool.id, checked.key);
      after = checked.key;
      break;
    }
    case 'link': {
      const catalog = await deps.loop.loadCatalog(tool);
      if (catalog.keys.get(edit.capabilityKey)?.kind !== 'capability') return refuse(`"${edit.capabilityKey}" is not a capability of this tool`);
      const link = { capabilityKey: edit.capabilityKey, actions: edit.actions, readinessKeys: edit.readinessKeys };
      await writer.upsertLink(tool.id, link, actor);
      after = link;
      break;
    }
    case 'fact': {
      const catalog = await deps.loop.loadCatalog(tool);
      const checked = checkAnswer({ key: edit.key, value: edit.value, environmentId: edit.environmentId, version: edit.version, everyVersion: edit.everyVersion, quote: edit.quote }, tool, catalog, environments);
      if (!checked.ok) return checked;
      const factId = await writeFact(tool, checked.fact, actor, writer, { source: 'owner', audienceGroup: edit.audienceGroup });
      await deps.closeFactRechecks?.(factId, checked.fact.version);
      after = { ...checked.fact, audienceGroup: edit.audienceGroup };
      settle = true;
      break;
    }
    case 'rule': {
      if (!ownEnv(edit.environmentId)) return refuse('That environment is not one of this tool');
      const rule = {
        toolId: tool.id,
        environmentId: edit.environmentId,
        audienceGroup: edit.audienceGroup,
        actionKey: edit.actionKey,
        effect: edit.effect,
        approvalRoute: edit.effect === 'approval' ? (edit.approvalRoute ?? 'tool_owner') : null,
        reason: edit.reason || null,
      };
      await writer.upsertRule(rule);
      after = rule;
      break;
    }
    case 'readinessKey': {
      const rk = { toolId: tool.id, key: edit.key, providerAttribute: edit.providerAttribute, match: edit.match, expected: edit.expected, label: edit.label, fixRoute: edit.fixRoute };
      await writer.upsertReadinessKey(rk);
      after = rk;
      break;
    }
    case 'accessMapping': {
      if (!ownEnv(edit.environmentId)) return refuse('That environment is not one of this tool');
      if (!edit.noAccessNeeded && !edit.groupName) return refuse('Name the group that grants access, or choose "no access needed"');
      const mapping = {
        toolId: tool.id,
        environmentId: edit.environmentId,
        actionKey: edit.actionKey,
        groupName: edit.noAccessNeeded ? null : edit.groupName,
        grants: edit.noAccessNeeded ? null : edit.grants || null,
        source: edit.source,
        attestedBy: actor,
        grantRoute: edit.noAccessNeeded ? null : edit.grantRoute,
      };
      await writer.upsertAccessMapping(mapping);
      after = mapping;
      break;
    }
  }

  // Every write can change what a translation may rely on (spec section 10), and every write is audited.
  await writer.bumpRevision(tool.id);
  await writer.audit(actor, `${edit.entity}.saved`, edit.entity, null, after);
  if (!settle) return { ok: true };
  // A new fact may decide open questions, exactly as a published answer does.
  const { settled } = await settleOpenQuestions(tool.id, deps.loop);
  return { ok: true, settled };
}

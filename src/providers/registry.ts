import { z } from 'zod';
import type { Environment, EnvRead } from '../engine/model';
import { VERSION_ATTRIBUTE } from './assets';

/**
 * The registry provider (spec section 10, `recorded_values`; section 16 "registry mode"): for environments
 * with no Assets record, the owner's own recorded values. Weaker evidence than an Assets record, so results
 * are labelled "Recorded by owner". Same contract as Assets: mapped attributes plus Version, an empty list
 * for a recorded attribute with no value, and anything not recorded left out.
 *
 * Stored as JSON: { "values": { "<attribute>": ["..."] }, "recordedAt": "<ISO time>", "recordedBy": "<accountId>" }.
 */

const Recorded = z.object({
  values: z.record(z.string(), z.array(z.string())),
  recordedAt: z.string().nullable().optional(),
  recordedBy: z.string().optional(),
});
export type RecordedValues = z.infer<typeof Recorded>;

export interface RegistryDeps {
  mappedAttributes(toolId: number): Promise<string[]>;
  now(): string;
}

function parse(raw: unknown): RecordedValues | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  const r = Recorded.safeParse(v);
  return r.success ? r.data : null;
}

export async function readRegistry(environment: Environment, deps: RegistryDeps): Promise<EnvRead> {
  const recorded = parse(environment.recordedValues);
  if (!recorded) return { ok: false, reason: 'not_found', detail: 'No values recorded for this environment yet' };
  const wanted = new Set([VERSION_ATTRIBUTE, ...(await deps.mappedAttributes(environment.toolId))]);
  const values: Record<string, string[]> = {};
  for (const [name, list] of Object.entries(recorded.values)) {
    if (wanted.has(name)) values[name] = list.map((v) => v.trim()).filter((v) => v !== '');
  }
  return {
    ok: true,
    source: 'registry',
    values,
    version: values[VERSION_ATTRIBUTE]?.[0] ?? null,
    readAt: deps.now(),
    recordUpdatedAt: recorded.recordedAt ?? null,
  };
}

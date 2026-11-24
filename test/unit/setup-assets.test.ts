import { describe, expect, it } from 'vitest';
import { DEMO_RECORDS, ensureDemoRecords, type AssetsSetupClient, type Reply } from '../../src/setup/assets-records';

/**
 * "Load demo data" creates the Assets records itself (spec section 16, judge path step 2): the "Tool Passport
 * Environments" schema, the "Tool Environment" type and its attributes, and the KS-DEV and KS-PROD objects with
 * the section 16 values. It creates only what is missing, so it is safe to repeat; it writes as the app first
 * (that worked on a fresh developer site, E2) and as the signed-in admin only if the app is refused (the demo
 * site refused the app, E1).
 */

interface Obj {
  key: string;
  label: string;
  attrs: Record<string, string[]>;
}

/** A fake Assets workspace that answers like the real endpoints (shapes from E1/E2), and can refuse writes. */
function fakeAssets(opts: { assets?: boolean; refuseWritesAs?: Array<'app' | 'user'> } = {}) {
  const state = {
    schemas: [] as Array<{ id: string; name: string; key: string }>,
    types: [] as Array<{ id: string; name: string; schemaId: string }>,
    attrs: new Map<string, Array<{ id: string; name: string }>>(),
    objects: [] as Array<Obj & { typeId: string }>,
    writes: [] as Array<{ as: 'app' | 'user'; what: string }>,
  };
  let nextId = 100;
  const ok = (body: unknown, status = 200): Reply => ({ status, body });
  const client = (as: 'app' | 'user'): AssetsSetupClient => {
    const write = (what: string, f: () => Reply): Reply => {
      if (opts.refuseWritesAs?.includes(as)) return { status: 403, body: { errorMessages: ['Forbidden'] } };
      state.writes.push({ as, what });
      return f();
    };
    return {
      workspace: async () => (opts.assets === false ? { status: 404, body: null } : ok({ values: [{ workspaceId: 'w1' }] })),
      listSchemas: async () => ok({ values: state.schemas.map((s) => ({ id: s.id, name: s.name, objectSchemaKey: s.key })) }),
      createSchema: async (_w, body) =>
        write('schema', () => {
          const s = { id: String(nextId++), name: String((body as { name: string }).name), key: String((body as { objectSchemaKey: string }).objectSchemaKey) };
          state.schemas.push(s);
          return ok({ id: s.id }, 201);
        }),
      listTypes: async (_w, schemaId) => ok(state.types.filter((t) => t.schemaId === schemaId).map((t) => ({ id: t.id, name: t.name }))),
      globalIcons: async () => ok([{ id: '7', name: 'Server' }]),
      createType: async (_w, body) =>
        write('type', () => {
          const b = body as { name: string; objectSchemaId: string; iconId: string };
          if (!b.iconId) return { status: 400, body: 'iconId missing' };
          const t = { id: String(nextId++), name: b.name, schemaId: b.objectSchemaId };
          state.types.push(t);
          // A new type comes with Key, Name, Created and Updated.
          state.attrs.set(t.id, ['Key', 'Name', 'Created', 'Updated'].map((name) => ({ id: String(nextId++), name })));
          return ok({ id: t.id }, 201);
        }),
      typeAttributes: async (_w, typeId) => ok(state.attrs.get(typeId) ?? []),
      createAttribute: async (_w, typeId, body) =>
        write(`attribute ${(body as { name: string }).name}`, () => {
          const a = { id: String(nextId++), name: (body as { name: string }).name };
          state.attrs.get(typeId)!.push(a);
          return ok(a, 201);
        }),
      findObjects: async (_w, qlQuery) => {
        const t = state.types.find((x) => qlQuery.includes(`objectSchemaId = ${x.schemaId}`) && qlQuery.includes(x.name));
        return ok({ values: state.objects.filter((o) => o.typeId === t?.id).map((o) => ({ objectKey: o.key, label: o.label })) });
      },
      createObject: async (_w, body) =>
        write('object', () => {
          const b = body as { objectTypeId: string; attributes: Array<{ objectTypeAttributeId: string; objectAttributeValues: Array<{ value: string }> }> };
          const names = new Map((state.attrs.get(b.objectTypeId) ?? []).map((a) => [a.id, a.name]));
          const attrs: Record<string, string[]> = {};
          for (const a of b.attributes) attrs[names.get(a.objectTypeAttributeId) ?? '?'] = a.objectAttributeValues.map((v) => v.value);
          const o = { key: `TPENV-${state.objects.length + 1}`, label: attrs.Name?.[0] ?? '?', attrs, typeId: b.objectTypeId };
          state.objects.push(o);
          return ok({ objectKey: o.key }, 201);
        }),
    };
  };
  return { state, app: client('app'), user: client('user') };
}

describe('the demo Assets records', () => {
  it('on a fresh site, the app creates the schema, type, attributes and both records with the section 16 values', async () => {
    const f = fakeAssets();
    const r = await ensureDemoRecords(f.app, f.user);
    expect(r).toEqual({ ok: true, keys: { 'KS-DEV': 'TPENV-1', 'KS-PROD': 'TPENV-2' }, created: ['schema', 'object type', 'Tool', 'Version', 'Build environments', 'Features enabled', 'KS-DEV', 'KS-PROD'], as: 'app' });
    expect(f.state.schemas).toEqual([{ id: '100', name: 'Tool Passport Environments', key: 'TPENV' }]);
    expect(f.state.objects.map((o) => o.attrs)).toEqual([
      { Name: ['KS-DEV'], Tool: ['Kestrel Studio'], Version: ['13.2'], 'Build environments': ['standard'], 'Features enabled': ['uploads', 'scheduling'] },
      { Name: ['KS-PROD'], Tool: ['Kestrel Studio'], Version: ['13.2'], 'Build environments': ['standard', 'frontend'], 'Features enabled': ['uploads', 'scheduling', 'single sign-on'] },
    ]);
    expect(f.state.writes.every((w) => w.as === 'app')).toBe(true);
    expect(DEMO_RECORDS.map((d) => d.Name[0])).toEqual(['KS-DEV', 'KS-PROD']);
  });

  it('run again, it creates nothing and returns the same keys', async () => {
    const f = fakeAssets();
    await ensureDemoRecords(f.app, f.user);
    const writes = f.state.writes.length;
    expect(await ensureDemoRecords(f.app, f.user)).toEqual({ ok: true, keys: { 'KS-DEV': 'TPENV-1', 'KS-PROD': 'TPENV-2' }, created: [], as: 'app' });
    expect(f.state.writes).toHaveLength(writes);
  });

  it('half set up (no Features enabled attribute, no KS-PROD), it adds only what is missing', async () => {
    const f = fakeAssets();
    await ensureDemoRecords(f.app, f.user);
    const typeId = f.state.types[0]!.id;
    f.state.attrs.set(typeId, f.state.attrs.get(typeId)!.filter((a) => a.name !== 'Features enabled'));
    f.state.objects.splice(1, 1);
    f.state.writes.length = 0;
    const r = await ensureDemoRecords(f.app, f.user);
    expect(r).toMatchObject({ ok: true, created: ['Features enabled', 'KS-PROD'] });
    expect(f.state.writes.map((w) => w.what)).toEqual(['attribute Features enabled', 'object']);
  });

  it('where the app is refused, the signed-in admin writes instead', async () => {
    const f = fakeAssets({ refuseWritesAs: ['app'] });
    const r = await ensureDemoRecords(f.app, f.user);
    expect(r).toMatchObject({ ok: true, as: 'user', keys: { 'KS-DEV': 'TPENV-1', 'KS-PROD': 'TPENV-2' } });
    expect(f.state.writes.every((w) => w.as === 'user')).toBe(true);
  });

  it('refused as both, it stops at the first write and says what to do; nothing half-made is reported as done', async () => {
    const f = fakeAssets({ refuseWritesAs: ['app', 'user'] });
    const r = await ensureDemoRecords(f.app, f.user);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('create schema') });
    if (!r.ok) expect(r.reason).toContain('403');
    expect(f.state.writes).toEqual([]);
  });

  it('a site without Assets is told so plainly, so setup can offer registry mode', async () => {
    const f = fakeAssets({ assets: false });
    expect(await ensureDemoRecords(f.app, f.user)).toEqual({ ok: false, reason: 'no_assets' });
  });

  it("a consent request from the admin's side is passed up, so Forge can show the consent screen", async () => {
    const f = fakeAssets({ refuseWritesAs: ['app'] });
    const consent = Object.assign(new Error('x'), { name: 'NEEDS_AUTHENTICATION_ERR' });
    const user: AssetsSetupClient = { ...f.user, createSchema: async () => Promise.reject(consent) };
    await expect(ensureDemoRecords(f.app, user)).rejects.toBe(consent);
  });
});

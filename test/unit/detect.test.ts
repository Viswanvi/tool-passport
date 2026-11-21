import { describe, expect, it } from 'vitest';
import { normaliseVersion, noteVersion, type ChangeRow, type DetectRepo, type EnvironmentSnapshot } from '../../src/change/detect';

/** In-memory stand-in for Forge SQL with the same unique key and compare-and-set semantics. */
function memoryRepo(start: { version: string | null; at: string | null }) {
  const env = { version: start.version, at: start.at };
  const rows: ChangeRow[] = [];
  let clock = 0;
  const repo: DetectRepo = {
    async setBaseline(_id, v) {
      if (env.version !== null) return false;
      env.version = v;
      env.at = `t${++clock}`;
      return true;
    },
    async insertChangeIgnoreDuplicate(row) {
      if (!rows.some((r) => r.baselineAt === row.baselineAt && r.toVersion === row.toVersion)) rows.push(row);
    },
    async compareAndSetVersion(_id, from, to) {
      if (env.version !== from) return false;
      env.version = to;
      env.at = `t${++clock}`;
      return true;
    },
  };
  const snap = (): EnvironmentSnapshot => ({ id: 1, toolId: 1, provider: 'assets', granularity: 'minor', lastSeenVersion: env.version, lastSeenAt: env.at });
  return { repo, rows, env, snap };
}

describe('normaliseVersion', () => {
  it('cuts to the tool granularity', () => {
    expect(normaliseVersion('13.2.1', 'minor')).toBe('13.2');
    expect(normaliseVersion('v14', 'minor')).toBe('14.0');
    expect(normaliseVersion('13.2.1', 'major')).toBe('13');
    expect(normaliseVersion(' 13.2.1 ', 'exact')).toBe('13.2.1');
  });
  it('returns null for things that are not versions', () => {
    expect(normaliseVersion('', 'minor')).toBeNull();
    expect(normaliseVersion('latest', 'minor')).toBeNull();
    expect(normaliseVersion(null, 'minor')).toBeNull();
  });
});

describe('noteVersion', () => {
  it('sets a baseline on first sighting, with no change row', async () => {
    const m = memoryRepo({ version: null, at: null });
    expect(await noteVersion(m.snap(), '13.2', m.repo)).toEqual({ action: 'baseline', set: true });
    expect(m.rows).toHaveLength(0);
  });

  it('makes one row when the same transition is detected twice from a stale snapshot', async () => {
    const m = memoryRepo({ version: '13.2', at: 't0' });
    const stale = m.snap();
    const [a, b] = await Promise.all([noteVersion(stale, '14.0', m.repo), noteVersion(stale, '14.0.3', m.repo)]);
    expect(m.rows).toHaveLength(1);
    expect([a, b].filter((o) => o.action === 'change' && o.moved)).toHaveLength(1);
    expect(m.env.version).toBe('14.0');
  });

  it('finishes after a crash between insert and update without a second row', async () => {
    const m = memoryRepo({ version: '13.2', at: 't0' });
    const s = m.snap();
    await m.repo.insertChangeIgnoreDuplicate({ toolId: 1, environmentId: 1, baselineAt: 't0', fromVersion: '13.2', toVersion: '14.0', origin: 'detected' });
    const o = await noteVersion(s, '14.0', m.repo);
    expect(o).toMatchObject({ action: 'change', moved: true });
    expect(m.rows).toHaveLength(1);
  });

  it('records rollback and a repeat upgrade as separate transitions', async () => {
    const m = memoryRepo({ version: '13.2', at: 't0' });
    await noteVersion(m.snap(), '14.0', m.repo);
    await noteVersion(m.snap(), '13.2', m.repo);
    await noteVersion(m.snap(), '14.0', m.repo);
    expect(m.rows.map((r) => `${r.fromVersion}→${r.toVersion}`)).toEqual(['13.2→14.0', '14.0→13.2', '13.2→14.0']);
  });

  it('ignores a patch release at minor granularity and labels registry changes as recorded', async () => {
    const m = memoryRepo({ version: '13.2', at: 't0' });
    expect(await noteVersion(m.snap(), '13.2.7', m.repo)).toEqual({ action: 'none' });
    await noteVersion({ ...m.snap(), provider: 'registry' }, '14.0', m.repo);
    expect(m.rows[0]?.origin).toBe('recorded');
  });
});

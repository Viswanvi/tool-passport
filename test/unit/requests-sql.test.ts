import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The requests table and stored asks with `@forge/sql` faked: the open key claim, the status guards on every
 * change (no transactions, D32), and strict row reading.
 */

const statements: Array<{ query: string; params: unknown[] }> = [];
const replies: Array<unknown[] | { affectedRows: number; insertId?: number } | Error> = [];
// Like the real SqlStatement: bindParams returns the statement, and execute works with or without it.
vi.mock('@forge/sql', () => ({
  sql: {
    prepare: (query: string) => {
      let params: unknown[] = [];
      const statement = {
        bindParams: (...p: unknown[]) => {
          params = p;
          return statement;
        },
        execute: async () => {
          statements.push({ query, params });
          const next = replies.shift();
          if (next instanceof Error) throw next;
          return { rows: next ?? [] };
        },
      };
      return statement;
    },
  },
}));

const { sqlRequestRepo, isDuplicateKey } = await import('../../src/db/requests');
const { loadAsk, purgeOldQuestions, recentAsksFor, saveAskResult } = await import('../../src/db/asks');
const { sqlChangeRepo, utcIso } = await import('../../src/db/changes');
const { sqlLabelStore } = await import('../../src/db/labels');
const { sqlResetStore } = await import('../../src/db/reset');
const { sqlApprovalStore } = await import('../../src/db/approvals');

beforeEach(() => {
  statements.length = 0;
  replies.length = 0;
});

const ROW = {
  id: 5,
  kind: 'fix',
  ask_id: 70,
  tool_id: 1,
  environment_id: 11,
  asker_account_id: 'acct-priya',
  owner_account_id: 'acct-marco',
  request_key: null,
  portal_url: null,
  target: 'ready:frontend_build',
  status: 'raising',
};
const NEW = {
  kind: 'fix' as const,
  askId: 70,
  toolId: 1,
  environmentId: 11,
  askerAccountId: 'acct-priya',
  ownerAccountId: 'acct-marco',
  target: 'ready:frontend_build',
  requirementHash: 'h',
  openKey: 'fix|11|ready:frontend_build|acct-priya',
};

describe('claiming the open key', () => {
  it('inserts a raising row and reads it back as mine', async () => {
    replies.push({ affectedRows: 1, insertId: 5 }, [ROW]);
    expect(await sqlRequestRepo.claim(NEW)).toMatchObject({ mine: true, row: { id: 5, status: 'raising', environmentId: 11 } });
    expect(statements[0]!.query).toContain("'raising'");
    expect(statements[0]!.params.at(-1)).toBe(NEW.openKey);
    expect(statements[1]).toMatchObject({ params: [NEW.openKey] });
  });

  it('a duplicate open key returns the row that holds it, not mine', async () => {
    replies.push(new Error("Duplicate entry 'fix|11|ready:frontend_build|acct-priya' for key 'one_open_request'"), [{ ...ROW, status: 'open', request_key: 'TPD-1' }]);
    expect(await sqlRequestRepo.claim(NEW)).toMatchObject({ mine: false, row: { requestKey: 'TPD-1', status: 'open' } });
  });

  it('any other insert error is not a claim', async () => {
    replies.push(new Error('connection reset'));
    await expect(sqlRequestRepo.claim(NEW)).rejects.toThrow('connection reset');
    expect(isDuplicateKey(new Error('ER_DUP_ENTRY'))).toBe(true);
    expect(isDuplicateKey(new Error('Table requests does not exist'))).toBe(false);
  });
});

describe('status changes are guarded by the current status', () => {
  it('resolve only an open row, and free its open key', async () => {
    replies.push({ affectedRows: 1 }, { affectedRows: 0 });
    expect(await sqlRequestRepo.markResolved(5)).toBe(true);
    expect(await sqlRequestRepo.markResolved(5)).toBe(false);
    expect(statements[0]!.query).toMatch(/SET status = 'resolved'.*open_key = NULL WHERE id = \? AND status = 'open'/s);
  });

  it('take over only a raising row whose lease ran out', async () => {
    replies.push({ affectedRows: 0 });
    expect(await sqlRequestRepo.takeOver(5)).toBe(false);
    expect(statements[0]!.query).toMatch(/status = 'raising' AND created_at < DATE_SUB/);
  });

  it('release, raise and close each touch only the status they expect', async () => {
    replies.push({ affectedRows: 1 }, { affectedRows: 1 }, { affectedRows: 1 });
    await sqlRequestRepo.release(5, 'boom');
    await sqlRequestRepo.markRaised(5, 'TPD-1', null);
    await sqlRequestRepo.markRechecked(5, { verdict: 'yes', reason: 'r', at: 't' });
    expect(statements.map((s) => /AND status = '(\w+)'/.exec(s.query)?.[1])).toEqual(['raising', 'raising', 'resolved']);
    expect(statements[0]!.query).toContain('open_key = NULL');
  });

  it('an undecided approval keeps its row open and is noted once', async () => {
    replies.push({ affectedRows: 1 }, { affectedRows: 0 });
    expect(await sqlRequestRepo.markUndecided(5)).toBe(true);
    expect(await sqlRequestRepo.markUndecided(5)).toBe(false);
    expect(statements[0]!.query).toMatch(/SET resolved_at = CURRENT_TIMESTAMP WHERE id = \? AND status = 'open' AND resolved_at IS NULL/);
    expect(statements[0]!.query).not.toMatch(/status = '(resolved|closed)'|open_key/);
  });

  it('looks up open requests by their open keys only', async () => {
    replies.push([]);
    expect(await sqlRequestRepo.openFor('acct-priya', 'fix', 11, [])).toEqual([]);
    expect(statements).toHaveLength(0);
    await sqlRequestRepo.openFor('acct-priya', 'fix', 11, ['ready:frontend_build', 'access:custom_ui']);
    expect(statements[0]!.params).toEqual(['fix|11|ready:frontend_build|acct-priya', 'fix|11|access:custom_ui|acct-priya']);
  });

  it('throws on a kind or status it does not know, instead of guessing', async () => {
    replies.push([{ ...ROW, status: 'pending' }]);
    await expect(sqlRequestRepo.byKey('TPD-1')).rejects.toThrow(/requests\.status/);
    replies.push([{ ...ROW, kind: 'vendor' }]);
    await expect(sqlRequestRepo.byKey('TPD-1')).rejects.toThrow(/requests\.kind/);
  });
});

describe('approval grants', () => {
  const G = { askerAccountId: 'acct-priya', toolId: 1, environmentId: 11, actionKey: 'custom_ui', requestKey: 'TPD-5' };

  it('a pending grant is an upsert on the request key that changes nothing when it exists', async () => {
    await sqlApprovalStore.addPending(G);
    expect(statements[0]!.query).toMatch(/INSERT INTO approval_grants .* 'pending'\)\s+ON DUPLICATE KEY UPDATE id = id/s);
    expect(statements[0]!.params).toEqual(['acct-priya', 1, 11, 'custom_ui', 'TPD-5']);
  });

  it('a decision changes only a pending grant, and inserts a missing one', async () => {
    await sqlApprovalStore.decide({ ...G, status: 'approved' });
    const q = statements[0]!.query;
    expect(q).toMatch(/INSERT INTO approval_grants .* VALUES \(\?, \?, \?, \?, \?, \?, CURRENT_TIMESTAMP\)/s);
    // decided_at before status, both guarded by the old status.
    expect(q.indexOf("decided_at = IF(status = 'pending'")).toBeGreaterThan(0);
    expect(q.indexOf("status = IF(status = 'pending'")).toBeGreaterThan(q.indexOf('decided_at = IF'));
    expect(statements[0]!.params.at(-1)).toBe('approved');
  });
});

describe('version changes', () => {
  it('re-verify items are inserted ignoring duplicates, and closed only for changes to that version', async () => {
    await sqlChangeRepo.addRecheckItems(3, 'fact', []);
    expect(statements).toHaveLength(0);
    replies.push({ affectedRows: 2 }, { affectedRows: 1 });
    await sqlChangeRepo.addRecheckItems(3, 'fact', [100, 103]);
    expect(statements[0]!.query).toMatch(/VALUES \(\?, \?, \?\), \(\?, \?, \?\) ON DUPLICATE KEY UPDATE id = id/);
    expect(statements[0]!.params).toEqual([3, 'fact', 100, 3, 'fact', 103]);
    await sqlChangeRepo.closeFactRechecks(100, '14.0');
    expect(statements[1]!.query).toMatch(/status = 'done' .* ref_id = \? AND status = 'open' AND change_id IN \(SELECT id FROM changes WHERE to_version = \?\)/);
    expect(statements[1]!.params).toEqual([100, '14.0']);
  });

  it('a listed change records when the owner was shown it, once; recent asks read their evidence', async () => {
    replies.push({ affectedRows: 1 }, [{ id: 7, evidence_json: { factVersionIds: [1003, 'x'] } }, { id: 8, evidence_json: null }]);
    await sqlChangeRepo.setStatus(3, 'listed');
    expect(statements[0]!.query).toContain('owner_notified_at = COALESCE(owner_notified_at, CURRENT_TIMESTAMP)');
    expect(await sqlChangeRepo.recentAsks(11, 30)).toEqual([
      { id: 7, factVersionIds: [1003] },
      { id: 8, factVersionIds: [] },
    ]);
    expect(statements[1]!.query).toContain('INTERVAL 30 DAY');
  });

  it('lists sort by time, then id: Forge SQL ids are not in time order (found live: 06:19 showed above 06:28)', async () => {
    await sqlChangeRepo.changesFor(1, 20);
    await sqlChangeRepo.openChanges(10);
    await sqlChangeRepo.recentAsks(11, 30);
    await recentAsksFor('acct-priya', 10);
    await sqlRequestRepo.openByKind(1, 'question', 50);
    const [changes, open, asks, mine, questions] = statements.map((s) => s.query.replace(/\s+/g, ' '));
    expect(changes).toMatch(/ORDER BY created_at DESC, id DESC LIMIT 20$/);
    expect(open).toMatch(/ORDER BY created_at ASC, id ASC LIMIT 10$/);
    expect(asks).toMatch(/ORDER BY created_at DESC, id DESC LIMIT 500$/);
    expect(mine).toMatch(/ORDER BY created_at DESC, id DESC LIMIT 10$/);
    expect(questions).toMatch(/ORDER BY created_at ASC, id ASC LIMIT 50$/);
  });

  it('release-note labels: saved in one statement that is safe to repeat (a new paste replaces them), read back strictly', async () => {
    await sqlLabelStore.saveLabels([]);
    expect(statements).toHaveLength(0);
    replies.push({ affectedRows: 2 });
    await sqlLabelStore.saveLabels([
      { changeId: 3, factId: 11, label: 'changed', quote: 'now 5 GB', modelId: 'm' },
      { changeId: 3, factId: 12, label: 'cant_tell', quote: null, modelId: 'm' },
    ]);
    expect(statements[0]!.query).toMatch(/INSERT INTO release_labels \(change_id, fact_id, label, quote, model_id\) VALUES \(\?, \?, \?, \?, \?\), \(\?, \?, \?, \?, \?\) ON DUPLICATE KEY UPDATE label = VALUES\(label\), quote = VALUES\(quote\), model_id = VALUES\(model_id\)/);
    expect(statements[0]!.params).toEqual([3, 11, 'changed', 'now 5 GB', 'm', 3, 12, 'cant_tell', null, 'm']);
    expect(await sqlLabelStore.labelsFor([])).toEqual([]);
    replies.push([
      { change_id: 3, fact_id: 11, label: 'changed', quote: 'now 5 GB', model_id: 'm' },
      { change_id: '3', fact_id: '12', label: 'cant_tell', quote: null, model_id: null },
    ]);
    expect(await sqlLabelStore.labelsFor([3, 4])).toEqual([
      { changeId: 3, factId: 11, label: 'changed', quote: 'now 5 GB', modelId: 'm' },
      { changeId: 3, factId: 12, label: 'cant_tell', quote: null, modelId: null },
    ]);
    expect(statements[1]!.query).toContain('WHERE change_id IN (?, ?)');
    replies.push([{ change_id: 3, fact_id: 11, label: 'approved', quote: null, model_id: null }]);
    await expect(sqlLabelStore.labelsFor([3])).rejects.toThrow();
  });

  it('Reset demo finds the demo tool by name and clears only its rows, children before parents', async () => {
    replies.push([{ id: 7 }], [{ provider: 'assets' }]);
    expect(await sqlResetStore.demoTool()).toEqual({ id: 7, mode: 'assets' });
    expect(statements[0]!.query).toContain('FROM tools WHERE name = ?');
    expect(statements[0]!.params).toEqual(['Kestrel Studio']);
    statements.length = 0;
    for (let i = 0; i < 20; i++) replies.push({ affectedRows: 1 });
    const cleared = await sqlResetStore.clearTool(7);
    const qs = statements.map((s) => s.query.replace(/\s+/g, ' '));
    // Every statement is scoped to the demo tool, directly or through its changes and facts.
    expect(statements.every((s) => s.params.length === 1 && s.params[0] === 7)).toBe(true);
    expect(qs.every((q) => /tool_id = \?/.test(q))).toBe(true);
    const order = (t: string) => qs.findIndex((q) => q.startsWith(`DELETE FROM ${t} `));
    expect(order('release_labels')).toBeLessThan(order('changes'));
    expect(order('recheck_items')).toBeLessThan(order('changes'));
    expect(order('fact_versions')).toBeLessThan(order('facts'));
    expect(order('story_shares')).toBeLessThan(order('asks'));
    for (const t of ['asks', 'requests', 'approval_grants', 'rules', 'readiness_keys', 'access_mappings', 'capability_links', 'catalog_keys', 'translations', 'environments']) {
      expect(order(t)).toBeGreaterThanOrEqual(0);
    }
    expect(qs.some((q) => /DELETE FROM (tools|audit_log|app_settings)\b/.test(q))).toBe(false);
    expect(Object.values(cleared).reduce((a, b) => a + b, 0)).toBe(statements.length);
    replies.push([]);
    expect(await sqlResetStore.demoTool()).toBeNull();
  });

  it('a change time without a zone is read as UTC (found live)', () => {
    expect(utcIso('2026-11-23 12:49:51')).toBe('2026-11-23T12:49:51Z');
    expect(utcIso('2026-11-23T12:49:51.000Z')).toBe('2026-11-23T12:49:51.000Z');
    expect(utcIso('')).toBe('');
  });

  it('asking again clears "may have changed"', async () => {
    replies.push({ affectedRows: 1 });
    await saveAskResult(70, 'yes', [1000]);
    expect(statements[0]!.query).toContain('may_have_changed = FALSE');
  });
});

describe('stored asks', () => {
  const ASK = { id: 70, asker_account_id: 'acct-priya', tool_id: 1, environment_id: '11' };
  it('read the stored keys, and nothing of the question text', async () => {
    replies.push([{ ...ASK, requirement_json: { requirement: [{ key: 'max_upload_gb', value: 3 }] } }]);
    expect(await loadAsk(70)).toEqual({ id: 70, askerAccountId: 'acct-priya', toolId: 1, environmentId: 11, requirement: [{ key: 'max_upload_gb', value: 3 }] });
    expect(statements[0]!.query).not.toContain('question_text');
  });

  it('a requirement that does not read cleanly is null (re-checks as Don\'t know yet)', async () => {
    for (const bad of [null, 'not json', { requirement: [] }, { requirement: [{ value: 3 }] }, { requirement: 'web_frontend' }]) {
      replies.push([{ ...ASK, requirement_json: bad }]);
      expect((await loadAsk(70))?.requirement).toBeNull();
    }
    replies.push([]);
    expect(await loadAsk(71)).toBeNull();
  });

  it('question text is cleared after 30 days, and only the text (spec section 14)', async () => {
    replies.push({ affectedRows: 3 });
    expect(await purgeOldQuestions()).toBe(3);
    const q = statements[0]!.query;
    expect(q).toMatch(/^UPDATE asks SET question_text = NULL WHERE/);
    expect(q).toContain('created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)');
    // Verdicts, keys and evidence stay; nothing is deleted.
    expect(q).not.toMatch(/DELETE|requirement_json|verdict|evidence_json/);
  });
});

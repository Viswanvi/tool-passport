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
const { loadAsk, purgeOldQuestions } = await import('../../src/db/asks');

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

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The story_shares statements with `@forge/sql` faked (D53). */

const statements: Array<{ query: string; params: unknown[] }> = [];
const replies: unknown[] = [];
vi.mock('@forge/sql', () => ({
  sql: {
    prepare: (query: string) => ({
      bindParams: (...params: unknown[]) => ({
        execute: async () => {
          statements.push({ query: query.replace(/\s+/g, ' '), params });
          return { rows: replies.shift() ?? [] };
        },
      }),
    }),
  },
}));

const { sqlStoryShares } = await import('../../src/db/story-shares');

beforeEach(() => {
  statements.length = 0;
  replies.length = 0;
});

const ASK = { id: 71, askerAccountId: 'acct-priya', toolId: 1, environmentId: 11, requirement: [{ key: 'web_frontend' }] };

describe('story_shares', () => {
  it('finds stories for the same person, tool and environment in SQL, and the same keys in code', async () => {
    replies.push([
      { id: 900, issue_key: 'KAN-7', verdict: 'not_ready', requirement_json: { requirement: [{ key: 'web_frontend' }] } },
      { id: 901, issue_key: 'KAN-8', verdict: 'not_ready', requirement_json: '{"requirement":[{"key":"max_upload_gb","value":3}]}' },
      { id: 902, issue_key: 'KAN-9', verdict: 'not_ready', requirement_json: null },
    ]);
    expect(await sqlStoryShares.related(ASK)).toEqual([{ id: 900, issueKey: 'KAN-7', verdict: 'not_ready' }]);
    expect(statements[0]!.query).toMatch(/FROM story_shares s JOIN asks a ON a\.id = s\.ask_id WHERE a\.asker_account_id = \? AND a\.tool_id = \? AND a\.environment_id = \? ORDER BY s\.id LIMIT 50/);
    expect(statements[0]!.params).toEqual(['acct-priya', 1, 11]);

    await sqlStoryShares.related({ ...ASK, environmentId: null });
    expect(statements[1]!.query).toContain('a.environment_id IS NULL');
    expect(statements[1]!.params).toEqual(['acct-priya', 1]);
  });

  it('saves with an upsert and moves the verdict only from the value it was told', async () => {
    await sqlStoryShares.save({ askId: 71, toolId: 1, issueKey: 'KAN-7', verdict: 'not_ready' });
    expect(statements[0]!.query).toMatch(/INSERT INTO story_shares \(ask_id, tool_id, issue_key, verdict\) VALUES \(\?, \?, \?, \?\) ON DUPLICATE KEY UPDATE verdict = VALUES\(verdict\)/);
    replies.push({ affectedRows: 1 }, { affectedRows: 0 });
    expect(await sqlStoryShares.moveVerdict(900, 'not_ready', 'yes')).toBe(true);
    expect(await sqlStoryShares.moveVerdict(900, 'not_ready', 'yes')).toBe(false);
    expect(statements[1]!).toEqual({ query: 'UPDATE story_shares SET verdict = ? WHERE id = ? AND verdict = ?', params: ['yes', 900, 'not_ready'] });
  });
});

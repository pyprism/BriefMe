import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
const delay = () => new Promise((r) => setTimeout(r, Math.random() * 5));

// Reads and writes yield to the event loop so unprotected read-modify-write sequences interleave.
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => {
          await delay();
          return key in store ? { [key]: structuredClone(store[key]) } : {};
        },
        set: async (items: Record<string, unknown>) => {
          await delay();
          for (const [k, v] of Object.entries(items)) store[k] = structuredClone(v);
        },
        remove: async (key: string) => {
          await delay();
          delete store[key];
        },
      },
    },
  },
}));

const h = await import('../../src/lib/storage/history');

const entry = (n: number): import('../../src/lib/storage/history').HistoryEntry => ({
  id: `id${n}`,
  key: `key${n}`,
  url: `https://x.org/${n}`,
  title: `T${n}`,
  style: 'bullets',
  model: 'm',
  language: 'auto',
  summary: `S${n}`,
  createdAt: n,
  readMinutes: 1,
  elapsedSec: 1,
});

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('history and stats storage', () => {
  it('keeps every entry when summaries finish at the same time', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => h.addHistory(entry(i))));
    const ids = (await h.listHistory()).map((e) => e.id).sort();
    expect(ids).toEqual(Array.from({ length: 12 }, (_, i) => `id${i}`).sort());
  });

  it('counts every summary and all time saved under concurrency', async () => {
    await Promise.all(Array.from({ length: 10 }, () => h.addStats(30)));
    expect(await h.loadStats()).toEqual({ summaries: 10, secondsSaved: 300 });
  });

  it('does not bring back an entry that was deleted while another was added', async () => {
    await h.addHistory(entry(1));
    await Promise.all([h.deleteHistory('id1'), h.addHistory(entry(2))]);
    expect((await h.listHistory()).map((e) => e.id)).toEqual(['id2']);
  });

  it('clear and add resolve in call order', async () => {
    await h.addHistory(entry(1));
    await Promise.all([h.clearHistory(), h.addHistory(entry(2))]);
    expect((await h.listHistory()).map((e) => e.id)).toEqual(['id2']);
  });

  it('enforces the limit and replaces entries with the same key', async () => {
    await Promise.all(
      Array.from({ length: h.HISTORY_LIMIT + 5 }, (_, i) => h.addHistory(entry(i))),
    );
    expect((await h.listHistory()).length).toBe(h.HISTORY_LIMIT);
    await h.addHistory({ ...entry(1000), key: 'same', summary: 'first' });
    await h.addHistory({ ...entry(1001), key: 'same', summary: 'second' });
    const same = (await h.listHistory()).filter((e) => e.key === 'same');
    expect(same.map((e) => e.summary)).toEqual(['second']);
  });

  it('keeps working after a failed operation', async () => {
    const original = store;
    await h.addHistory(entry(1));
    expect(original).toBeDefined();
    await expect(h.deleteHistory('missing')).resolves.toBeUndefined();
    await h.addHistory(entry(2));
    expect((await h.listHistory()).length).toBe(2);
  });
});

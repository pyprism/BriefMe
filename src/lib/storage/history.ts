import { browser } from 'wxt/browser';
import type { StyleId } from '../settings-schema';

export interface HistoryEntry {
  id: string;
  /** Hash of url + text + model + style + language, used as summary cache key. */
  key: string;
  url: string;
  title: string;
  style: StyleId;
  model: string;
  language: string;
  summary: string;
  createdAt: number;
  readMinutes: number;
  elapsedSec: number;
}

export interface Stats {
  summaries: number;
  secondsSaved: number;
}

const KEY = 'history';
const LOCK_NAME = 'briefme-storage';
const STATS_KEY = 'stats';
export const HISTORY_LIMIT = 200;

let chain: Promise<unknown> = Promise.resolve();

/**
 * Run a storage read-modify-write one at a time. Web Locks serialize across the background
 * worker and extension pages; the promise chain covers browsers without them.
 */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = () => {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    return locks ? locks.request(LOCK_NAME, task) : task();
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}

export async function hashKey(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join('\u0000'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const got = await browser.storage.local.get(KEY);
  return (got[KEY] as HistoryEntry[] | undefined) ?? [];
}

export async function findCached(key: string): Promise<HistoryEntry | undefined> {
  return (await listHistory()).find((e) => e.key === key);
}

export function addHistory(entry: HistoryEntry): Promise<void> {
  return exclusive(async () => {
    const list = (await listHistory()).filter((e) => e.key !== entry.key);
    list.unshift(entry);
    await browser.storage.local.set({ [KEY]: list.slice(0, HISTORY_LIMIT) });
  });
}

export function deleteHistory(id: string): Promise<void> {
  return exclusive(async () => {
    const list = (await listHistory()).filter((e) => e.id !== id);
    await browser.storage.local.set({ [KEY]: list });
  });
}

export function clearHistory(): Promise<void> {
  return exclusive(() => browser.storage.local.remove(KEY));
}

export async function loadStats(): Promise<Stats> {
  const got = await browser.storage.local.get(STATS_KEY);
  return (got[STATS_KEY] as Stats | undefined) ?? { summaries: 0, secondsSaved: 0 };
}

export function addStats(secondsSaved: number): Promise<void> {
  return exclusive(async () => {
    const stats = await loadStats();
    await browser.storage.local.set({
      [STATS_KEY]: {
        summaries: stats.summaries + 1,
        secondsSaved: stats.secondsSaved + Math.max(0, secondsSaved),
      },
    });
  });
}

export function historyToMarkdown(
  entry: Pick<HistoryEntry, 'title' | 'url' | 'summary' | 'model' | 'createdAt'>,
): string {
  const date = new Date(entry.createdAt).toISOString().slice(0, 10);
  return `# ${entry.title}\n\nSource: ${entry.url}\nSummarized: ${date} with ${entry.model}\n\n${entry.summary}\n`;
}

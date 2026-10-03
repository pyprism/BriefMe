import { beforeEach, describe, expect, it, vi } from 'vitest';

type Area = {
  data: Record<string, unknown>;
  failSet: boolean;
  failGet: boolean;
};

const areas: Record<'sync' | 'local', Area> = {
  sync: { data: {}, failSet: false, failGet: false },
  local: { data: {}, failSet: false, failGet: false },
};

vi.mock('wxt/browser', () => {
  const make = (name: 'sync' | 'local') => ({
    get: async (key: string) => {
      if (areas[name].failGet) throw new Error('get failed');
      return key in areas[name].data ? { [key]: areas[name].data[key] } : {};
    },
    set: async (items: Record<string, unknown>) => {
      if (areas[name].failSet) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      Object.assign(areas[name].data, items);
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete areas[name].data[k];
    },
  });
  return { browser: { storage: { sync: make('sync'), local: make('local') } } };
});

const { loadSettings, saveSettings, resetAll } = await import('../../src/lib/storage/settings');
const { DEFAULT_SETTINGS } = await import('../../src/lib/settings-schema');

const withModel = (model: string) => ({
  ...DEFAULT_SETTINGS,
  baseUrl: 'http://x/v1',
  model,
  onboarded: true,
});

beforeEach(() => {
  for (const a of Object.values(areas))
    Object.assign(a, { data: {}, failSet: false, failGet: false });
  vi.useRealTimers();
});

describe('settings storage', () => {
  it('round-trips through both areas', async () => {
    await saveSettings(withModel('a'));
    expect((await loadSettings()).model).toBe('a');
    expect(areas.sync.data.settings).toBeDefined();
    expect(areas.local.data.settings).toBeDefined();
  });

  it('returns the latest settings after a later sync write fails', async () => {
    await saveSettings(withModel('A'));
    areas.sync.failSet = true;
    await saveSettings(withModel('B'));
    expect((await loadSettings()).model).toBe('B');
  });

  it('keeps working when sync reads fail', async () => {
    await saveSettings(withModel('A'));
    areas.sync.failGet = true;
    expect((await loadSettings()).model).toBe('A');
  });

  it('works when sync is unavailable from the start', async () => {
    areas.sync.failSet = true;
    areas.sync.failGet = true;
    await saveSettings(withModel('only-local'));
    expect((await loadSettings()).model).toBe('only-local');
  });

  it('picks up a newer value written to sync by another device', async () => {
    await saveSettings(withModel('mine'));
    areas.sync.data.settings = {
      ...withModel('theirs'),
      savedAt: Date.now() + 60_000,
    };
    expect((await loadSettings()).model).toBe('theirs');
  });

  it('ignores an older synced value', async () => {
    await saveSettings(withModel('mine'));
    areas.sync.data.settings = { ...withModel('stale'), savedAt: 1 };
    expect((await loadSettings()).model).toBe('mine');
  });

  it('reads settings saved before timestamps existed', async () => {
    areas.sync.data.settings = withModel('legacy');
    expect((await loadSettings()).model).toBe('legacy');
  });

  it('reset clears both copies', async () => {
    await saveSettings(withModel('a'));
    await resetAll();
    expect((await loadSettings()).model).toBe('');
  });
});

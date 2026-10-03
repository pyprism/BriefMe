import { browser } from 'wxt/browser';
import {
  DEFAULT_SECRETS,
  DEFAULT_SETTINGS,
  validateSettings,
  type Secrets,
  type Settings,
} from '../settings-schema';

const SETTINGS_KEY = 'settings';
const SECRETS_KEY = 'secrets';

/** Stored value: the settings plus the time they were saved. */
type StoredSettings = Partial<Settings> & { savedAt?: number };

async function readArea(area: 'sync' | 'local'): Promise<StoredSettings | undefined> {
  try {
    const got = await browser.storage[area].get(SETTINGS_KEY);
    return got[SETTINGS_KEY] as StoredSettings | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Settings can live in both areas: every save writes the local copy, and the sync copy when
 * the browser allows it. The copy with the newest `savedAt` wins, so a failed sync write can not
 * bring back older values, and a newer value synced from another device is still picked up.
 */
async function readSettingsRaw(): Promise<StoredSettings> {
  const [sync, local] = await Promise.all([readArea('sync'), readArea('local')]);
  if (sync && local) return (sync.savedAt ?? 0) > (local.savedAt ?? 0) ? sync : local;
  return sync ?? local ?? {};
}

export async function loadSettings(): Promise<Settings> {
  const raw = await readSettingsRaw();
  return validateSettings({ ...DEFAULT_SETTINGS, ...raw }).settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const stored: StoredSettings = { ...settings, savedAt: Date.now() };
  await browser.storage.local.set({ [SETTINGS_KEY]: stored });
  try {
    await browser.storage.sync.set({ [SETTINGS_KEY]: stored });
  } catch {
    // sync unavailable or over quota: the local copy above is the newest
  }
}

export async function loadSecrets(): Promise<Secrets> {
  const got = await browser.storage.local.get(SECRETS_KEY);
  return { ...DEFAULT_SECRETS, ...(got[SECRETS_KEY] as Partial<Secrets> | undefined) };
}

export async function saveSecrets(secrets: Secrets): Promise<void> {
  await browser.storage.local.set({ [SECRETS_KEY]: secrets });
}

export async function resetAll(): Promise<void> {
  await browser.storage.sync.remove(SETTINGS_KEY).catch(() => {});
  await browser.storage.local.remove([SETTINGS_KEY, SECRETS_KEY]);
}

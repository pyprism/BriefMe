import { browser } from 'wxt/browser';
import type { Settings } from '../settings-schema';
import { originPattern } from '../url';

export const hasOrigin = (pattern: string): Promise<boolean> =>
  browser.permissions.contains({ origins: [pattern] });

/** Settings with the fallback switched off when its host permission is missing. */
export async function effectiveSettings(settings: Settings): Promise<Settings> {
  if (!settings.fallbackEnabled) return settings;
  const pattern = originPattern(settings.fallbackBaseUrl);
  if (pattern && (await hasOrigin(pattern))) return settings;
  return { ...settings, fallbackEnabled: false };
}

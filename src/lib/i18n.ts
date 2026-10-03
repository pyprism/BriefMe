import { browser } from 'wxt/browser';

/** Translate a message key from _locales (invalid chars become _). Falls back to the key itself. */
export function t(key: string, fallback?: string): string {
  try {
    return browser.i18n.getMessage(key.replace(/[^A-Za-z0-9_@]/g, '_') as never) || fallback || key;
  } catch {
    return fallback || key;
  }
}

import { hostInList, hostOf } from './url';

export type GuardResult = { ok: true } | { ok: false; reason: 'scheme' | 'denied' | 'not-allowed' };

export interface GuardLists {
  denyList: string[];
  allowList: string[];
}

/** Decide whether a page may be summarized, based on its URL and the user's lists. */
export function checkUrl(url: string | undefined, lists: GuardLists): GuardResult {
  if (!url) return { ok: false, reason: 'scheme' };
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return { ok: false, reason: 'scheme' };
  }
  if (protocol !== 'http:' && protocol !== 'https:') return { ok: false, reason: 'scheme' };
  const host = hostOf(url);
  if (!host) return { ok: false, reason: 'scheme' };
  if (hostInList(host, lists.denyList)) return { ok: false, reason: 'denied' };
  if (lists.allowList.length > 0 && !hostInList(host, lists.allowList)) {
    return { ok: false, reason: 'not-allowed' };
  }
  return { ok: true };
}

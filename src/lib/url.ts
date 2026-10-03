/** Normalize a user-entered base URL. Returns null when invalid. */
export function normalizeBaseUrl(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  url.hash = '';
  url.search = '';
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** Match pattern used for runtime host permission requests (ports are not allowed in patterns). */
export function originPattern(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

export function hostOf(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** "example.com" matches example.com and its subdomains. "*.example.com" matches subdomains only. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  if (p.startsWith('*.')) return h.endsWith(p.slice(1));
  return h === p || h.endsWith(`.${p}`);
}

export function hostInList(host: string, list: string[]): boolean {
  return list.some((p) => hostMatches(host, p));
}

export function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

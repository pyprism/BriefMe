import { describe, expect, it } from 'vitest';
import { checkUrl } from '../../src/lib/guard';
import { hostMatches, normalizeBaseUrl, originPattern, parseList } from '../../src/lib/url';

describe('normalizeBaseUrl', () => {
  it('adds scheme and trims slashes', () => {
    expect(normalizeBaseUrl('localhost:11434/')).toBe('http://localhost:11434');
    expect(normalizeBaseUrl(' https://ollama.example.com/ollama// ')).toBe(
      'https://ollama.example.com/ollama',
    );
  });
  it('drops query and hash', () => {
    expect(normalizeBaseUrl('http://a.b:1/x?y=1#z')).toBe('http://a.b:1/x');
  });
  it('rejects invalid input', () => {
    expect(normalizeBaseUrl('')).toBeNull();
    expect(normalizeBaseUrl('ftp://host')).toBeNull();
    expect(normalizeBaseUrl('http://')).toBeNull();
  });
});

describe('originPattern', () => {
  it('omits the port', () => {
    expect(originPattern('http://localhost:11434')).toBe('http://localhost/*');
    expect(originPattern('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/*');
  });
  it('rejects non-http', () => {
    expect(originPattern('chrome://extensions')).toBeNull();
    expect(originPattern('nonsense')).toBeNull();
  });
});

describe('hostMatches', () => {
  it('matches apex and subdomains', () => {
    expect(hostMatches('news.example.com', 'example.com')).toBe(true);
    expect(hostMatches('example.com', 'example.com')).toBe(true);
    expect(hostMatches('badexample.com', 'example.com')).toBe(false);
  });
  it('supports wildcard subdomain patterns', () => {
    expect(hostMatches('a.example.com', '*.example.com')).toBe(true);
    expect(hostMatches('example.com', '*.example.com')).toBe(false);
  });
  it('parses lists', () => {
    expect(parseList('a.com, b.com\n\n c.com ')).toEqual(['a.com', 'b.com', 'c.com']);
  });
});

describe('checkUrl', () => {
  const lists = { denyList: ['bank.example'], allowList: [] as string[] };
  it('allows normal pages', () => {
    expect(checkUrl('https://news.example.org/a', lists)).toEqual({ ok: true });
  });
  it('blocks non-web schemes', () => {
    for (const url of [
      'file:///etc/hosts',
      'chrome://settings',
      'about:blank',
      'moz-extension://x/y.html',
      undefined,
    ]) {
      expect(checkUrl(url, lists)).toEqual({ ok: false, reason: 'scheme' });
    }
  });
  it('applies deny and allow lists', () => {
    expect(checkUrl('https://my.bank.example/x', lists)).toEqual({ ok: false, reason: 'denied' });
    expect(checkUrl('https://a.org', { denyList: [], allowList: ['b.org'] })).toEqual({
      ok: false,
      reason: 'not-allowed',
    });
    expect(checkUrl('https://x.b.org', { denyList: [], allowList: ['b.org'] })).toEqual({
      ok: true,
    });
  });
});

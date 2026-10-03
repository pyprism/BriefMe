import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/settings-schema';
import { cacheKeyParts, type CacheKeyInput } from '../../src/lib/summarize/cache-key';

const custom = { id: 'c1', name: 'Mine', system: 'SYS', template: 'T {{text}}' };

const base = (over: Partial<Settings> = {}): CacheKeyInput => ({
  article: { url: 'https://x.org/a', text: 'Body' },
  settings: { ...DEFAULT_SETTINGS, baseUrl: 'http://a/v1', customPrompts: [custom], ...over },
  model: 'm',
  style: 'bullets',
  language: 'auto',
});

const key = (i: CacheKeyInput) => JSON.stringify(cacheKeyParts(i));

describe('cache key', () => {
  it('is stable for identical input', () => {
    expect(key(base())).toBe(key(base()));
  });

  const changes: [string, (i: CacheKeyInput) => CacheKeyInput][] = [
    ['article text', (i) => ({ ...i, article: { ...i.article, text: 'Other' } })],
    ['article url', (i) => ({ ...i, article: { ...i.article, url: 'https://x.org/b' } })],
    ['model name', (i) => ({ ...i, model: 'm2' })],
    ['style', (i) => ({ ...i, style: 'tldr' })],
    ['language', (i) => ({ ...i, language: 'French' })],
    ['provider URL', (i) => ({ ...i, settings: { ...i.settings, baseUrl: 'http://b/v1' } })],
    ['provider type', (i) => ({ ...i, settings: { ...i.settings, primaryType: 'ollama' } })],
    ['system prompt', (i) => ({ ...i, settings: { ...i.settings, systemPrompt: 'X' } })],
    ['template', (i) => ({ ...i, settings: { ...i.settings, promptTemplate: '{{text}}' } })],
    ['input limit', (i) => ({ ...i, settings: { ...i.settings, maxInputChars: 5000 } })],
    ['context size', (i) => ({ ...i, settings: { ...i.settings, numCtx: 4096 } })],
    ['temperature', (i) => ({ ...i, settings: { ...i.settings, temperature: 0.9 } })],
    [
      'backup being turned on',
      (i) => ({ ...i, settings: { ...i.settings, fallbackEnabled: true } }),
    ],
  ];
  it.each(changes)('changes when the %s changes', (_name, change) => {
    expect(key(change(base()))).not.toBe(key(base()));
  });

  describe('backup provider', () => {
    const on = (over: Partial<Settings> = {}) =>
      base({
        fallbackEnabled: true,
        fallbackType: 'openai',
        fallbackBaseUrl: 'https://b.example/v1',
        fallbackModel: 'big',
        ...over,
      });

    it('changes when the backup type, URL or model changes', () => {
      expect(key(on({ fallbackType: 'ollama' }))).not.toBe(key(on()));
      expect(key(on({ fallbackBaseUrl: 'https://c.example/v1' }))).not.toBe(key(on()));
      expect(key(on({ fallbackModel: 'small' }))).not.toBe(key(on()));
    });

    it('changes when the backup is turned off', () => {
      expect(key(base({ ...on(), fallbackEnabled: false }))).not.toBe(key(on()));
    });

    it('ignores leftover backup fields while the backup is off', () => {
      const a = base({ fallbackEnabled: false, fallbackModel: 'x', fallbackBaseUrl: 'http://x' });
      const b = base({ fallbackEnabled: false, fallbackModel: 'y', fallbackBaseUrl: 'http://y' });
      expect(key(a)).toBe(key(b));
    });
  });

  it('changes when a custom prompt is edited under the same id', () => {
    const style = 'custom:c1' as const;
    const before = { ...base(), style };
    const editedSystem = base({ customPrompts: [{ ...custom, system: 'NEW' }] });
    const editedTemplate = base({ customPrompts: [{ ...custom, template: 'NEW {{text}}' }] });
    expect(key({ ...editedSystem, style })).not.toBe(key(before));
    expect(key({ ...editedTemplate, style })).not.toBe(key(before));
  });

  it('ignores a custom prompt edit for built-in styles', () => {
    const edited = base({ customPrompts: [{ ...custom, system: 'NEW' }] });
    expect(key(edited)).toBe(key(base()));
  });

  it('ignores settings that do not change the output', () => {
    const same = base({
      theme: 'dark',
      position: 'bottom-left',
      denyList: ['a.com'],
      obsidianVault: 'v',
    });
    expect(key(same)).toBe(key(base()));
  });
});

import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, matchPreset } from '../../src/lib/presets';
import { normalizeBaseUrl } from '../../src/lib/url';

describe('presets', () => {
  it('has valid, unique URLs', () => {
    const urls = PROVIDER_PRESETS.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(normalizeBaseUrl(url)).toBe(url);
  });

  it('matches by type and URL, ignoring a trailing slash', () => {
    expect(matchPreset('ollama', 'http://localhost:11434/')?.id).toBe('ollama');
    expect(matchPreset('openai', 'http://localhost:1234/v1')?.id).toBe('lmstudio');
    expect(matchPreset('openai', 'http://localhost:11434')).toBeUndefined();
    expect(matchPreset('openai', 'https://example.com/v1')).toBeUndefined();
  });
});

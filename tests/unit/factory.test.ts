import { describe, expect, it } from 'vitest';
import { FallbackProvider } from '../../src/lib/providers/fallback';
import { buildProvider, createProvider, httpOptionsFrom } from '../../src/lib/providers/factory';
import { collect } from '../../src/lib/providers/types';
import { OllamaProvider } from '../../src/lib/providers/ollama';
import { OpenAICompatProvider } from '../../src/lib/providers/openai';
import { DEFAULT_SECRETS, DEFAULT_SETTINGS } from '../../src/lib/settings-schema';

describe('provider factory', () => {
  it('builds the provider that matches the type', () => {
    expect(buildProvider('ollama', 'http://x')).toBeInstanceOf(OllamaProvider);
    expect(buildProvider('openai', 'http://x/v1')).toBeInstanceOf(OpenAICompatProvider);
  });

  it('uses the primary type from settings', () => {
    const openai = { ...DEFAULT_SETTINGS, primaryType: 'openai' as const, baseUrl: 'http://x/v1' };
    expect(createProvider(openai, DEFAULT_SECRETS)).toBeInstanceOf(OpenAICompatProvider);
    const ollama = { ...DEFAULT_SETTINGS, primaryType: 'ollama' as const, baseUrl: 'http://x' };
    expect(createProvider(ollama, DEFAULT_SECRETS)).toBeInstanceOf(OllamaProvider);
  });

  it('wraps with the fallback only when enabled and a model is set', () => {
    const base = { ...DEFAULT_SETTINGS, baseUrl: 'http://x/v1', fallbackEnabled: true };
    expect(createProvider(base, DEFAULT_SECRETS)).not.toBeInstanceOf(FallbackProvider);
    const noUrl = { ...base, fallbackModel: 'm' };
    expect(createProvider(noUrl, DEFAULT_SECRETS)).not.toBeInstanceOf(FallbackProvider);
    const full = { ...noUrl, fallbackBaseUrl: 'http://y', fallbackType: 'ollama' as const };
    expect(createProvider(full, DEFAULT_SECRETS)).toBeInstanceOf(FallbackProvider);
  });

  it('allows any type combination for primary and backup', () => {
    for (const primaryType of ['ollama', 'openai'] as const) {
      for (const fallbackType of ['ollama', 'openai'] as const) {
        const s = {
          ...DEFAULT_SETTINGS,
          primaryType,
          baseUrl: 'http://a',
          fallbackEnabled: true,
          fallbackType,
          fallbackBaseUrl: 'http://b',
          fallbackModel: 'm',
        };
        expect(createProvider(s, DEFAULT_SECRETS)).toBeInstanceOf(FallbackProvider);
      }
    }
  });

  it('converts the timeout settings to milliseconds', () => {
    expect(httpOptionsFrom({ firstResponseTimeoutSec: 600, idleTimeoutSec: 180 })).toEqual({
      firstByteTimeoutMs: 600_000,
      idleTimeoutMs: 180_000,
    });
    expect(
      httpOptionsFrom({
        firstResponseTimeoutSec: DEFAULT_SETTINGS.firstResponseTimeoutSec,
        idleTimeoutSec: DEFAULT_SETTINGS.idleTimeoutSec,
      }).firstByteTimeoutMs,
    ).toBe(600_000);
  });

  it('applies the timeouts to the provider it builds', async () => {
    const hanging = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        ),
      )) as typeof fetch;
    for (const type of ['ollama', 'openai'] as const) {
      const provider = buildProvider(type, 'http://x', undefined, {
        fetchImpl: hanging,
        firstByteTimeoutMs: 30,
        retryDelaysMs: [],
      });
      const request = {
        model: 'm',
        messages: [{ role: 'user' as const, content: 'hi' }],
        temperature: 0,
        numCtx: 1024,
      };
      await expect(collect(provider.chat(request))).rejects.toMatchObject({ kind: 'timeout' });
    }
  });
});

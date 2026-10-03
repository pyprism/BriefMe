import type { ProviderType, Secrets, Settings } from '../settings-schema';
import { FallbackProvider } from './fallback';
import { OllamaProvider } from './ollama';
import { OpenAICompatProvider } from './openai';
import type { HttpOptions } from './http';
import type { LLMProvider } from './types';

/** Timeouts from the settings, in the milliseconds the HTTP layer uses. */
export function httpOptionsFrom(
  settings: Pick<Settings, 'firstResponseTimeoutSec' | 'idleTimeoutSec'>,
): HttpOptions {
  return {
    firstByteTimeoutMs: settings.firstResponseTimeoutSec * 1000,
    idleTimeoutMs: settings.idleTimeoutSec * 1000,
  };
}

/** Build one provider. `secret` is the bearer token / API key, if any. */
export function buildProvider(
  type: ProviderType,
  baseUrl: string,
  secret?: string,
  http: HttpOptions = {},
): LLMProvider {
  return type === 'ollama'
    ? new OllamaProvider({ baseUrl, authToken: secret || undefined, ...http })
    : new OpenAICompatProvider({
        baseUrl,
        apiKey: secret || undefined,
        appName: 'BriefMe',
        ...http,
      });
}

export function createPrimary(settings: Settings, secrets: Secrets): LLMProvider {
  return buildProvider(
    settings.primaryType,
    settings.baseUrl,
    secrets.authToken,
    httpOptionsFrom(settings),
  );
}

export function createFallback(settings: Settings, secrets: Secrets): LLMProvider {
  return buildProvider(
    settings.fallbackType,
    settings.fallbackBaseUrl,
    secrets.fallbackApiKey,
    httpOptionsFrom(settings),
  );
}

/** Primary provider, wrapped with the fallback when enabled and fully configured. */
export function createProvider(settings: Settings, secrets: Secrets): LLMProvider {
  const primary = createPrimary(settings, secrets);
  if (settings.fallbackEnabled && settings.fallbackModel && settings.fallbackBaseUrl) {
    return new FallbackProvider(primary, createFallback(settings, secrets), settings.fallbackModel);
  }
  return primary;
}

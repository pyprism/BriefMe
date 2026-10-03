import type { ProviderType } from './settings-schema';

/** One-click starting points for the server type and URL. None is the default. */
export interface ProviderPreset {
  id: string;
  name: string;
  type: ProviderType;
  url: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'ollama', name: 'Ollama', type: 'ollama', url: 'http://localhost:11434' },
  { id: 'lmstudio', name: 'LM Studio', type: 'openai', url: 'http://localhost:1234/v1' },
  { id: 'llamacpp', name: 'llama.cpp', type: 'openai', url: 'http://localhost:8080/v1' },
  { id: 'openrouter', name: 'OpenRouter', type: 'openai', url: 'https://openrouter.ai/api/v1' },
  { id: 'openai', name: 'OpenAI', type: 'openai', url: 'https://api.openai.com/v1' },
];

/** Preset that matches the given type and URL, if any. */
export function matchPreset(type: string, url: string): ProviderPreset | undefined {
  const clean = url.trim().replace(/\/+$/, '');
  return PROVIDER_PRESETS.find((p) => p.type === type && p.url === clean);
}

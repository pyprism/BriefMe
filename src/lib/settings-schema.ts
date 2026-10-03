import { normalizeBaseUrl, parseList } from './url';

export type BuiltinStyle = 'tldr' | 'bullets' | 'detailed' | 'facts' | 'eli5' | 'entities' | 'bias';
export type StyleId = BuiltinStyle | `custom:${string}`;
export type Theme = 'auto' | 'light' | 'dark';
export type Position = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
export type UiMode = 'overlay' | 'sidepanel';
/**
 * API style. `ollama` = Ollama's own API. `openai` = any OpenAI-compatible server
 * (LM Studio, llama.cpp, vLLM, OpenRouter, OpenAI, ...). No provider is assumed.
 */
export type ProviderType = 'ollama' | 'openai';

export const PROVIDER_TYPES: ProviderType[] = ['ollama', 'openai'];

export interface CustomPrompt {
  id: string;
  name: string;
  system: string;
  template: string;
}

export interface Settings {
  primaryType: ProviderType;
  baseUrl: string;
  model: string;
  /** Used instead of `model` when the text is shorter than `fastBelowChars`. */
  fastModel: string;
  fastBelowChars: number;
  style: StyleId;
  /** "auto" = same language as the article. */
  language: string;
  temperature: number;
  numCtx: number;
  keepAlive: string;
  systemPrompt: string;
  promptTemplate: string;
  maxInputChars: number;
  /** Seconds to wait for the first reply (model load and prompt reading). */
  firstResponseTimeoutSec: number;
  /** Seconds of silence allowed once the answer is streaming. */
  idleTimeoutSec: number;
  theme: Theme;
  position: Position;
  uiMode: UiMode;
  denyList: string[];
  allowList: string[];
  autoSummarize: boolean;
  autoSites: string[];
  /** One "host=model" per line. */
  siteModels: string;
  customPrompts: CustomPrompt[];
  fallbackEnabled: boolean;
  fallbackType: ProviderType;
  fallbackBaseUrl: string;
  fallbackModel: string;
  obsidianVault: string;
  onboarded: boolean;
}

/** Stored in storage.local only; never synced. */
export interface Secrets {
  authToken: string;
  fallbackApiKey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  primaryType: 'openai',
  baseUrl: '',
  model: '',
  fastModel: '',
  fastBelowChars: 6000,
  style: 'bullets',
  language: 'auto',
  temperature: 0.3,
  numCtx: 8192,
  keepAlive: '',
  systemPrompt: '',
  promptTemplate: '',
  maxInputChars: 80000,
  firstResponseTimeoutSec: 600,
  idleTimeoutSec: 180,
  theme: 'auto',
  position: 'top-right',
  uiMode: 'overlay',
  denyList: [],
  allowList: [],
  autoSummarize: false,
  autoSites: [],
  siteModels: '',
  customPrompts: [],
  fallbackEnabled: false,
  fallbackType: 'openai',
  fallbackBaseUrl: '',
  fallbackModel: '',
  obsidianVault: '',
  onboarded: false,
};

export const DEFAULT_SECRETS: Secrets = { authToken: '', fallbackApiKey: '' };

export const BUILTIN_STYLES: BuiltinStyle[] = [
  'tldr',
  'bullets',
  'detailed',
  'facts',
  'eli5',
  'entities',
  'bias',
];

export type SettingsErrors = Partial<Record<keyof Settings, string>>;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const num = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : fallback;

const strList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean)
    : typeof value === 'string'
      ? parseList(value)
      : [];

export function isCustomStyle(style: string): style is `custom:${string}` {
  return style.startsWith('custom:');
}

/** Merge partial input with defaults, clamp ranges, and report field errors. */
export function validateSettings(input: Partial<Settings>): {
  settings: Settings;
  errors: SettingsErrors;
} {
  const d = DEFAULT_SETTINGS;
  const errors: SettingsErrors = {};

  const rawUrl = str(input.baseUrl, d.baseUrl);
  const baseUrl = rawUrl ? normalizeBaseUrl(rawUrl) : null;
  if (!baseUrl) errors.baseUrl = rawUrl ? 'invalid-url' : 'required';

  // The backup URL only has to be valid when the backup is switched on.
  const rawFallbackUrl = str(input.fallbackBaseUrl, d.fallbackBaseUrl);
  const fallbackBaseUrl = rawFallbackUrl ? normalizeBaseUrl(rawFallbackUrl) : null;
  if (input.fallbackEnabled === true && !fallbackBaseUrl) {
    errors.fallbackBaseUrl = rawFallbackUrl ? 'invalid-url' : 'required';
  }

  const customPrompts = (Array.isArray(input.customPrompts) ? input.customPrompts : [])
    .filter((p): p is CustomPrompt => !!p && typeof p === 'object' && typeof p.id === 'string')
    .map((p) => ({
      id: p.id.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'prompt',
      name: str(p.name, 'Prompt').slice(0, 60),
      system: typeof p.system === 'string' ? p.system : '',
      template: typeof p.template === 'string' ? p.template : '',
    }));

  const style = typeof input.style === 'string' ? input.style : d.style;
  const styleOk =
    BUILTIN_STYLES.includes(style as BuiltinStyle) ||
    (isCustomStyle(style) && customPrompts.some((p) => `custom:${p.id}` === style));

  const settings: Settings = {
    primaryType: oneOf(input.primaryType, PROVIDER_TYPES, d.primaryType),
    baseUrl: baseUrl ?? '',
    model: str(input.model),
    fastModel: str(input.fastModel),
    fastBelowChars: num(input.fastBelowChars, 0, 200000, d.fastBelowChars),
    style: styleOk ? (style as StyleId) : d.style,
    language: str(input.language, d.language) || 'auto',
    temperature: num(input.temperature, 0, 2, d.temperature),
    numCtx: Math.round(num(input.numCtx, 1024, 1_000_000, d.numCtx)),
    keepAlive: str(input.keepAlive),
    systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt : '',
    promptTemplate: typeof input.promptTemplate === 'string' ? input.promptTemplate : '',
    maxInputChars: Math.round(num(input.maxInputChars, 2000, 2_000_000, d.maxInputChars)),
    firstResponseTimeoutSec: Math.round(
      num(input.firstResponseTimeoutSec, 10, 7200, d.firstResponseTimeoutSec),
    ),
    idleTimeoutSec: Math.round(num(input.idleTimeoutSec, 10, 3600, d.idleTimeoutSec)),
    theme: oneOf(input.theme, ['auto', 'light', 'dark'], d.theme),
    position: oneOf(
      input.position,
      ['top-right', 'top-left', 'bottom-right', 'bottom-left'],
      d.position,
    ),
    uiMode: oneOf(input.uiMode, ['overlay', 'sidepanel'], d.uiMode),
    denyList: strList(input.denyList),
    allowList: strList(input.allowList),
    autoSummarize: input.autoSummarize === true,
    autoSites: strList(input.autoSites),
    siteModels: typeof input.siteModels === 'string' ? input.siteModels : '',
    customPrompts,
    fallbackEnabled: input.fallbackEnabled === true,
    fallbackType: oneOf(input.fallbackType, PROVIDER_TYPES, d.fallbackType),
    fallbackBaseUrl: fallbackBaseUrl ?? '',
    fallbackModel: str(input.fallbackModel),
    obsidianVault: str(input.obsidianVault),
    onboarded: input.onboarded === true,
  };

  if (settings.fallbackEnabled && !settings.fallbackModel) errors.fallbackModel = 'required';
  return { settings, errors };
}

/** Parse "host=model" lines. */
export function parseSiteModels(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i < 1) continue;
    const host = line.slice(0, i).trim().toLowerCase();
    const model = line.slice(i + 1).trim();
    if (host && model) map.set(host, model);
  }
  return map;
}

/** Pick the model for a page: site override, then fast model for short text, then default. */
export function pickModel(settings: Settings, host: string | null, textLength: number): string {
  if (host) {
    const overrides = parseSiteModels(settings.siteModels);
    for (const [pattern, model] of overrides) {
      if (host === pattern || host.endsWith(`.${pattern}`)) return model;
    }
  }
  if (settings.fastModel && textLength < settings.fastBelowChars) return settings.fastModel;
  return settings.model;
}

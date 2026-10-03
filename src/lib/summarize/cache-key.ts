import type { Settings, StyleId } from '../settings-schema';
import { isCustomStyle } from '../settings-schema';
import { DEFAULT_SYSTEM, DEFAULT_TEMPLATE, STYLE_INSTRUCTIONS, findCustomPrompt } from './prompts';

export interface CacheKeyInput {
  article: { url: string; text: string };
  settings: Pick<
    Settings,
    | 'primaryType'
    | 'baseUrl'
    | 'systemPrompt'
    | 'promptTemplate'
    | 'customPrompts'
    | 'maxInputChars'
    | 'numCtx'
    | 'temperature'
    | 'fallbackEnabled'
    | 'fallbackType'
    | 'fallbackBaseUrl'
    | 'fallbackModel'
  >;
  model: string;
  style: StyleId;
  language: string;
}

/**
 * Everything that can change the generated summary. A cached summary is reused only when all
 * of these match, so editing a prompt or switching provider never returns an older result.
 */
export function cacheKeyParts(input: CacheKeyInput): string[] {
  const { article, settings, model, style, language } = input;
  const custom = findCustomPrompt(style, settings.customPrompts);
  const instruction = isCustomStyle(style) ? '' : STYLE_INSTRUCTIONS[style];
  return [
    'v3',
    article.url,
    article.text,
    settings.primaryType,
    settings.baseUrl,
    model,
    style,
    language,
    instruction,
    DEFAULT_SYSTEM,
    DEFAULT_TEMPLATE,
    settings.systemPrompt,
    settings.promptTemplate,
    custom?.system ?? '',
    custom?.template ?? '',
    String(settings.maxInputChars),
    String(settings.numCtx),
    String(settings.temperature),
    // A summary may have been written by the backup, so its setup is part of the identity.
    settings.fallbackEnabled ? 'backup-on' : 'backup-off',
    settings.fallbackEnabled ? settings.fallbackType : '',
    settings.fallbackEnabled ? settings.fallbackBaseUrl : '',
    settings.fallbackEnabled ? settings.fallbackModel : '',
  ];
}

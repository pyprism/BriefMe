import type { Article } from '../extract/types';
import { LLMError } from '../errors';
import {
  collect,
  type ChatMessage,
  type LLMProvider,
  type ProviderNotice,
} from '../providers/types';
import { isCustomStyle, type Settings, type StyleId } from '../settings-schema';
import { chunkBudget, chunkText } from './chunker';
import {
  buildChunkMessages,
  buildSummaryMessages,
  entitiesToMarkdown,
  isJsonStyle,
} from './prompts';

export type SummaryEvent =
  | { type: 'status'; phase: 'connecting' | 'chunk' | 'writing'; index?: number; total?: number }
  | { type: 'token'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'notice'; notice: ProviderNotice }
  | { type: 'truncated'; kept: number; total: number };

export interface RunInput {
  provider: LLMProvider;
  article: Article;
  settings: Settings;
  style: StyleId;
  language: string;
  model: string;
  signal?: AbortSignal;
  entityLabels?: Record<string, string>;
}

const MAX_REDUCE_ROUNDS = 3;

/**
 * Summarize an article. Long text is condensed in chunks first (map-reduce), then the
 * final pass streams in the requested style.
 */
export async function* runSummary(input: RunInput): AsyncGenerator<SummaryEvent> {
  const { provider, article, settings, style, language, model, signal } = input;
  if (!model) throw new LLMError('config', 'No model selected');

  const notices: ProviderNotice[] = [];
  const base = {
    model,
    temperature: settings.temperature,
    numCtx: settings.numCtx,
    keepAlive: settings.keepAlive || undefined,
    signal,
    onNotice: (n: ProviderNotice) => notices.push(n),
  };
  const drain = function* (): Generator<SummaryEvent> {
    while (notices.length) yield { type: 'notice', notice: notices.shift() as ProviderNotice };
  };

  let text = article.text;
  if (text.length > settings.maxInputChars) {
    yield { type: 'truncated', kept: settings.maxInputChars, total: text.length };
    text = text.slice(0, settings.maxInputChars);
  }

  const budget = chunkBudget(settings.numCtx);
  let fromNotes = false;
  for (let round = 0; text.length > budget && round < MAX_REDUCE_ROUNDS; round++) {
    const chunks = chunkText(text, budget);
    const notes: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      yield { type: 'status', phase: 'chunk', index: i + 1, total: chunks.length };
      const messages = buildChunkMessages(article, chunks[i] ?? '', i, chunks.length);
      notes.push(await collect(provider.chat({ ...base, messages })));
      yield* drain();
    }
    text = notes.join('\n\n');
    fromNotes = true;
  }
  if (text.length > budget) text = text.slice(0, budget);

  yield { type: 'status', phase: 'writing' };
  const messages: ChatMessage[] = buildSummaryMessages({
    article: { ...article, text },
    style,
    settings,
    language,
    fromNotes,
  });

  if (isJsonStyle(style) && !isCustomStyle(style)) {
    const raw = await collect(provider.chat({ ...base, messages, json: true }));
    yield* drain();
    yield { type: 'replace', text: entitiesToMarkdown(raw, input.entityLabels ?? {}) ?? raw };
    return;
  }
  for await (const token of provider.chat({ ...base, messages })) {
    yield* drain();
    yield { type: 'token', text: token };
  }
  yield* drain();
}

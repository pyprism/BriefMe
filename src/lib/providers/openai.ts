import { SseParser } from '../ndjson';
import { LLMError } from '../errors';
import {
  errorFromResponse,
  DEFAULT_LIST_MS,
  fetchWithRetry,
  linkedController,
  readTextStream,
  type HttpOptions,
} from './http';
import type { ChatRequest, LLMProvider, ModelInfo } from './types';

export interface OpenAICompatConfig extends HttpOptions {
  /** e.g. https://openrouter.ai/api/v1 */
  baseUrl: string;
  apiKey?: string;
  /** Sent as X-Title for OpenRouter attribution. */
  appName?: string;
}

interface SseChunk {
  choices?: { delta?: { content?: string | null } }[];
  error?: { message?: string; code?: number | string };
}

/** Provider for OpenAI-compatible APIs (OpenRouter, LM Studio, llama.cpp server, ...). */
export class OpenAICompatProvider implements LLMProvider {
  readonly id = 'openai-compat';

  constructor(private readonly cfg: OpenAICompatConfig) {}

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    if (this.cfg.appName) headers['X-Title'] = this.cfg.appName;
    return headers;
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await fetchWithRetry(
      `${this.cfg.baseUrl}/models`,
      { headers: this.headers(), signal },
      this.cfg,
      this.id,
      this.cfg.listTimeoutMs ?? DEFAULT_LIST_MS,
    );
    if (!res.ok) throw await errorFromResponse(res, this.id);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => ({ id: m.id }));
  }

  async *chat(req: ChatRequest): AsyncGenerator<string> {
    const controller = linkedController(req.signal);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      temperature: req.temperature,
    };
    // `req.json` is not sent as response_format: servers differ (LM Studio rejects json_object).
    // The prompt asks for JSON and the parser tolerates surrounding text.

    const res = await fetchWithRetry(
      `${this.cfg.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(body),
        signal: controller.signal,
      },
      this.cfg,
      this.id,
    );
    if (!res.ok) throw await errorFromResponse(res, this.id);

    const parser = new SseParser();
    const handle = function* (events: string[]): Generator<string> {
      for (const data of events) {
        if (data.trim() === '[DONE]') return;
        let chunk: SseChunk;
        try {
          chunk = JSON.parse(data) as SseChunk;
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new LLMError(
            'server',
            chunk.error.message ?? 'Provider error',
            undefined,
            'openai-compat',
          );
        }
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    };
    for await (const text of readTextStream(res, controller, req.signal, this.cfg, this.id)) {
      yield* handle(parser.push(text));
    }
    yield* handle(parser.flush());
  }
}

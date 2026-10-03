import { NdjsonParser } from '../ndjson';
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

export interface OllamaConfig extends HttpOptions {
  baseUrl: string;
  authToken?: string;
}

interface OllamaLine {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';

  constructor(private readonly cfg: OllamaConfig) {}

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
    if (this.cfg.authToken) headers.Authorization = `Bearer ${this.cfg.authToken}`;
    return headers;
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await fetchWithRetry(
      `${this.cfg.baseUrl}/api/tags`,
      { headers: this.headers(), signal },
      this.cfg,
      this.id,
      this.cfg.listTimeoutMs ?? DEFAULT_LIST_MS,
    );
    if (!res.ok) throw await errorFromResponse(res, this.id);
    const body = (await res.json()) as { models?: { name: string; size?: number }[] };
    return (body.models ?? []).map((m) => ({ id: m.name, size: m.size }));
  }

  async *chat(req: ChatRequest): AsyncGenerator<string> {
    const controller = linkedController(req.signal);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      options: { temperature: req.temperature, num_ctx: req.numCtx },
    };
    if (req.keepAlive) body.keep_alive = req.keepAlive;
    if (req.json) body.format = 'json';

    const res = await fetchWithRetry(
      `${this.cfg.baseUrl}/api/chat`,
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

    const parser = new NdjsonParser();
    const handle = function* (lines: unknown[]): Generator<string> {
      for (const line of lines as OllamaLine[]) {
        if (line.error) throw new LLMError('server', line.error, undefined, 'ollama');
        if (line.message?.content) yield line.message.content;
      }
    };
    for await (const chunk of readTextStream(res, controller, req.signal, this.cfg, this.id)) {
      yield* handle(parser.push(chunk));
    }
    yield* handle(parser.flush());
  }
}

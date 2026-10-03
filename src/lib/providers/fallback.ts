import { isFallbackWorthy, toErrorInfo } from '../errors';
import { isAbort } from './http';
import type { ChatRequest, LLMProvider, ModelInfo } from './types';

/**
 * Uses `primary`; when it fails before producing any output with a fallback-worthy error,
 * retries the same request on `fallback`. Failures after output started are not retried,
 * because the user would see mixed output.
 */
export class FallbackProvider implements LLMProvider {
  readonly id: string;

  constructor(
    private readonly primary: LLMProvider,
    private readonly fallback: LLMProvider,
    private readonly fallbackModel: string,
  ) {
    this.id = `${primary.id}+${fallback.id}`;
  }

  listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    return this.primary.listModels(signal);
  }

  async *chat(req: ChatRequest): AsyncGenerator<string> {
    let emitted = false;
    try {
      for await (const part of this.primary.chat(req)) {
        emitted = true;
        yield part;
      }
      return;
    } catch (error) {
      if (emitted || isAbort(error) || req.signal?.aborted) throw error;
      const info = toErrorInfo(error);
      if (!isFallbackWorthy(info.kind)) throw error;
      req.onNotice?.({ kind: 'fallback', reason: info.kind, message: info.message });
    }
    yield* this.fallback.chat({ ...req, model: this.fallbackModel });
  }
}

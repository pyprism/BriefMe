import type { LLMErrorKind } from '../errors';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderNotice {
  kind: 'fallback';
  reason: LLMErrorKind;
  message: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  numCtx: number;
  keepAlive?: string;
  /** Ask for JSON output. */
  json?: boolean;
  signal?: AbortSignal;
  onNotice?: (notice: ProviderNotice) => void;
}

export interface ModelInfo {
  id: string;
  size?: number;
}

/** All LLM access goes through this interface. */
export interface LLMProvider {
  readonly id: string;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** Streams content deltas. Throws LLMError. */
  chat(request: ChatRequest): AsyncGenerator<string>;
}

export async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}

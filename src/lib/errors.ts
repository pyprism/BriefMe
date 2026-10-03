export type LLMErrorKind =
  | 'unreachable'
  | 'forbidden'
  | 'unauthorized'
  | 'model-missing'
  | 'rate-limit'
  | 'server'
  | 'timeout'
  | 'aborted'
  | 'permission'
  | 'config'
  | 'no-content'
  | 'blocked';

export interface ErrorInfo {
  kind: LLMErrorKind;
  message: string;
  status?: number;
  provider?: string;
}

export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    message: string,
    readonly status?: number,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'LLMError';
  }

  toInfo(): ErrorInfo {
    return { kind: this.kind, message: this.message, status: this.status, provider: this.provider };
  }
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof LLMError) return error.toInfo();
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { kind: 'aborted', message: 'Aborted' };
  }
  return { kind: 'server', message: error instanceof Error ? error.message : String(error) };
}

/** Errors worth retrying on the fallback provider. */
export function isFallbackWorthy(kind: LLMErrorKind): boolean {
  return (
    kind === 'unreachable' ||
    kind === 'forbidden' ||
    kind === 'model-missing' ||
    kind === 'rate-limit' ||
    kind === 'server' ||
    kind === 'timeout'
  );
}

export function statusToKind(status: number): LLMErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'model-missing';
  if (status === 429) return 'rate-limit';
  return 'server';
}

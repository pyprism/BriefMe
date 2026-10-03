import { LLMError, statusToKind } from '../errors';

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  /** Delays between connection retries. Default: 500ms, 1500ms. */
  retryDelaysMs?: number[];
  /** Max wait for the response headers and the first byte (model loading can be slow). */
  firstByteTimeoutMs?: number;
  /** Max wait for a model list response. */
  listTimeoutMs?: number;
  /** Max silence between chunks once streaming. */
  idleTimeoutMs?: number;
}

export const DEFAULT_FIRST_BYTE_MS = 600_000;
export const DEFAULT_IDLE_MS = 180_000;
export const DEFAULT_LIST_MS = 30_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * fetch with a deadline for the response headers, and retry on network failure (not on HTTP
 * errors). A server that accepts the connection but never answers ends in a timeout error.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: HttpOptions,
  provider: string,
  timeoutMs: number = opts.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_MS,
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const delays = opts.retryDelaysMs ?? [500, 1500];
  const caller = init.signal ?? undefined;
  for (let attempt = 0; ; attempt++) {
    const attemptController = linkedController(caller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, timeoutMs);
    try {
      return await doFetch(url, { ...init, signal: attemptController.signal });
    } catch (error) {
      if (timedOut)
        throw new LLMError('timeout', 'No response from the server', undefined, provider);
      if (isAbort(error) || caller?.aborted) throw error;
      if (attempt >= delays.length) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new LLMError(
          'unreachable',
          `Cannot reach ${new URL(url).origin} (${cause})`,
          undefined,
          provider,
        );
      }
      await sleep(delays[attempt] ?? 500, caller);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function errorFromResponse(res: Response, provider: string): Promise<LLMError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: string | { message?: string } };
      detail =
        typeof body.error === 'string' ? body.error : (body.error?.message ?? text.slice(0, 300));
    } catch {
      detail = text.slice(0, 300);
    }
  } catch {
    // ignore body read failure
  }
  return new LLMError(
    statusToKind(res.status),
    detail || `HTTP ${res.status}`,
    res.status,
    provider,
  );
}

/**
 * Reads a response body as text chunks with timeouts. `signal` is the caller signal;
 * `controller` is the request's own controller, aborted on timeout.
 */
export async function* readTextStream(
  res: Response,
  controller: AbortController,
  caller: AbortSignal | undefined,
  opts: HttpOptions,
  provider: string,
): AsyncGenerator<string> {
  if (!res.body) throw new LLMError('server', 'Empty response body', res.status, provider);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  const arm = () => {
    clearTimeout(timer);
    const ms = first
      ? (opts.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_MS)
      : (opts.idleTimeoutMs ?? DEFAULT_IDLE_MS);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };
  try {
    arm();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      first = false;
      arm();
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } catch (error) {
    if (timedOut) throw new LLMError('timeout', 'No response from the model', undefined, provider);
    if (caller?.aborted || isAbort(error)) throw new DOMException('Aborted', 'AbortError');
    throw error;
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
}

/** Links a caller signal to an internal controller. */
export function linkedController(signal?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller;
}

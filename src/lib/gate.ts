/**
 * FIFO limiter for model requests. Small servers handle one request at a time and queue the
 * rest; waiting on the server would burn the request's timeouts. Waiting here instead means a
 * request's clock starts when its turn comes.
 */
export class Gate {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private limit = 1) {}

  setLimit(limit: number): void {
    this.limit = Math.max(1, Math.floor(limit));
    this.drain();
  }

  /** Requests running now plus requests waiting. */
  get size(): number {
    return this.active + this.waiters.length;
  }

  /**
   * Wait for a free slot. `onAhead` is called with the number of requests in front of this one,
   * first when it has to wait and again whenever that number drops. Returns a release function;
   * call it once when the request ends. Rejects with an AbortError if `signal` aborts first.
   */
  acquire(signal?: AbortSignal, onAhead?: (ahead: number) => void): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    if (this.active < this.limit && this.waiters.length === 0) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', waiter.abort);
          resolve(this.releaser());
        },
        abort: () => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          this.notify();
          reject(new DOMException('Aborted', 'AbortError'));
        },
        onAhead,
      };
      signal?.addEventListener('abort', waiter.abort, { once: true });
      this.waiters.push(waiter);
      this.notify();
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < this.limit && this.waiters.length > 0) {
      this.active++;
      (this.waiters.shift() as Waiter).resolve();
    }
    this.notify();
  }

  private notify(): void {
    this.waiters.forEach((w, i) => w.onAhead?.(this.active + i));
  }
}

interface Waiter {
  resolve: () => void;
  abort: () => void;
  onAhead?: (ahead: number) => void;
}

import { describe, expect, it } from 'vitest';
import { Gate } from '../../src/lib/gate';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Gate', () => {
  it('lets one request run and queues the rest in order', async () => {
    const gate = new Gate(1);
    const order: string[] = [];
    const run = async (name: string, ms: number) => {
      const release = await gate.acquire();
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${name}`);
      release();
    };
    await Promise.all([run('a', 20), run('b', 5), run('c', 1)]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('runs up to the limit at once', async () => {
    const gate = new Gate(2);
    let running = 0;
    let peak = 0;
    const run = async () => {
      const release = await gate.acquire();
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      release();
    };
    await Promise.all([run(), run(), run(), run(), run()]);
    expect(peak).toBe(2);
  });

  it('reports how many requests are ahead, and updates as they finish', async () => {
    const gate = new Gate(1);
    const first = await gate.acquire();
    const seenB: number[] = [];
    const seenC: number[] = [];
    const b = gate.acquire(undefined, (n) => seenB.push(n));
    const c = gate.acquire(undefined, (n) => seenC.push(n));
    await tick();
    expect(seenB.at(-1)).toBe(1);
    expect(seenC.at(-1)).toBe(2);
    first();
    const releaseB = await b;
    expect(seenC.at(-1)).toBe(1);
    releaseB();
    (await c)();
    expect(gate.size).toBe(0);
  });

  it('removes a request that is aborted while waiting, without leaking a slot', async () => {
    const gate = new Gate(1);
    const first = await gate.acquire();
    const controller = new AbortController();
    const waiting = gate.acquire(controller.signal);
    const behind = gate.acquire();
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(gate.size).toBe(2); // the running one and the one behind
    first();
    const release = await behind;
    release();
    expect(gate.size).toBe(0);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const gate = new Gate(1);
    const controller = new AbortController();
    controller.abort();
    await expect(gate.acquire(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(gate.size).toBe(0);
  });

  it('ignores a second release call', async () => {
    const gate = new Gate(1);
    const release = await gate.acquire();
    release();
    release();
    const a = await gate.acquire();
    let bGot = false;
    void gate.acquire().then(() => (bGot = true));
    await tick();
    expect(bGot).toBe(false);
    a();
  });

  it('applies a changed limit to waiting requests', async () => {
    const gate = new Gate(1);
    const first = await gate.acquire();
    let second = false;
    void gate.acquire().then(() => (second = true));
    await tick();
    expect(second).toBe(false);
    gate.setLimit(2);
    await tick();
    expect(second).toBe(true);
    first();
  });

  it('keeps first come first served when a slot frees up', async () => {
    const gate = new Gate(1);
    const first = await gate.acquire();
    const order: string[] = [];
    const b = gate.acquire().then((r) => (order.push('b'), r));
    const c = gate.acquire().then((r) => (order.push('c'), r));
    first();
    (await b)();
    (await c)();
    expect(order).toEqual(['b', 'c']);
  });
});

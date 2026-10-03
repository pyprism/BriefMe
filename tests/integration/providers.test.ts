import { afterEach, describe, expect, it } from 'vitest';
import { LLMError } from '../../src/lib/errors';
import { FallbackProvider } from '../../src/lib/providers/fallback';
import { OllamaProvider } from '../../src/lib/providers/ollama';
import { OpenAICompatProvider } from '../../src/lib/providers/openai';
import { collect, type ChatRequest } from '../../src/lib/providers/types';
import { sleep, startServer, writeOllamaStream, writeSse, type MockServer } from './mock-server';

const servers: MockServer[] = [];
const serve = async (...args: Parameters<typeof startServer>) => {
  const s = await startServer(...args);
  servers.push(s);
  return s;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: 'm1',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.3,
  numCtx: 4096,
  ...over,
});
const fast = { retryDelaysMs: [1, 1] };

async function expectKind(promise: Promise<unknown>, kind: string, status?: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LLMError);
  expect((error as LLMError).kind).toBe(kind);
  if (status) expect((error as LLMError).status).toBe(status);
  return error as LLMError;
}

describe('OllamaProvider', () => {
  it('streams tokens even when lines are split across packets', async () => {
    const server = await serve((_req, res) => writeOllamaStream(res, ['Hel', 'lo ', 'wor', 'ld']));
    const p = new OllamaProvider({ baseUrl: server.url, ...fast });
    expect(await collect(p.chat(req()))).toBe('Hello world');
  });

  it('sends model, messages, options and optional fields', async () => {
    const server = await serve((_req, res) => writeOllamaStream(res, ['x']));
    const p = new OllamaProvider({ baseUrl: server.url, authToken: 'tok', ...fast });
    await collect(p.chat(req({ keepAlive: '10m', json: true, numCtx: 2048, temperature: 0.1 })));
    const sent = server.requests[0];
    expect(sent?.url).toBe('/api/chat');
    expect(sent?.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(sent?.body ?? '')).toMatchObject({
      model: 'm1',
      stream: true,
      keep_alive: '10m',
      format: 'json',
      options: { temperature: 0.1, num_ctx: 2048 },
    });
  });

  it('lists models', async () => {
    const server = await serve((_req, res) => {
      res
        .writeHead(200)
        .end(
          JSON.stringify({ models: [{ name: 'llama3.2:3b', size: 5 }, { name: 'qwen2.5:7b' }] }),
        );
    });
    const models = await new OllamaProvider({ baseUrl: server.url, ...fast }).listModels();
    expect(models.map((m) => m.id)).toEqual(['llama3.2:3b', 'qwen2.5:7b']);
  });

  it.each([
    [403, 'forbidden'],
    [401, 'unauthorized'],
    [404, 'model-missing'],
    [429, 'rate-limit'],
    [500, 'server'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const server = await serve((_req, res) => {
      res.writeHead(status).end(JSON.stringify({ error: `model 'm1' not found` }));
    });
    const e = await expectKind(
      collect(new OllamaProvider({ baseUrl: server.url, ...fast }).chat(req())),
      kind,
      status,
    );
    expect(e.message).toContain("model 'm1' not found");
  });

  it('reports unreachable servers after retrying', async () => {
    const server = await serve(() => {});
    const url = server.url;
    await server.close();
    await expectKind(
      collect(new OllamaProvider({ baseUrl: url, ...fast }).chat(req())),
      'unreachable',
    );
  });

  it('retries a connection that fails once', async () => {
    let calls = 0;
    const real = await serve((_req, res) => writeOllamaStream(res, ['ok']));
    const flaky = (async (...args: Parameters<typeof fetch>) => {
      if (calls++ === 0) throw new TypeError('network down');
      return fetch(...args);
    }) as typeof fetch;
    const p = new OllamaProvider({ baseUrl: real.url, fetchImpl: flaky, ...fast });
    expect(await collect(p.chat(req()))).toBe('ok');
    expect(calls).toBe(2);
  });

  it('raises server errors sent inside the stream', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ error: 'out of memory' }) + '\n');
    });
    await expectKind(
      collect(new OllamaProvider({ baseUrl: server.url, ...fast }).chat(req())),
      'server',
    );
  });

  it('aborts mid-stream', async () => {
    const server = await serve(async (_req, res) => {
      res.writeHead(200);
      for (let i = 0; i < 50 && !res.destroyed; i++) {
        res.write(JSON.stringify({ message: { content: 't' } }) + '\n');
        await sleep(10);
      }
      res.end();
    });
    const controller = new AbortController();
    const got: string[] = [];
    const run = (async () => {
      for await (const t of new OllamaProvider({ baseUrl: server.url, ...fast }).chat(
        req({ signal: controller.signal }),
      )) {
        got.push(t);
        if (got.length === 3) controller.abort();
      }
    })();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(got.length).toBeLessThan(10);
  });

  it('times out when the stream goes silent', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200);
      res.write(JSON.stringify({ message: { content: 'a' } }) + '\n');
    });
    const p = new OllamaProvider({ baseUrl: server.url, idleTimeoutMs: 60, ...fast });
    await expectKind(collect(p.chat(req())), 'timeout');
  });

  it('times out when no first byte arrives', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200);
      res.flushHeaders();
    });
    const p = new OllamaProvider({ baseUrl: server.url, firstByteTimeoutMs: 60, ...fast });
    await expectKind(collect(p.chat(req())), 'timeout');
  });
});

describe('connection errors and requests', () => {
  it('names the browser error when a server cannot be reached', async () => {
    const dead = await serve(() => {});
    const url = dead.url;
    await dead.close();
    const e = await expectKind(
      new OllamaProvider({ baseUrl: url, ...fast }).listModels(),
      'unreachable',
    );
    expect(e.message).toContain(`Cannot reach ${url}`);
    expect(e.message).toMatch(/\(.+\)$/);
  });

  it('sends model-list requests without a body type header, so no preflight is needed', async () => {
    const server = await serve((_req, res) => res.writeHead(200).end('{"models":[],"data":[]}'));
    await new OllamaProvider({ baseUrl: server.url, ...fast }).listModels();
    await new OpenAICompatProvider({ baseUrl: server.url, ...fast }).listModels();
    for (const r of server.requests) expect(r.headers['content-type']).toBeUndefined();
  });

  it('still sends JSON content type on chat requests', async () => {
    const server = await serve((_req, res) => writeOllamaStream(res, ['x']));
    await collect(new OllamaProvider({ baseUrl: server.url, ...fast }).chat(req()));
    expect(server.requests[0]?.headers['content-type']).toBe('application/json');
  });
});

describe('request deadlines', () => {
  /** A fetch that never answers until it is aborted, like a server that holds the connection. */
  const hanging = ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    })) as typeof fetch;

  it('times out a chat request that never gets response headers (Ollama)', async () => {
    const p = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:9',
      fetchImpl: hanging,
      firstByteTimeoutMs: 40,
      ...fast,
    });
    const started = Date.now();
    await expectKind(collect(p.chat(req())), 'timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('times out a chat request that never gets response headers (OpenAI-compatible)', async () => {
    const p = new OpenAICompatProvider({
      baseUrl: 'http://127.0.0.1:9/v1',
      fetchImpl: hanging,
      firstByteTimeoutMs: 40,
      ...fast,
    });
    await expectKind(collect(p.chat(req())), 'timeout');
  });

  it('times out model listing with its own deadline', async () => {
    const ollama = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:9',
      fetchImpl: hanging,
      listTimeoutMs: 40,
      firstByteTimeoutMs: 60_000,
      ...fast,
    });
    await expectKind(ollama.listModels(), 'timeout');
    const openai = new OpenAICompatProvider({
      baseUrl: 'http://127.0.0.1:9/v1',
      fetchImpl: hanging,
      listTimeoutMs: 40,
      ...fast,
    });
    await expectKind(openai.listModels(), 'timeout');
  });

  it('does not retry after a timeout and still honors a caller abort', async () => {
    let calls = 0;
    const counting = ((url: unknown, init?: RequestInit) => {
      calls++;
      return hanging(url as string, init);
    }) as typeof fetch;
    const p = new OllamaProvider({
      baseUrl: 'http://x',
      fetchImpl: counting,
      firstByteTimeoutMs: 30,
      ...fast,
    });
    await expectKind(collect(p.chat(req())), 'timeout');
    expect(calls).toBe(1);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const q = new OllamaProvider({
      baseUrl: 'http://x',
      fetchImpl: hanging,
      firstByteTimeoutMs: 5000,
      ...fast,
    });
    await expect(collect(q.chat(req({ signal: controller.signal })))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('lets a fallback take over when the primary never answers', async () => {
    const fallback = await serve((_req, res) => writeSse(res, ['rescued']));
    const provider = new FallbackProvider(
      new OllamaProvider({
        baseUrl: 'http://x',
        fetchImpl: hanging,
        firstByteTimeoutMs: 30,
        ...fast,
      }),
      new OpenAICompatProvider({ baseUrl: fallback.url, ...fast }),
      'm',
    );
    const reasons: string[] = [];
    expect(await collect(provider.chat(req({ onNotice: (n) => reasons.push(n.reason) })))).toBe(
      'rescued',
    );
    expect(reasons).toEqual(['timeout']);
  });
});

describe('OpenAICompatProvider', () => {
  it('streams SSE deltas and ignores comments and [DONE]', async () => {
    const server = await serve((_req, res) => writeSse(res, ['Al', 'pha']));
    const p = new OpenAICompatProvider({
      baseUrl: `${server.url}/api/v1`,
      apiKey: 'k',
      appName: 'BriefMe',
      ...fast,
    });
    expect(await collect(p.chat(req({ json: true })))).toBe('Alpha');
    const sent = server.requests[0];
    expect(sent?.url).toBe('/api/v1/chat/completions');
    expect(sent?.headers.authorization).toBe('Bearer k');
    expect(sent?.headers['x-title']).toBe('BriefMe');
    expect(JSON.parse(sent?.body ?? '')).toMatchObject({ stream: true, temperature: 0.3 });
    expect(sent?.body).not.toContain('response_format');
  });

  it('lists models', async () => {
    const server = await serve((_req, res) =>
      res.writeHead(200).end(JSON.stringify({ data: [{ id: 'a/b' }] })),
    );
    const models = await new OpenAICompatProvider({ baseUrl: server.url, ...fast }).listModels();
    expect(models).toEqual([{ id: 'a/b' }]);
  });

  it('maps auth failures and in-stream errors', async () => {
    const bad = await serve((_req, res) =>
      res.writeHead(401).end(JSON.stringify({ error: { message: 'No auth' } })),
    );
    const e = await expectKind(
      collect(new OpenAICompatProvider({ baseUrl: bad.url, ...fast }).chat(req())),
      'unauthorized',
      401,
    );
    expect(e.message).toBe('No auth');

    const mid = await serve((_req, res) => {
      res.writeHead(200);
      res.end(`data: ${JSON.stringify({ error: { message: 'upstream died' } })}\n\n`);
    });
    await expectKind(
      collect(new OpenAICompatProvider({ baseUrl: mid.url, ...fast }).chat(req())),
      'server',
    );
  });
});

describe('FallbackProvider', () => {
  const setup = async (primaryHandler: Parameters<typeof startServer>[0]) => {
    const primary = await serve(primaryHandler);
    const fallback = await serve((_req, res) => writeSse(res, ['from ', 'fallback']));
    const provider = new FallbackProvider(
      new OllamaProvider({ baseUrl: primary.url, ...fast }),
      new OpenAICompatProvider({ baseUrl: fallback.url, ...fast }),
      'router/model',
    );
    return { provider, primary, fallback };
  };

  it('uses the primary when it works', async () => {
    const { provider, fallback } = await setup((_req, res) => writeOllamaStream(res, ['primary']));
    expect(await collect(provider.chat(req()))).toBe('primary');
    expect(fallback.requests).toHaveLength(0);
  });

  it.each([403, 404, 500])('falls back when the primary returns %i', async (status) => {
    const { provider, fallback } = await setup((_req, res) =>
      res.writeHead(status).end('{"error":"x"}'),
    );
    const notices: string[] = [];
    const models: string[] = [];
    const out = await collect(
      provider.chat(
        req({
          onNotice: (n) => {
            notices.push(n.reason);
            models.push(n.model);
          },
        }),
      ),
    );
    expect(models).toEqual(['router/model']);
    expect(out).toBe('from fallback');
    expect(notices).toHaveLength(1);
    expect(JSON.parse(fallback.requests[0]?.body ?? '').model).toBe('router/model');
    expect(notices).toHaveLength(1);
  });

  it('falls back when the primary is unreachable', async () => {
    const fallback = await serve((_req, res) => writeSse(res, ['ok']));
    const dead = await serve(() => {});
    const deadUrl = dead.url;
    await dead.close();
    const provider = new FallbackProvider(
      new OllamaProvider({ baseUrl: deadUrl, ...fast }),
      new OpenAICompatProvider({ baseUrl: fallback.url, ...fast }),
      'm',
    );
    const reasons: string[] = [];
    expect(await collect(provider.chat(req({ onNotice: (n) => reasons.push(n.reason) })))).toBe(
      'ok',
    );
    expect(reasons).toEqual(['unreachable']);
  });

  it('does not switch after output has started', async () => {
    const { provider, fallback } = await setup((_req, res) => {
      res.writeHead(200);
      res.write(JSON.stringify({ message: { content: 'partial' } }) + '\n');
      res.end(JSON.stringify({ error: 'crashed' }) + '\n');
    });
    const got: string[] = [];
    await expect(
      (async () => {
        for await (const t of provider.chat(req())) got.push(t);
      })(),
    ).rejects.toBeInstanceOf(LLMError);
    expect(got).toEqual(['partial']);
    expect(fallback.requests).toHaveLength(0);
  });

  it('does not switch when the user aborts', async () => {
    const { provider, fallback } = await setup(async (_req, res) => {
      res.writeHead(200);
      await sleep(200);
      res.end();
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await expect(collect(provider.chat(req({ signal: controller.signal })))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fallback.requests).toHaveLength(0);
  });

  it('surfaces the fallback error when both fail', async () => {
    const primary = await serve((_req, res) => res.writeHead(500).end('{"error":"p"}'));
    const fb = await serve((_req, res) =>
      res.writeHead(401).end('{"error":{"message":"bad key"}}'),
    );
    const provider = new FallbackProvider(
      new OllamaProvider({ baseUrl: primary.url, ...fast }),
      new OpenAICompatProvider({ baseUrl: fb.url, ...fast }),
      'm',
    );
    const e = await expectKind(collect(provider.chat(req())), 'unauthorized', 401);
    expect(e.provider).toBe('openai-compat');
  });
});

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => unknown;

export interface MockServer {
  url: string;
  requests: { method: string; url: string; body: string; headers: IncomingMessage['headers'] }[];
  close(): Promise<void>;
}

export async function startServer(handler: Handler): Promise<MockServer> {
  const requests: MockServer['requests'] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', body, headers: req.headers });
      void handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ollama-style NDJSON chat response. Writes each line in two parts to exercise buffering. */
export async function writeOllamaStream(res: ServerResponse, tokens: string[]): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  for (const token of tokens) {
    const line =
      JSON.stringify({ message: { role: 'assistant', content: token }, done: false }) + '\n';
    const mid = Math.floor(line.length / 2);
    res.write(line.slice(0, mid));
    await sleep(2);
    res.write(line.slice(mid));
  }
  res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
}

export function writeSse(res: ServerResponse, tokens: string[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(': OPENROUTER PROCESSING\n\n');
  for (const token of tokens) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
}

import { describe, expect, it } from 'vitest';
import type { Article } from '../../src/lib/extract/types';
import { LLMError } from '../../src/lib/errors';
import type { ChatRequest, LLMProvider } from '../../src/lib/providers/types';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/settings-schema';
import { runSummary, type SummaryEvent } from '../../src/lib/summarize/run';

class FakeProvider implements LLMProvider {
  readonly id = 'fake';
  requests: ChatRequest[] = [];
  constructor(private readonly reply: (req: ChatRequest, n: number) => string) {}
  async listModels() {
    return [];
  }
  async *chat(req: ChatRequest): AsyncGenerator<string> {
    this.requests.push(req);
    const text = this.reply(req, this.requests.length);
    for (const part of text.match(/.{1,5}/gs) ?? []) yield part;
  }
}

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  model: 'm',
  ...over,
});
const article = (len: number): Article => ({
  title: 'T',
  url: 'https://x.org/a',
  byline: '',
  siteName: 'X',
  lang: 'en',
  source: 'readability',
  text: Array.from({ length: Math.ceil(len / 100) }, (_, i) => `Paragraph ${i} ${'w '.repeat(45)}`)
    .join('\n\n')
    .slice(0, len),
});

async function run(
  provider: LLMProvider,
  a: Article,
  s: Settings,
  style: Settings['style'] = 'bullets',
) {
  const events: SummaryEvent[] = [];
  for await (const e of runSummary({
    provider,
    article: a,
    settings: s,
    style,
    language: 'auto',
    model: 'm',
  }))
    events.push(e);
  return events;
}
const text = (events: SummaryEvent[]) =>
  events.flatMap((e) => (e.type === 'token' ? [e.text] : [])).join('');

describe('runSummary', () => {
  it('summarizes short text in one pass', async () => {
    const p = new FakeProvider(() => '- point one\n- point two');
    const events = await run(p, article(1000), settings());
    expect(p.requests).toHaveLength(1);
    expect(text(events)).toBe('- point one\n- point two');
    expect(events[0]).toEqual({ type: 'status', phase: 'writing' });
    expect(p.requests[0]).toMatchObject({ model: 'm', numCtx: 8192, temperature: 0.3 });
  });

  it('condenses long text in chunks, then writes the final summary from notes', async () => {
    const p = new FakeProvider((_req, n) => (n <= 3 ? `notes ${n}` : 'FINAL'));
    const s = settings({ numCtx: 1024 }); // budget = 2000 chars
    const events = await run(p, article(5500), s);
    const chunks = events.filter((e) => e.type === 'status' && e.phase === 'chunk');
    expect(chunks.length).toBe(3);
    expect(chunks[2]).toMatchObject({ index: 3, total: 3 });
    expect(p.requests).toHaveLength(4);
    const last = p.requests[3]?.messages.at(-1)?.content ?? '';
    expect(last).toContain('notes 1\n\nnotes 2\n\nnotes 3');
    expect(last).toContain('notes taken from consecutive parts');
    expect(text(events)).toBe('FINAL');
  });

  it('reduces repeatedly when notes are still too long', async () => {
    const p = new FakeProvider((req) =>
      req.messages.at(-1)?.content.includes('part ') ? 'n'.repeat(1500) : 'FINAL',
    );
    const events = await run(p, article(9000), settings({ numCtx: 1024 }));
    expect(p.requests.length).toBeGreaterThan(5);
    expect(text(events)).toBe('FINAL');
    for (const r of p.requests) {
      expect(r.messages.at(-1)?.content.length ?? 0).toBeLessThan(4000);
    }
  });

  it('truncates beyond maxInputChars and says so', async () => {
    const p = new FakeProvider(() => 'ok');
    const events = await run(p, article(5000), settings({ maxInputChars: 2000, numCtx: 100000 }));
    expect(events.find((e) => e.type === 'truncated')).toEqual({
      type: 'truncated',
      kept: 2000,
      total: 5000,
    });
    expect(p.requests[0]?.messages.at(-1)?.content).not.toContain('Paragraph 40 ');
  });

  it('renders the entities style from JSON', async () => {
    const p = new FakeProvider(() =>
      JSON.stringify({ keyPoints: ['A'], people: [{ name: 'Ann', role: 'mayor' }] }),
    );
    const events = await run(p, article(800), settings(), 'entities');
    expect(p.requests[0]?.json).toBe(true);
    const replace = events.find((e) => e.type === 'replace');
    expect(replace).toMatchObject({ text: expect.stringContaining('- Ann - mayor') });
    expect(events.some((e) => e.type === 'token')).toBe(false);
  });

  it('requires a model', async () => {
    const p = new FakeProvider(() => '');
    const gen = runSummary({
      provider: p,
      article: article(500),
      settings: settings(),
      style: 'tldr',
      language: 'auto',
      model: '',
    });
    await expect(gen.next()).rejects.toBeInstanceOf(LLMError);
  });

  it('forwards provider notices as events', async () => {
    const p: LLMProvider = {
      id: 'n',
      listModels: async () => [],
      async *chat(req) {
        req.onNotice?.({ kind: 'fallback', reason: 'forbidden', message: 'x', model: 'b' });
        yield 'hi';
      },
    };
    const events = await run(p, article(500), settings());
    expect(events.map((e) => e.type)).toEqual(['status', 'notice', 'token']);
  });
});

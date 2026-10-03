import { describe, expect, it } from 'vitest';
import { NdjsonParser, SseParser } from '../../src/lib/ndjson';

describe('NdjsonParser', () => {
  it('parses complete lines', () => {
    const p = new NdjsonParser();
    expect(p.push('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('keeps partial lines across chunks', () => {
    const p = new NdjsonParser();
    expect(p.push('{"message":{"con')).toEqual([]);
    expect(p.push('tent":"hi"}}\n{"done"')).toEqual([{ message: { content: 'hi' } }]);
    expect(p.push(':true}')).toEqual([]);
    expect(p.flush()).toEqual([{ done: true }]);
  });

  it('ignores blank lines', () => {
    const p = new NdjsonParser();
    expect(p.push('\n\n{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it('throws on invalid JSON', () => {
    expect(() => new NdjsonParser().push('nope\n')).toThrow();
  });
});

describe('SseParser', () => {
  it('extracts data payloads and skips comments', () => {
    const p = new SseParser();
    expect(p.push(': PROCESSING\n\ndata: {"x":1}\n\ndata: [DONE]\n\n')).toEqual([
      '{"x":1}',
      '[DONE]',
    ]);
  });

  it('handles events split across chunks and CRLF', () => {
    const p = new SseParser();
    expect(p.push('data: {"x"')).toEqual([]);
    expect(p.push(':1}\r\n\r\ndata: b')).toEqual(['{"x":1}']);
    expect(p.flush()).toEqual(['b']);
  });
});

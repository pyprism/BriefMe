import { describe, expect, it } from 'vitest';
import { ThinkFilter } from '../../src/lib/providers/think-filter';

const run = (parts: string[]): string => {
  const f = new ThinkFilter();
  return parts.map((p) => f.push(p)).join('') + f.flush();
};

describe('ThinkFilter', () => {
  it('passes plain text through', () => {
    expect(run(['Hello ', 'world'])).toBe('Hello world');
  });

  it('removes a leading think block', () => {
    expect(run(['<think>plan it</think>\n\nAnswer'])).toBe('Answer');
  });

  it('handles tags split across chunks', () => {
    expect(run(['<thi', 'nk>reason', 'ing</thi', 'nk>', '\nDone'])).toBe('Done');
  });

  it('keeps text that merely starts with a "<"', () => {
    expect(run(['<b>bold</b> text'])).toBe('<b>bold</b> text');
    expect(run(['<th', 'ing> x'])).toBe('<thing> x');
  });

  it('does not touch a think tag later in the answer', () => {
    expect(run(['Answer <think>x</think> more'])).toBe('Answer <think>x</think> more');
  });

  it('drops a block that never closes', () => {
    expect(run(['<think>endless'])).toBe('');
  });

  it('releases a short held-back start on flush', () => {
    expect(run(['<th'])).toBe('<th');
  });
});

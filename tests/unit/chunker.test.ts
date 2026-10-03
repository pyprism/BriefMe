import { describe, expect, it } from 'vitest';
import {
  chunkBudget,
  chunkText,
  estimateTokens,
  readingMinutes,
  wordCount,
} from '../../src/lib/summarize/chunker';

describe('chunker', () => {
  it('returns one chunk when text fits', () => {
    expect(chunkText('short', 100)).toEqual(['short']);
  });

  it('splits on paragraph boundaries within the limit', () => {
    const text = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n\n');
    const chunks = chunkText(text, 90);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.length <= 90)).toBe(true);
    expect(chunks.join('\n\n')).toBe(text);
  });

  it('splits an oversized paragraph on sentences', () => {
    const sentence = 'This is a sentence of moderate length. ';
    const chunks = chunkText(sentence.repeat(10), 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });

  it('hard-splits text without any boundary', () => {
    const chunks = chunkText('x'.repeat(250), 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('never loses characters', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(20)}`).join(
      '\n\n',
    );
    const chunks = chunkText(text, 300);
    expect(chunks.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });

  it('computes budget and estimates', () => {
    expect(chunkBudget(8192)).toBe((8192 - 1500) * 3);
    expect(chunkBudget(1024)).toBe(2000);
    expect(estimateTokens('abcd')).toBe(1);
    expect(wordCount('one two  three')).toBe(3);
    expect(readingMinutes('word '.repeat(1150))).toBe(5);
    expect(readingMinutes('hi')).toBe(1);
  });
});

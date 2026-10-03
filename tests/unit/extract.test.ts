// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  elementToText,
  extractArticle,
  hasEnoughText,
  hasPasswordField,
} from '../../src/lib/extract/extract';

const load = (name: string, url = 'https://daily.example/news/eastwick'): Document => {
  const html = readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  Object.defineProperty(doc, 'URL', { value: url });
  return doc;
};

describe('extractArticle', () => {
  it('extracts the article and drops page chrome', () => {
    const article = extractArticle(load('article.html'));
    expect(article.source).toBe('readability');
    expect(article.title).toContain('Harbour town');
    expect(article.siteName).toBe('The Daily Example');
    expect(article.text).toContain('council of the small harbour town');
    expect(article.text).toContain('- Private cars are banned');
    expect(article.text).toContain('Delivery vans may enter');
    expect(article.text).not.toContain('cheap watches');
    expect(article.text).not.toContain('Copyright');
    expect(article.text).not.toContain('track');
    expect(hasEnoughText(article)).toBe(true);
  });

  it('separates paragraphs and does not duplicate nested blocks', () => {
    const article = extractArticle(load('article.html'));
    expect(article.text).toContain('\n\n');
    const quote = 'We are not closing the town';
    expect(article.text.split(quote)).toHaveLength(2);
  });

  it('prefers a selection', () => {
    const selection = 'x'.repeat(60);
    const article = extractArticle(load('article.html'), { selection });
    expect(article.source).toBe('selection');
    expect(article.text).toBe(selection);
  });

  it('ignores a tiny selection', () => {
    expect(extractArticle(load('article.html'), { selection: 'hi' }).source).toBe('readability');
  });

  it('reports not enough text for app shells', () => {
    const article = extractArticle(load('app-shell.html'));
    expect(hasEnoughText(article)).toBe(false);
  });
});

describe('helpers', () => {
  it('detects password fields', () => {
    const doc = new DOMParser().parseFromString(
      '<form><input type="password"></form>',
      'text/html',
    );
    expect(hasPasswordField(doc)).toBe(true);
    expect(hasPasswordField(load('article.html'))).toBe(false);
  });

  it('converts blocks to text with headings and bullets', () => {
    const doc = new DOMParser().parseFromString(
      '<div><h2>H</h2><p>P</p><ul><li>L</li></ul></div>',
      'text/html',
    );
    expect(elementToText(doc.body)).toBe('# H\n\nP\n\n- L');
  });
});

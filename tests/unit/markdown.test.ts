// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown';

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const html = renderMarkdown('# Title\n\n- a\n- b\n\n**bold**');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('strips scripts, handlers, images and iframes', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="//evil"></iframe><p onclick="x()">hi</p>',
    );
    expect(html).not.toMatch(/script|onerror|onclick|<img|iframe/i);
    expect(html).toContain('hi');
  });

  it('removes javascript: links', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('opens links safely', () => {
    const html = renderMarkdown('[x](https://example.org)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
});

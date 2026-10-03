import { Readability, isProbablyReaderable } from '@mozilla/readability';
import type { Article } from './types';

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption,td,th,dt,dd';
const NOISE =
  'script,style,noscript,template,nav,header,footer,aside,form,iframe,svg,canvas,button,select,[aria-hidden="true"],[hidden]';

const MIN_TEXT = 200;
const MIN_SELECTION = 50;

function clean(text: string): string {
  return text
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Turn an element tree into paragraph-separated plain text. */
export function elementToText(root: Element): string {
  const parts: string[] = [];
  for (const el of Array.from(root.querySelectorAll(BLOCKS))) {
    // Text of a nested block is already part of its outer block.
    const outer = el.parentElement?.closest(BLOCKS);
    if (outer && root.contains(outer)) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^H[1-6]$/.test(el.tagName)) parts.push(`# ${text}`);
    else if (el.tagName === 'LI') parts.push(`- ${text}`);
    else parts.push(text);
  }
  if (parts.length === 0) return clean(root.textContent ?? '');
  return clean(parts.join('\n\n'));
}

function parseHtml(doc: Document, html: string): Element {
  const parsed = doc.implementation.createHTMLDocument('');
  parsed.body.innerHTML = html;
  return parsed.body;
}

function fallbackText(doc: Document): string {
  const clone = doc.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NOISE).forEach((el) => el.remove());
  return elementToText(clone);
}

export interface ExtractOptions {
  /** Text the user has selected, if any. */
  selection?: string;
}

export function extractArticle(doc: Document, options: ExtractOptions = {}): Article {
  const url = doc.location?.href ?? doc.URL;
  const meta = (name: string) =>
    doc.querySelector<HTMLMetaElement>(`meta[property="${name}"],meta[name="${name}"]`)?.content ??
    '';
  const base = {
    url,
    lang: doc.documentElement.lang || '',
    siteName:
      meta('og:site_name') ||
      (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return '';
        }
      })(),
  };

  const selection = options.selection?.trim() ?? '';
  if (selection.length >= MIN_SELECTION) {
    return { ...base, title: doc.title, byline: '', text: clean(selection), source: 'selection' };
  }

  let parsed: ReturnType<Readability['parse']>;
  try {
    parsed = new Readability(doc.cloneNode(true) as Document, { charThreshold: MIN_TEXT }).parse();
  } catch {
    parsed = null;
  }
  if (parsed?.content) {
    const text = elementToText(parseHtml(doc, parsed.content));
    if (text.length >= MIN_TEXT) {
      return {
        ...base,
        title: parsed.title || doc.title,
        byline: parsed.byline ?? '',
        siteName: parsed.siteName || base.siteName,
        lang: parsed.lang || base.lang,
        text,
        source: 'readability',
      };
    }
  }
  return {
    ...base,
    title: doc.title,
    byline: '',
    text: fallbackText(doc),
    source: 'fallback',
  };
}

export const hasEnoughText = (article: Article): boolean =>
  article.text.length >= MIN_TEXT || article.source === 'selection';

export function looksReaderable(doc: Document): boolean {
  try {
    return isProbablyReaderable(doc);
  } catch {
    return false;
  }
}

export function hasPasswordField(doc: Document): boolean {
  return doc.querySelector('input[type="password"]') !== null;
}

/** Parse HTML fetched elsewhere (used for "summarize link"). */
export function parseHtmlDocument(html: string, url: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);
  Object.defineProperty(doc, 'URL', { value: url });
  return doc;
}

export function extractFromHtml(html: string, url: string): Article {
  return { ...extractArticle(parseHtmlDocument(html, url)), url };
}

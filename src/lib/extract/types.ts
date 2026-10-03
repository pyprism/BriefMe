export interface Article {
  title: string;
  url: string;
  byline: string;
  siteName: string;
  lang: string;
  text: string;
  source: 'readability' | 'fallback' | 'selection';
}

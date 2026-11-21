const OPEN = '<think>';
const CLOSE = '</think>';

/**
 * Removes a leading `<think>...</think>` block from a streamed answer. Some servers put the
 * model's reasoning inline in the content. Text is passed through as soon as it is clear the
 * answer does not start with the tag, so normal output is not delayed.
 */
export class ThinkFilter {
  private state: 'start' | 'inside' | 'pass' = 'start';
  private buf = '';
  private trimming = false;

  push(text: string): string {
    if (this.state === 'pass') {
      if (!this.trimming) return text;
      const rest = text.trimStart();
      if (rest) this.trimming = false;
      return rest;
    }
    this.buf += text;
    if (this.state === 'start') {
      const trimmed = this.buf.trimStart();
      if (trimmed.length < OPEN.length) {
        if (OPEN.startsWith(trimmed)) return '';
      } else if (trimmed.startsWith(OPEN)) {
        this.state = 'inside';
        this.buf = trimmed.slice(OPEN.length);
      } else {
        return this.release();
      }
      if (this.state === 'start') return this.release();
    }
    const end = this.buf.indexOf(CLOSE);
    if (end === -1) {
      // Keep a tail that could be the start of the closing tag.
      this.buf = this.buf.slice(-(CLOSE.length - 1));
      return '';
    }
    this.state = 'pass';
    const rest = this.buf.slice(end + CLOSE.length).trimStart();
    this.buf = '';
    this.trimming = rest === '';
    return rest;
  }

  /** Text still held back when the stream ends. A never-closed think block is dropped. */
  flush(): string {
    if (this.state === 'inside') return '';
    return this.release();
  }

  private release(): string {
    this.state = 'pass';
    const out = this.buf;
    this.buf = '';
    return out;
  }
}

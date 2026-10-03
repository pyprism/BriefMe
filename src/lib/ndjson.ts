/** Incremental parser for newline-delimited JSON. Lines may be split across chunks. */
export class NdjsonParser {
  private buffer = '';

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.flatMap((line) => this.parseLine(line));
  }

  flush(): unknown[] {
    const rest = this.buffer;
    this.buffer = '';
    return this.parseLine(rest);
  }

  private parseLine(line: string): unknown[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    return [JSON.parse(trimmed)];
  }
}

/** Incremental parser for server-sent events. Returns the `data:` payload of each event. */
export class SseParser {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const events = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = events.pop() ?? '';
    return events.flatMap((event) => this.parseEvent(event));
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    return this.parseEvent(rest);
  }

  private parseEvent(event: string): string[] {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));
    return data.length ? [data.join('\n')] : [];
  }
}

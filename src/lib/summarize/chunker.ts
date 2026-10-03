export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const wordCount = (text: string): number => (text.match(/\S+/g) ?? []).length;

/** Reading time in minutes at ~230 wpm, minimum 1. */
export const readingMinutes = (text: string): number =>
  Math.max(1, Math.round(wordCount(text) / 230));

const PROMPT_RESERVE_TOKENS = 1500;

/** Max characters of article text per model call, assuming ~3 chars per token (conservative). */
export function chunkBudget(numCtx: number): number {
  return Math.max(2000, Math.floor((numCtx - PROMPT_RESERVE_TOKENS) * 3));
}

function splitHard(text: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

function splitSentences(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current) out.push(current);
      current = '';
      out.push(...splitHard(sentence, max));
    } else if (current.length + sentence.length > max) {
      out.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Split text into chunks of at most `max` chars, preferring paragraph then sentence boundaries. */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length > max) {
      flush();
      out.push(
        ...splitSentences(paragraph, max)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (current.length + paragraph.length + 2 > max) {
      flush();
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  flush();
  return out;
}

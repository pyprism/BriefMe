export type Reach = 'answered' | 'no-answer';

/**
 * Tells "the server is there but the browser blocked the reply" apart from "nothing answered".
 * A no-cors request resolves (opaque) whenever the server responds, whatever CORS says.
 */
export async function probeReach(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<Reach> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchImpl(url, { mode: 'no-cors', signal: controller.signal });
    return 'answered';
  } catch {
    return 'no-answer';
  } finally {
    clearTimeout(timer);
  }
}

export interface Diagnosis {
  reach: Reach;
  /** Host access granted for the server's origin. */
  access: boolean;
}

/** i18n key that explains the most likely cause. */
export function diagnosisKey({ reach, access }: Diagnosis): string {
  if (!access) return 'diagNoAccess';
  return reach === 'answered' ? 'diagBlocked' : 'diagNoRoute';
}

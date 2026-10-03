import { describe, expect, it } from 'vitest';
import { diagnosisKey, probeReach } from '../../src/lib/diagnose';

describe('probeReach', () => {
  it('reports answered when the no-cors request resolves', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(null);
    }) as typeof fetch;
    expect(await probeReach('http://x', fetchImpl)).toBe('answered');
    expect(seen?.mode).toBe('no-cors');
  });

  it('reports no-answer when the request fails', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await probeReach('http://x', fetchImpl)).toBe('no-answer');
  });

  it('gives up after the timeout', async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      )) as typeof fetch;
    expect(await probeReach('http://x', hang, 30)).toBe('no-answer');
  });
});

describe('diagnosisKey', () => {
  it('prefers missing access, then blocked, then no route', () => {
    expect(diagnosisKey({ reach: 'answered', access: false })).toBe('diagNoAccess');
    expect(diagnosisKey({ reach: 'no-answer', access: false })).toBe('diagNoAccess');
    expect(diagnosisKey({ reach: 'answered', access: true })).toBe('diagBlocked');
    expect(diagnosisKey({ reach: 'no-answer', access: true })).toBe('diagNoRoute');
  });
});

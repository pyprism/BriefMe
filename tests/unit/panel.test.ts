import { describe, expect, it, vi } from 'vitest';
import { resolvePanelOpen } from '../../src/lib/panel';

describe('resolvePanelOpen', () => {
  it('opens only once when the first open succeeded, even if a second would reject', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('second open rejected'));
    expect(await resolvePanelOpen(Promise.resolve('opened'), retry)).toBe(true);
    expect(retry).not.toHaveBeenCalled();
  });

  it('falls back to the overlay when the first open failed, without opening again', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    expect(await resolvePanelOpen(Promise.resolve('failed'), retry)).toBe(false);
    expect(retry).not.toHaveBeenCalled();
  });

  it('tries once when no open was attempted at click time', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    expect(await resolvePanelOpen(undefined, retry)).toBe(true);
    expect(await resolvePanelOpen(Promise.resolve('skipped'), retry)).toBe(true);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('uses the overlay when the late attempt is rejected', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('needs a user gesture'));
    expect(await resolvePanelOpen(undefined, retry)).toBe(false);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

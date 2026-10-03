import { describe, expect, it, vi } from 'vitest';
import { openPanelOnClick, resolvePanelOpen, type PanelClickInput } from '../../src/lib/panel';

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

describe('openPanelOnClick', () => {
  const input = (over: Partial<PanelClickInput> = {}) => {
    const calls: string[] = [];
    const base: PanelClickInput = {
      cachedMode: 'sidepanel',
      supported: true,
      tabId: 7,
      loadMode: vi.fn(async () => {
        calls.push('load');
        return 'sidepanel' as const;
      }),
      open: vi.fn(async () => {
        calls.push('open');
      }),
      remember: vi.fn(),
      ...over,
    };
    return { base, calls };
  };

  it('opens before any await when the mode is already known', async () => {
    const { base } = input();
    const result = openPanelOnClick(base);
    // still synchronous: the open call has already been made
    expect(base.open).toHaveBeenCalledWith(7);
    expect(base.loadMode).not.toHaveBeenCalled();
    expect(await result).toBe('opened');
  });

  it('reads the mode from storage inside the click right after a worker restart', async () => {
    const { base, calls } = input({ cachedMode: null });
    const result = openPanelOnClick(base);
    expect(base.loadMode).toHaveBeenCalledTimes(1); // issued synchronously
    expect(base.open).not.toHaveBeenCalled();
    expect(await result).toBe('opened');
    expect(calls).toEqual(['load', 'open']);
    expect(base.remember).toHaveBeenCalledWith('sidepanel');
  });

  it('does not open the panel after a restart when the user chose the overlay', async () => {
    const { base } = input({ cachedMode: null, loadMode: vi.fn(async () => 'overlay' as const) });
    expect(await openPanelOnClick(base)).toBe('skipped');
    expect(base.open).not.toHaveBeenCalled();
    expect(base.remember).toHaveBeenCalledWith('overlay');
  });

  it('skips without opening for overlay mode, unsupported browsers and missing tabs', async () => {
    for (const over of [
      { cachedMode: 'overlay' as const },
      { supported: false },
      { tabId: undefined },
    ]) {
      const { base } = input(over);
      expect(await openPanelOnClick(base)).toBe('skipped');
      expect(base.open).not.toHaveBeenCalled();
    }
  });

  it('reports a refused open as failed so the overlay is used', async () => {
    const { base } = input({ open: vi.fn().mockRejectedValue(new Error('needs a user gesture')) });
    expect(await openPanelOnClick(base)).toBe('failed');
    const cold = input({
      cachedMode: null,
      open: vi.fn().mockRejectedValue(new Error('needs a user gesture')),
    });
    expect(await openPanelOnClick(cold.base)).toBe('failed');
  });

  it('skips when the mode cannot be read', async () => {
    const { base } = input({
      cachedMode: null,
      loadMode: vi.fn().mockRejectedValue(new Error('x')),
    });
    expect(await openPanelOnClick(base)).toBe('skipped');
  });
});

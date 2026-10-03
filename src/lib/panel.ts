import type { UiMode } from './settings-schema';

export type PanelOpen = 'opened' | 'failed' | 'skipped';

/**
 * Decide whether the side panel is open. `first` is the result of the open call made while the
 * click was still being handled (undefined or 'skipped' if none was made). Only when no open
 * was attempted is `retry` called, once. A failed open is final and the caller uses the overlay.
 */
export async function resolvePanelOpen(
  first: Promise<PanelOpen> | undefined,
  retry: () => Promise<void>,
): Promise<boolean> {
  const outcome: PanelOpen = first ? await first : 'skipped';
  if (outcome === 'opened') return true;
  if (outcome === 'failed') return false;
  return retry().then(
    () => true,
    () => false,
  );
}

export interface PanelClickInput {
  /** Display mode remembered from earlier, or null right after the worker started. */
  cachedMode: UiMode | null;
  supported: boolean;
  tabId: number | undefined;
  /** Reads the display mode from storage. */
  loadMode: () => Promise<UiMode>;
  open: (tabId: number) => Promise<void>;
  remember: (mode: UiMode) => void;
}

/**
 * Called synchronously from a click handler. With a known mode the panel is opened before any
 * await, so the click is still being handled. Right after a worker restart the mode is unknown:
 * it is read from storage by a call made inside the click (browsers carry the click through the
 * callbacks of such calls), then the panel is opened. Any refusal is reported as 'failed' so the
 * caller can use the page overlay instead.
 */
export function openPanelOnClick(input: PanelClickInput): Promise<PanelOpen> {
  const { tabId } = input;
  if (!input.supported || tabId === undefined) return Promise.resolve('skipped');
  const open = (): Promise<PanelOpen> =>
    input.open(tabId).then(
      () => 'opened' as const,
      () => 'failed' as const,
    );
  if (input.cachedMode === 'sidepanel') return open();
  if (input.cachedMode === 'overlay') return Promise.resolve('skipped');
  return input.loadMode().then(
    (mode) => {
      input.remember(mode);
      return mode === 'sidepanel' ? open() : 'skipped';
    },
    () => 'skipped' as const,
  );
}

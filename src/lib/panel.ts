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

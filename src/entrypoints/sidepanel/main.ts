import { browser } from 'wxt/browser';
import { t } from '../../lib/i18n';
import { PANEL_JOB_PREFIX, panelJobKey, type PanelJob } from '../../lib/messaging/types';
import { loadSettings } from '../../lib/storage/settings';
import { SummaryView } from '../../lib/ui/view';

const JOB_MAX_AGE_MS = 20_000;

async function main() {
  const idle = document.getElementById('idle') as HTMLElement;
  const root = document.getElementById('root') as HTMLElement;
  idle.textContent = t('panelIdle');
  document.title = 'BriefMe';

  const settings = await loadSettings();
  const view = new SummaryView(root, {
    mode: 'panel',
    settings,
    openOptions: () => void browser.runtime.openOptionsPage(),
  });

  // Each browser window has its own job slot; this panel only reads its own window's.
  // `windows` can be missing in some contexts; then the panel falls back to any window's job.
  const windowId = (await browser.windows?.getCurrent?.().catch(() => undefined))?.id;
  const ownKey = windowId === undefined ? undefined : panelJobKey(windowId);
  const isOwn = (key: string) => (ownKey ? key === ownKey : key.startsWith(PANEL_JOB_PREFIX));

  let lastId = '';
  const handle = (job: PanelJob | undefined, requireFresh: boolean) => {
    if (!job || job.id === lastId) return;
    const stamp = Number(job.id.split('-')[0]);
    if (requireFresh && Date.now() - stamp > JOB_MAX_AGE_MS) return;
    lastId = job.id;
    idle.hidden = true;
    if (job.article) {
      void view.run(job.article);
    } else if (job.error) {
      // A blocked page can be summarized after the user confirms.
      const retry =
        job.error.kind === 'blocked'
          ? () =>
              void browser.runtime.sendMessage({ type: 'briefme:panel-retry', tabId: job.tabId })
          : undefined;
      view.showError(job.error, retry);
    }
  };

  if (ownKey) {
    const got = await browser.storage.local.get(ownKey);
    handle(got[ownKey] as PanelJob | undefined, true);
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) {
      if (isOwn(key)) handle(change.newValue as PanelJob | undefined, false);
    }
  });
}

void main();

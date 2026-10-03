import { t } from '../../lib/i18n';
import { h } from '../../lib/ui/dom';
import { loadSettings } from '../../lib/storage/settings';
import './style.css';

type Tab = 'settings' | 'prompts' | 'history' | 'digest';

/** Each view is loaded only when its tab is opened. */
const VIEWS: Record<Tab, (el: HTMLElement) => Promise<void>> = {
  settings: async (el) => (await import('./settings-view')).renderSettings(el),
  prompts: async (el) => (await import('./prompts-view')).renderPrompts(el),
  history: async (el) => (await import('./history-view')).renderHistory(el),
  digest: async (el) => (await import('./digest-view')).renderDigest(el),
};

async function main() {
  document.title = 'BriefMe';
  const app = document.getElementById('app') as HTMLElement;
  const settings = await loadSettings();
  const content = h('div');

  const header = h(
    'header',
    {},
    h('h1', { text: 'BriefMe' }),
    h('p', { class: 'tagline', text: t('extDescription') }),
  );

  if (!settings.onboarded) {
    app.replaceChildren(header, content);
    await VIEWS.settings(content);
    return;
  }

  const nav = h('nav', { 'aria-label': 'BriefMe' });
  const show = async (tab: Tab) => {
    for (const b of nav.querySelectorAll('button')) {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    location.hash = tab;
    await VIEWS[tab](content);
  };
  for (const tab of Object.keys(VIEWS) as Tab[]) {
    nav.append(
      h('button', {
        type: 'button',
        'data-tab': tab,
        text: t(`tab_${tab}`),
        onclick: () => void show(tab),
      }),
    );
  }
  app.replaceChildren(header, nav, content);
  const initial = location.hash.slice(1) as Tab;
  await show(initial in VIEWS ? initial : 'settings');
}

void main();

import { browser } from 'wxt/browser';
import {
  extractArticle,
  extractFromHtml,
  hasEnoughText,
  hasPasswordField,
  looksReaderable,
  parseHtmlDocument,
} from '../lib/extract/extract';
import type { ErrorInfo } from '../lib/errors';
import type { ExtractResponse, TabMessage } from '../lib/messaging/types';
import { t } from '../lib/i18n';
import { loadSettings } from '../lib/storage/settings';
import { SummaryView } from '../lib/ui/view';

declare global {
  interface Window {
    __briefmeLoaded?: boolean;
  }
}

const HOST_ID = 'briefme-root';

let view: SummaryView | null = null;
let hostEl: HTMLElement | null = null;

function teardown(): void {
  view?.destroy();
  view = null;
  hostEl?.remove();
  hostEl = null;
}

async function mount(): Promise<SummaryView> {
  teardown();
  const settings = await loadSettings();
  hostEl = document.createElement('div');
  hostEl.id = HOST_ID;
  document.documentElement.append(hostEl);
  const shadow = hostEl.attachShadow({ mode: 'open' });
  view = new SummaryView(shadow, {
    mode: 'overlay',
    settings,
    openOptions: () => void browser.runtime.sendMessage({ type: 'briefme:open-options' }),
    onClose: teardown,
  });
  return view;
}

async function run(force: boolean, onlyIfReaderable: boolean): Promise<void> {
  if (onlyIfReaderable && !looksReaderable(document)) return;
  const ui = await mount();
  const fail = (error: ErrorInfo) => ui.showError(error);

  if (!force && hasPasswordField(document)) {
    ui.showError({ kind: 'blocked', message: '' }, () => void run(true, false));
    return;
  }
  const selection = window.getSelection()?.toString() ?? '';
  const article = extractArticle(document, { selection });
  if (!hasEnoughText(article)) {
    fail({ kind: 'no-content', message: '' });
    return;
  }
  await ui.run(article);
}

export default defineContentScript({
  matches: ['*://*/*'],
  registration: 'runtime',
  main() {
    // The script can be injected repeatedly; register the listener once.
    if (window.__briefmeLoaded) return;
    window.__briefmeLoaded = true;

    browser.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
      const msg = raw as TabMessage;
      if (msg?.type === 'briefme:run') {
        void run(msg.force === true, msg.onlyIfReaderable === true);
        sendResponse({ ok: true });
      } else if (msg?.type === 'briefme:run-article') {
        void mount().then((ui) => ui.run(msg.article));
        sendResponse({ ok: true });
      } else if (msg?.type === 'briefme:show-error') {
        void mount().then((ui) => ui.showError(msg.error));
        sendResponse({ ok: true });
      } else if (msg?.type === 'briefme:extract') {
        // Same sensitive-page rule as the overlay: password pages need an explicit override.
        if (msg.force !== true && hasPasswordField(document)) {
          sendResponse({ error: { kind: 'blocked', message: '' } } satisfies ExtractResponse);
          return false;
        }
        const selection = msg.useSelection ? (window.getSelection()?.toString() ?? '') : '';
        const article = extractArticle(document, { selection });
        const res: ExtractResponse = hasEnoughText(article)
          ? { article }
          : { error: { kind: 'no-content', message: '' } };
        sendResponse(res);
      } else if (msg?.type === 'briefme:extract-html') {
        if (hasPasswordField(parseHtmlDocument(msg.html, msg.url))) {
          sendResponse({
            error: { kind: 'blocked', message: t('blockedLink') },
          } satisfies ExtractResponse);
          return false;
        }
        const article = extractFromHtml(msg.html, msg.url);
        const res: ExtractResponse = hasEnoughText(article)
          ? { article }
          : { error: { kind: 'no-content', message: '' } };
        sendResponse(res);
      }
      return false;
    });
  },
});

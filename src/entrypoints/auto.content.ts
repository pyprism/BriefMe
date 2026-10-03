import { browser } from 'wxt/browser';

/**
 * Tiny stub registered (via scripting.registerContentScripts) only for the sites the user listed
 * for auto-summarize. It asks the background to inject the full content script. Keeping the
 * check here means the background worker is not woken for every navigation in every tab.
 */
export default defineContentScript({
  matches: ['*://*/*'],
  registration: 'runtime',
  main() {
    void browser.runtime.sendMessage({ type: 'briefme:auto' }).catch(() => {});
  },
});

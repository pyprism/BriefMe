import { browser, type Browser } from 'wxt/browser';
import type { Article } from '../../lib/extract/types';
import { t } from '../../lib/i18n';
import { renderMarkdown } from '../../lib/markdown';
import type { ExtractResponse, TabMessage } from '../../lib/messaging/types';
import { toErrorInfo } from '../../lib/errors';
import { createProvider } from '../../lib/providers/factory';
import { effectiveSettings } from '../../lib/providers/runtime';
import { collect } from '../../lib/providers/types';
import { checkUrl } from '../../lib/guard';
import { pickModel, type Settings } from '../../lib/settings-schema';
import { loadSecrets, loadSettings } from '../../lib/storage/settings';
import { DEFAULT_SYSTEM, languageLine } from '../../lib/summarize/prompts';
import { runSummary } from '../../lib/summarize/run';
import { h } from '../../lib/ui/dom';
import { hostOf, originPattern } from '../../lib/url';

const isWeb = (tab: Browser.tabs.Tab) => /^https?:/.test(tab.url ?? '');

/** Extract a tab's text. Password pages are refused (no override in digests). */
async function extract(tabId: number): Promise<ExtractResponse | null> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
    const res = (await browser.tabs.sendMessage(tabId, {
      type: 'briefme:extract',
    } satisfies TabMessage)) as ExtractResponse;
    return res;
  } catch {
    return null;
  }
}

export async function renderDigest(container: HTMLElement): Promise<void> {
  const list = h('div', { class: 'tabs-list' });
  const status = h('div', { class: 'status', role: 'status' });
  const output = h('div', { class: 'digest-out', 'aria-live': 'polite' });
  let tabs: Browser.tabs.Tab[] = [];
  /** Settings as of the last tab load, used to avoid asking access for denied sites. */
  let knownSettings: Settings | null = null;

  const setStatus = (text: string, bad = false) => {
    status.className = bad ? 'status bad' : 'status';
    status.textContent = text;
  };

  async function loadTabs(): Promise<void> {
    const granted = await browser.permissions.request({ permissions: ['tabs'] });
    if (!granted) return setStatus(t('digestNeedTabs'), true);
    tabs = (await browser.tabs.query({ currentWindow: true })).filter(isWeb);
    knownSettings = await loadSettings();
    list.replaceChildren(
      ...tabs.map((tab) =>
        h(
          'label',
          {},
          h('input', { type: 'checkbox', value: String(tab.id), checked: false }),
          h('span', { text: `${tab.title ?? tab.url}` }),
        ),
      ),
    );
    if (tabs.length === 0) setStatus(t('digestNoTabs'));
  }

  async function build(): Promise<void> {
    const selected = tabs.filter(
      (tab) => list.querySelector<HTMLInputElement>(`input[value="${tab.id}"]`)?.checked,
    );
    if (selected.length === 0) return setStatus(t('digestSelectSome'), true);

    // Do not ask for access to sites the user has excluded. request() stays the first await.
    const candidates = knownSettings
      ? selected.filter((tab) => checkUrl(tab.url, knownSettings as Settings).ok)
      : selected;
    const origins = [
      ...new Set(
        candidates.map((tab) => originPattern(tab.url ?? '')).filter((o): o is string => !!o),
      ),
    ];
    const granted = origins.length ? await browser.permissions.request({ origins }) : true;
    if (!granted) return setStatus(t('err_permission'), true);

    const loaded = await loadSettings();
    if (!loaded.model) return setStatus(t('err_config'), true);
    const settings = await effectiveSettings(loaded);
    const provider = createProvider(settings, await loadSecrets());
    output.replaceChildren();

    // Only title and URL are kept per article, so many tabs do not hold their full text in memory.
    const items: { article: Pick<Article, 'title' | 'url'>; summary: string }[] = [];
    const skipped: { title: string; reason: string }[] = [];
    const skippedMarkdown = () =>
      skipped.length
        ? `\n\n## ${t('digestSkipped')}\n${skipped.map((x) => `- ${x.title}: ${x.reason}`).join('\n')}`
        : '';
    for (const [i, tab] of selected.entries()) {
      const title = tab.title ?? tab.url ?? '';
      setStatus(`${t('statusChunk')} ${i + 1}/${selected.length}: ${title}`);
      // Checked again with fresh settings; nothing from a denied site reaches the provider.
      const guard = checkUrl(tab.url, settings);
      if (!guard.ok) {
        skipped.push({ title, reason: t(`guard_${guard.reason}`) });
        continue;
      }
      const res = tab.id === undefined ? null : await extract(tab.id);
      if (!res || 'error' in res) {
        skipped.push({
          title,
          reason: t(`err_${res && 'error' in res ? res.error.kind : 'no_content'}`),
        });
        continue;
      }
      const article = res.article;
      try {
        let summary = '';
        for await (const ev of runSummary({
          provider,
          article,
          settings,
          style: 'tldr',
          language: settings.language,
          model: pickModel(settings, hostOf(article.url), article.text.length),
        })) {
          if (ev.type === 'token') summary += ev.text;
          else if (ev.type === 'replace') summary = ev.text;
        }
        items.push({
          article: { title: article.title, url: article.url },
          summary: summary.trim(),
        });
      } catch (error) {
        const info = toErrorInfo(error);
        return setStatus(t(`err_${info.kind}`, info.message), true);
      }
    }
    if (items.length === 0) {
      output.innerHTML = renderMarkdown(skippedMarkdown().trim());
      return setStatus(t('digestNothing'), true);
    }

    setStatus(t('statusWriting'));
    const numbered = items
      .map((it, n) => `[${n + 1}] ${it.article.title}\n${it.summary}`)
      .join('\n\n');
    const messages = [
      { role: 'system' as const, content: DEFAULT_SYSTEM },
      {
        role: 'user' as const,
        content:
          'Write a briefing from the numbered article summaries below. Start with a 2 to 3 sentence overview, then group the items by topic with one line each and cite sources as [n]. Use only the given text.\n' +
          `${languageLine(settings.language)}\n\n<summaries>\n${numbered}\n</summaries>`,
      },
    ];
    try {
      const body = await collect(
        provider.chat({
          model: pickModel(settings, null, Number.MAX_SAFE_INTEGER),
          messages,
          temperature: settings.temperature,
          numCtx: settings.numCtx,
        }),
      );
      const sources = items
        .map((it, n) => `${n + 1}. [${it.article.title}](${it.article.url})`)
        .join('\n');
      output.innerHTML = renderMarkdown(
        `${body}\n\n## ${t('digestSources')}\n${sources}${skippedMarkdown()}`,
      );
      setStatus('');
    } catch (error) {
      const info = toErrorInfo(error);
      setStatus(t(`err_${info.kind}`, info.message), true);
    }
  }

  container.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h2', { text: t('tabDigest') }),
      h('p', { class: 'help', text: t('digestIntro') }),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', text: t('btnLoadTabs'), onclick: () => void loadTabs() }),
      ),
      list,
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn primary',
          text: t('btnBuildDigest'),
          onclick: () => void build(),
        }),
      ),
      status,
      output,
    ),
  );
}

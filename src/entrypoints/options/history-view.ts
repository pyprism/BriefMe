import { t } from '../../lib/i18n';
import { renderMarkdown } from '../../lib/markdown';
import { h } from '../../lib/ui/dom';
import {
  clearHistory,
  deleteHistory,
  historyToMarkdown,
  listHistory,
  loadStats,
  type HistoryEntry,
} from '../../lib/storage/history';

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const fileName = (title: string) =>
  (title
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 60) || 'summary') + '.md';

export async function renderHistory(container: HTMLElement): Promise<void> {
  const stats = await loadStats();
  let entries = await listHistory();
  let query = '';

  const search = h('input', {
    type: 'text',
    placeholder: t('historySearch'),
    'aria-label': t('historySearch'),
    oninput: () => {
      query = search.value.toLowerCase();
      drawList();
    },
  });
  const list = h('div');

  const item = (e: HistoryEntry) => {
    const body = h('div', { class: 'body', hidden: true });
    return h(
      'div',
      { class: 'item' },
      h(
        'div',
        { class: 't' },
        h('a', {
          href: e.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: e.title || e.url,
        }),
      ),
      h('div', {
        class: 'm',
        text: `${new Date(e.createdAt).toLocaleString()} | ${e.model} | ${e.style.replace('custom:', '')}`,
      }),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn',
          text: t('btnShow'),
          onclick: () => {
            body.hidden = !body.hidden;
            if (!body.hidden) body.innerHTML = renderMarkdown(e.summary);
          },
        }),
        h('button', {
          class: 'btn',
          text: t('btnCopy'),
          onclick: () => void navigator.clipboard.writeText(historyToMarkdown(e)),
        }),
        h('button', {
          class: 'btn',
          text: t('btnDownload'),
          onclick: () => download(fileName(e.title), historyToMarkdown(e), 'text/markdown'),
        }),
        h('button', {
          class: 'btn danger',
          text: t('btnDelete'),
          onclick: async () => {
            await deleteHistory(e.id);
            entries = entries.filter((x) => x.id !== e.id);
            drawList();
          },
        }),
      ),
      body,
    );
  };

  function drawList(): void {
    const shown = entries.filter(
      (e) => !query || `${e.title} ${e.url} ${e.summary}`.toLowerCase().includes(query),
    );
    list.replaceChildren(
      ...(shown.length ? shown.map(item) : [h('p', { text: t('historyEmpty') })]),
    );
  }

  const minutes = Math.round(stats.secondsSaved / 60);
  container.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h2', { text: t('tabHistory') }),
      h(
        'div',
        { class: 'stats' },
        h('div', {}, h('b', { text: String(stats.summaries) }), t('statSummaries')),
        h('div', {}, h('b', { text: String(minutes) }), t('statMinutesSaved')),
      ),
      h('div', { class: 'field' }, h('label', { text: t('historySearch') }), search),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn',
          text: t('btnExportAll'),
          onclick: () =>
            download('briefme-history.json', JSON.stringify(entries, null, 2), 'application/json'),
        }),
        h('button', {
          class: 'btn danger',
          text: t('btnClearHistory'),
          onclick: async () => {
            if (!confirm(t('confirmClearHistory'))) return;
            await clearHistory();
            entries = [];
            drawList();
          },
        }),
      ),
      list,
    ),
  );
  drawList();
}

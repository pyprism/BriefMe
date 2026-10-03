import { browser } from 'wxt/browser';
import type { Article } from '../extract/types';
import type { ErrorInfo } from '../errors';
import { ORIGINS_COMMANDS } from '../help';
import { t } from '../i18n';
import { renderMarkdown } from '../markdown';
import {
  PORT_CHAT,
  PORT_SUMMARIZE,
  type ClientMessage,
  type ServerMessage,
} from '../messaging/types';
import { BUILTIN_STYLES, type Settings, type StyleId } from '../settings-schema';
import { historyToMarkdown } from '../storage/history';
import { ICON_CLOSE, ICON_MINIMIZE, ICON_SETTINGS, h, icon } from './dom';
import { VIEW_CSS, applyStyles } from './styles';

export const LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Italian',
  'Dutch',
  'Russian',
  'Hindi',
  'Bengali',
  'Arabic',
  'Chinese',
  'Japanese',
  'Korean',
  'Turkish',
  'Indonesian',
];

export interface ViewOptions {
  mode: 'overlay' | 'panel';
  settings: Settings;
  openOptions: () => void;
  onClose?: () => void;
}

interface RunOptions {
  refresh?: boolean;
  style?: StyleId;
  language?: string;
}

const RENDER_DELAY_MS = 60;

export class SummaryView {
  private readonly card: HTMLElement;
  private readonly styleSelect: HTMLSelectElement;
  private readonly langSelect: HTMLSelectElement;
  private readonly regenBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly metaEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly notesEl: HTMLElement;
  private readonly outEl: HTMLElement;
  private readonly qaEl: HTMLElement;
  private readonly errEl: HTMLElement;
  private readonly askRow: HTMLElement;
  private readonly askInput: HTMLInputElement;
  private readonly actionsEl: HTMLElement;
  private readonly footEl: HTMLElement;
  private readonly speakBtn: HTMLButtonElement;
  private readonly copyFormat: HTMLSelectElement;

  private article: Article | null = null;
  private text = '';
  private model = '';
  private port: ReturnType<typeof browser.runtime.connect> | null = null;
  /** Port of the follow-up question in flight, if any. */
  private chatPort: ReturnType<typeof browser.runtime.connect> | null = null;
  private chatHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private previousFocus: Element | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  constructor(
    private readonly host: ShadowRoot | HTMLElement,
    private readonly opts: ViewOptions,
  ) {
    applyStyles(host, VIEW_CSS);
    const s = opts.settings;
    const dark =
      s.theme === 'dark' ||
      (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);

    this.styleSelect = h('select', {
      'aria-label': t('labelStyle'),
      onchange: () => this.regenerate(),
    });
    this.langSelect = h('select', {
      'aria-label': t('labelLanguage'),
      onchange: () => this.regenerate(),
    });
    this.regenBtn = h('button', { text: t('btnRegenerate'), onclick: () => this.regenerate(true) });
    this.stopBtn = h('button', { text: t('btnStop'), hidden: true, onclick: () => this.stop() });
    this.metaEl = h('div', { class: 'meta' });
    this.statusEl = h('div', { class: 'status', role: 'status' });
    this.notesEl = h('div');
    this.outEl = h('div', { class: 'out', 'aria-live': 'polite', 'aria-atomic': 'false' });
    this.qaEl = h('div', { class: 'qa' });
    this.errEl = h('div', { class: 'hidden' });
    this.askInput = h('input', {
      type: 'text',
      placeholder: t('askPlaceholder'),
      'aria-label': t('askPlaceholder'),
      onkeydown: ((e: KeyboardEvent) => {
        if (e.key === 'Enter') this.ask();
      }) as EventListener,
    });
    this.askRow = h(
      'div',
      { class: 'ask hidden' },
      this.askInput,
      h('button', { text: t('btnAsk'), onclick: () => this.ask() }),
    );
    this.speakBtn = h('button', { text: t('btnSpeak'), onclick: () => this.toggleSpeak() });
    this.copyFormat = h(
      'select',
      { 'aria-label': t('labelCopyAs') },
      h('option', { value: 'markdown', text: t('copyMarkdown') }),
      h('option', { value: 'plain', text: t('copyPlain') }),
    );
    this.actionsEl = h(
      'div',
      { class: 'actions hidden' },
      this.copyFormat,
      h('button', {
        text: t('btnCopy'),
        onclick: (e: Event) => this.copy(e.target as HTMLButtonElement),
      }),
      h('button', { text: t('btnDownload'), onclick: () => this.download() }),
      s.obsidianVault
        ? h('button', { text: t('btnObsidian'), onclick: () => this.obsidian() })
        : null,
      this.speakBtn,
    );
    this.footEl = h('div', { class: 'foot' });

    const hdr = h(
      'div',
      { class: 'hdr' },
      h('span', { class: 'brand', text: 'BriefMe' }),
      h(
        'button',
        {
          class: 'icon',
          type: 'button',
          'aria-label': t('btnSettings'),
          title: t('btnSettings'),
          onclick: () => opts.openOptions(),
        },
        icon(...ICON_SETTINGS),
      ),
      opts.mode === 'overlay'
        ? h(
            'button',
            {
              class: 'icon',
              type: 'button',
              'aria-label': t('btnMinimize'),
              title: t('btnMinimize'),
              onclick: () => this.card.classList.toggle('min'),
            },
            icon(...ICON_MINIMIZE),
          )
        : null,
      opts.mode === 'overlay'
        ? h(
            'button',
            {
              class: 'icon',
              type: 'button',
              'aria-label': t('btnClose'),
              title: t('btnClose'),
              onclick: () => this.close(),
            },
            icon(...ICON_CLOSE),
          )
        : null,
    );

    const body = h(
      'div',
      { class: 'body' },
      h('div', { class: 'bar' }, this.styleSelect, this.langSelect, this.regenBtn, this.stopBtn),
      this.metaEl,
      this.statusEl,
      this.notesEl,
      this.errEl,
      this.outEl,
      this.qaEl,
      this.askRow,
      this.actionsEl,
      this.footEl,
    );

    this.card = h(
      'div',
      {
        class: `card ${opts.mode === 'panel' ? 'panel' : `pos-${s.position}`} ${dark ? 'dark' : ''}`,
        role: 'dialog',
        'aria-label': 'BriefMe',
        tabindex: '-1',
      },
      hdr,
      body,
    );
    this.fillSelects(s.style, 'auto');
    host.append(this.card);

    if (opts.mode === 'overlay') {
      this.enableDrag(hdr);
      document.addEventListener('keydown', this.onKey);
      this.card.addEventListener('keydown', (e) => this.trapTab(e));
      this.previousFocus = document.activeElement;
      this.card.focus({ preventScroll: true });
    }
  }

  private fillSelects(style: StyleId, language: string): void {
    this.styleSelect.replaceChildren(
      ...BUILTIN_STYLES.map((id) => h('option', { value: id, text: t(`style_${id}`) })),
      ...this.opts.settings.customPrompts.map((p) =>
        h('option', { value: `custom:${p.id}`, text: p.name }),
      ),
    );
    this.styleSelect.value = style;
    const configured = this.opts.settings.language;
    const langs = [
      'auto',
      ...new Set([...(configured !== 'auto' ? [configured] : []), ...LANGUAGES]),
    ];
    this.langSelect.replaceChildren(
      ...langs.map((l) => h('option', { value: l, text: l === 'auto' ? t('langAuto') : l })),
    );
    this.langSelect.value = language;
  }

  // ---- public ----

  async run(article: Article, options: RunOptions = {}): Promise<void> {
    this.article = article;
    const style = options.style ?? this.opts.settings.style;
    const language = options.language ?? this.opts.settings.language;
    this.fillSelects(style, language);
    this.langSelect.value = language;
    this.renderMeta();
    this.start({ refresh: options.refresh });
  }

  showError(info: ErrorInfo, retry?: () => void): void {
    this.setBusy(false);
    this.statusEl.replaceChildren();
    this.errEl.className = 'err';
    const key = `err_${info.kind}`;
    const children: (Node | null)[] = [
      h('div', { class: 'msg', text: t(key, info.message) }),
      info.message && info.message !== t(key, info.message)
        ? h('div', { class: 'hint', text: info.message })
        : null,
      t(`hint_${info.kind}`, '')
        ? h('div', { class: 'hint', text: t(`hint_${info.kind}`, '') })
        : null,
    ];
    if (info.kind === 'forbidden' && info.provider === 'ollama') {
      for (const { label, command } of ORIGINS_COMMANDS.slice(0, 3)) {
        children.push(h('div', { class: 'hint', text: label }), h('pre', { text: command }));
      }
    }
    children.push(
      h(
        'div',
        { class: 'row' },
        retry
          ? h('button', { class: 'primary', text: t('btnRetry'), onclick: () => retry() })
          : null,
        h('button', { text: t('btnSettings'), onclick: () => this.opts.openOptions() }),
      ),
    );
    this.errEl.replaceChildren(...children.filter((c): c is Node => c !== null));
  }

  destroy(): void {
    this.stop();
    document.removeEventListener('keydown', this.onKey);
    speechSynthesis?.cancel();
    this.card.remove();
  }

  // ---- internals ----

  private currentStyle = () => this.styleSelect.value as StyleId;
  private currentLanguage = () => this.langSelect.value;

  private regenerate(refresh = false): void {
    if (!this.article) return;
    this.start({ refresh });
  }

  private start({ refresh }: { refresh?: boolean }): void {
    if (!this.article) return;
    this.stop();
    this.text = '';
    this.chatHistory = [];
    this.outEl.replaceChildren();
    this.qaEl.replaceChildren();
    this.notesEl.replaceChildren();
    this.errEl.className = 'hidden';
    this.askRow.classList.add('hidden');
    this.actionsEl.classList.add('hidden');
    this.footEl.replaceChildren();
    this.setBusy(true);
    this.setStatus(t('statusConnecting'));

    const port = browser.runtime.connect({ name: PORT_SUMMARIZE });
    this.port = port;
    let finished = false;
    port.onMessage.addListener((raw) => {
      const msg = raw as ServerMessage;
      if (msg.type === 'done' || msg.type === 'error') finished = true;
      this.handle(msg);
    });
    port.onDisconnect.addListener(() => {
      if (this.port === port && !finished) {
        this.showError({ kind: 'server', message: t('errDisconnected') }, () =>
          this.regenerate(true),
        );
      }
    });
    const message: ClientMessage = {
      type: 'summarize',
      article: this.article,
      style: this.currentStyle(),
      language: this.currentLanguage(),
      refresh,
    };
    port.postMessage(message);
  }

  private stop(): void {
    const port = this.port;
    this.port = null;
    port?.disconnect();
    this.stopChat();
    this.setBusy(false);
  }

  /** Cancel a follow-up question in flight. The background aborts the provider request. */
  private stopChat(): void {
    const port = this.chatPort;
    this.chatPort = null;
    port?.disconnect();
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'status':
        this.setStatus(
          msg.phase === 'chunk'
            ? `${t('statusChunk')} ${msg.index}/${msg.total}`
            : msg.phase === 'writing'
              ? t('statusWriting')
              : t('statusConnecting'),
        );
        break;
      case 'token':
        this.text += msg.text;
        this.scheduleRender();
        break;
      case 'replace':
        this.text = msg.text;
        this.scheduleRender();
        break;
      case 'notice':
        this.notesEl.append(
          h('div', {
            class: 'note',
            text: `${t('noticeFallback')} (${t(`err_${msg.notice.reason}`, msg.notice.reason)})`,
          }),
        );
        break;
      case 'truncated':
        this.notesEl.append(
          h('div', { class: 'note', text: `${t('noticeTruncated')} ${msg.kept} / ${msg.total}` }),
        );
        break;
      case 'done':
        this.text = msg.summary;
        this.model = msg.model;
        this.renderNow();
        this.setBusy(false);
        this.statusEl.replaceChildren(msg.cached ? h('span', { text: t('statusCached') }) : '');
        this.askRow.classList.remove('hidden');
        this.actionsEl.classList.remove('hidden');
        this.footEl.textContent = `${msg.model} | ${msg.readMinutes} ${t('unitMinRead')} -> ${msg.elapsedSec} ${t('unitSec')} | ~${msg.tokensEstimate} ${t('unitTokens')}`;
        break;
      case 'error':
        this.port = null;
        this.showError(
          msg.error,
          msg.error.kind === 'aborted' ? undefined : () => this.regenerate(true),
        );
        break;
    }
  }

  private renderMeta(): void {
    const a = this.article;
    if (!a) return;
    this.metaEl.replaceChildren(
      h('div', { class: 'title', text: a.title || a.url }),
      h('div', { class: 'sub', text: [a.siteName, a.byline].filter(Boolean).join(' | ') }),
    );
  }

  private setStatus(text: string): void {
    this.statusEl.replaceChildren(
      h('span', { class: 'spin', 'aria-hidden': 'true' }),
      h('span', { text }),
    );
  }

  private setBusy(busy: boolean): void {
    this.stopBtn.hidden = !busy;
    this.regenBtn.disabled = busy;
    this.outEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (!busy) clearTimeout(this.renderTimer);
  }

  private scheduleRender(): void {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.renderNow();
    }, RENDER_DELAY_MS);
  }

  private renderNow(): void {
    this.outEl.innerHTML = renderMarkdown(this.text);
  }

  private async ask(): Promise<void> {
    const question = this.askInput.value.trim();
    if (!question || !this.article || this.chatPort) return;
    this.askInput.value = '';
    const answerEl = h('div', { class: 'out', 'aria-live': 'polite' });
    this.qaEl.append(h('div', { class: 'q', text: question }), answerEl);
    answerEl.scrollIntoView({ block: 'nearest' });

    const port = browser.runtime.connect({ name: PORT_CHAT });
    this.chatPort = port;
    // Replies from a port that was cancelled (closed or regenerated) must not touch the view.
    const current = () => this.chatPort === port;
    const finish = () => {
      if (current()) this.chatPort = null;
      port.disconnect();
    };
    let answer = '';
    port.onMessage.addListener((raw) => {
      if (!current()) return;
      const msg = raw as ServerMessage;
      if (msg.type === 'token') {
        answer += msg.text;
        answerEl.innerHTML = renderMarkdown(answer);
      } else if (msg.type === 'done') {
        this.chatHistory.push(
          { role: 'user', content: question },
          { role: 'assistant', content: answer },
        );
        finish();
      } else if (msg.type === 'error') {
        answerEl.textContent = t(`err_${msg.error.kind}`, msg.error.message);
        finish();
      }
    });
    port.onDisconnect.addListener(() => {
      if (current()) {
        this.chatPort = null;
        if (!answer) answerEl.textContent = t('errDisconnected');
      }
    });
    const message: ClientMessage = {
      type: 'chat',
      article: this.article,
      summary: this.text,
      history: [...this.chatHistory],
      question,
    };
    port.postMessage(message);
  }

  private async copy(button: HTMLButtonElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.copyText());
      const label = button.textContent;
      button.textContent = t('btnCopied');
      setTimeout(() => (button.textContent = label), 1200);
    } catch {
      // clipboard blocked by page policy; ignore
    }
  }

  private copyText(): string {
    const plain = (this.outEl.innerText || this.text).trim();
    switch (this.copyFormat.value) {
      case 'plain':
        return plain;
      default:
        return this.text;
    }
  }

  private markdown(): string {
    return historyToMarkdown({
      title: this.article?.title ?? '',
      url: this.article?.url ?? '',
      summary: this.text,
      model: this.model,
      createdAt: Date.now(),
    });
  }

  private download(): void {
    const name =
      (this.article?.title || 'summary')
        .replace(/[^\w\- ]+/g, '')
        .trim()
        .slice(0, 60) || 'summary';
    const url = URL.createObjectURL(new Blob([this.markdown()], { type: 'text/markdown' }));
    const a = h('a', { href: url, download: `${name}.md` });
    this.card.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private obsidian(): void {
    const vault = this.opts.settings.obsidianVault;
    const name = (this.article?.title || 'summary').replace(/[\\/:*?"<>|#^[\]]+/g, '').slice(0, 80);
    const uri = `obsidian://new?vault=${encodeURIComponent(vault)}&name=${encodeURIComponent(name)}&content=${encodeURIComponent(this.markdown())}`;
    const a = h('a', { href: uri });
    this.card.append(a);
    a.click();
    a.remove();
  }

  private toggleSpeak(): void {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      this.speakBtn.textContent = t('btnSpeak');
      return;
    }
    const utter = new SpeechSynthesisUtterance(this.outEl.innerText || this.text);
    if (this.article?.lang) utter.lang = this.article.lang;
    utter.onend = () => (this.speakBtn.textContent = t('btnSpeak'));
    this.speakBtn.textContent = t('btnStopSpeak');
    speechSynthesis.speak(utter);
  }

  private close(): void {
    this.destroy();
    if (this.previousFocus instanceof HTMLElement)
      this.previousFocus.focus({ preventScroll: true });
    this.opts.onClose?.();
  }

  private trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      this.card.querySelectorAll<HTMLElement>('button:not([hidden]):not(:disabled),select,input'),
    ).filter((el) => el.offsetParent !== null || this.card.contains(el));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = (this.host as ShadowRoot).activeElement ?? document.activeElement;
    if (e.shiftKey && (active === first || active === this.card)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private enableDrag(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const rect = this.card.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      this.card.style.right = 'auto';
      this.card.style.bottom = 'auto';
      this.card.style.left = `${rect.left}px`;
      this.card.style.top = `${rect.top}px`;
      handle.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const x = Math.min(window.innerWidth - 60, Math.max(-rect.width + 60, ev.clientX - dx));
        const y = Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dy));
        this.card.style.left = `${x}px`;
        this.card.style.top = `${y}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
}

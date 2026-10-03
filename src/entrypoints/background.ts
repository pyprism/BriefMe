import { browser, type Browser } from 'wxt/browser';
import { checkUrl } from '../lib/guard';
import { LLMError, toErrorInfo, type ErrorInfo } from '../lib/errors';
import { createProvider } from '../lib/providers/factory';
import { effectiveSettings, hasOrigin } from '../lib/providers/runtime';
import {
  panelJobKey,
  PORT_CHAT,
  PORT_SUMMARIZE,
  type ClientMessage,
  type ExtractResponse,
  type PanelJob,
  type RuntimeMessage,
  type ServerMessage,
  type TabMessage,
} from '../lib/messaging/types';
import { t } from '../lib/i18n';
import { resolvePanelOpen, type PanelOpen } from '../lib/panel';
import { pickModel, type Settings } from '../lib/settings-schema';
import { addHistory, addStats, findCached, hashKey } from '../lib/storage/history';
import { loadSecrets, loadSettings } from '../lib/storage/settings';
import { chunkBudget, estimateTokens, readingMinutes } from '../lib/summarize/chunker';
import { cacheKeyParts } from '../lib/summarize/cache-key';
import { buildChatMessages } from '../lib/summarize/prompts';
import { runSummary } from '../lib/summarize/run';
import { hostInList, hostOf, originPattern } from '../lib/url';

type Port = Browser.runtime.Port;

const MENU_PAGE = 'briefme-page';
const MENU_SELECTION = 'briefme-selection';
const MENU_LINK = 'briefme-link';
const KEEPALIVE_MS = 20_000;
const MAX_LINK_BYTES = 3_000_000;

interface SidebarApi {
  open(): Promise<void>;
}

function sidePanelSupported(): boolean {
  const api = browser as unknown as { sidePanel?: unknown; sidebarAction?: unknown };
  return Boolean(api.sidePanel || api.sidebarAction);
}

/** Last known display mode, so the toolbar click can open the panel before any await. */
let uiModeCache: Settings['uiMode'] | null = null;

/**
 * Browsers only allow opening the side panel while the click is still being handled, so this is
 * called synchronously from the event listener, using the cached mode.
 */
function openPanelNow(tab: Browser.tabs.Tab): Promise<PanelOpen> {
  if (uiModeCache !== 'sidepanel' || !sidePanelSupported() || tab.id === undefined) {
    return Promise.resolve('skipped');
  }
  return openSidePanel(tab.id).then(
    () => 'opened' as const,
    () => 'failed' as const,
  );
}

async function openSidePanel(tabId: number): Promise<void> {
  const api = browser as unknown as {
    sidePanel?: { open(o: { tabId: number }): Promise<void> };
    sidebarAction?: SidebarApi;
  };
  if (api.sidePanel) await api.sidePanel.open({ tabId });
  else if (api.sidebarAction) await api.sidebarAction.open();
}

async function inject(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['/content-scripts/content.js'],
  });
}

async function badge(tabId: number | undefined, title: string): Promise<void> {
  if (tabId === undefined) return;
  await browser.action.setBadgeText({ tabId, text: '!' });
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#c0392b' });
  await browser.action.setTitle({ tabId, title });
  setTimeout(() => {
    void browser.action.setBadgeText({ tabId, text: '' });
    void browser.action.setTitle({ tabId, title: t('actionTitle') });
  }, 5000);
}

async function showError(tabId: number, error: ErrorInfo): Promise<void> {
  const msg: TabMessage = { type: 'briefme:show-error', error };
  await browser.tabs.sendMessage(tabId, msg);
}

async function writePanelJob(
  tab: Browser.tabs.Tab,
  job: Pick<PanelJob, 'article' | 'error'>,
): Promise<void> {
  if (tab.id === undefined || tab.windowId === undefined) return;
  const full: PanelJob = {
    id: `${Date.now()}-${Math.random()}`,
    tabId: tab.id,
    windowId: tab.windowId,
    ...job,
  };
  await browser.storage.local.set({ [panelJobKey(tab.windowId)]: full });
}

/** Entry point for icon click, shortcut, context menu and auto-summarize. */
async function summarizeTab(
  tab: Browser.tabs.Tab,
  opts: { onlyIfReaderable?: boolean; panelOpened?: Promise<PanelOpen>; force?: boolean } = {},
): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined) return;
  const settings = await loadSettings();
  if (!settings.onboarded) {
    await browser.runtime.openOptionsPage();
    return;
  }
  const guard = checkUrl(tab.url, settings);
  if (!guard.ok) {
    await badge(tabId, t(`guard_${guard.reason}`));
    return;
  }

  let usePanel = settings.uiMode === 'sidepanel' && sidePanelSupported() && !opts.onlyIfReaderable;
  if (usePanel) {
    // The open attempt made during the click decides. Without one, try once now; if the
    // browser refuses (no longer a user gesture), fall back to the page overlay.
    usePanel = await resolvePanelOpen(opts.panelOpened, () => openSidePanel(tabId));
  }
  try {
    await inject(tabId);
    if (usePanel) {
      const res = (await browser.tabs.sendMessage(tabId, {
        type: 'briefme:extract',
        useSelection: true,
        force: opts.force,
      } satisfies TabMessage)) as ExtractResponse;
      await writePanelJob(tab, 'article' in res ? { article: res.article } : { error: res.error });
      return;
    }
    await browser.tabs.sendMessage(tabId, {
      type: 'briefme:run',
      force: opts.force,
      onlyIfReaderable: opts.onlyIfReaderable,
    } satisfies TabMessage);
  } catch (error) {
    await badge(tabId, error instanceof Error ? error.message : String(error));
  }
}

async function summarizeLink(tab: Browser.tabs.Tab | undefined, linkUrl: string): Promise<void> {
  const tabId = tab?.id;
  if (tabId === undefined) return;
  const pattern = originPattern(linkUrl);
  if (!pattern) return;
  // request() must be the first await so it still counts as part of the menu click.
  // It resolves true without a prompt when the origin is already granted.
  const granted = await browser.permissions.request({ origins: [pattern] }).catch(() => false);
  const settings = await loadSettings();
  if (!settings.onboarded) {
    await browser.runtime.openOptionsPage();
    return;
  }
  try {
    await inject(tabId);
    const guard = checkUrl(linkUrl, settings);
    if (!guard.ok)
      return void (await showError(tabId, {
        kind: 'blocked',
        message: t(`guard_${guard.reason}`),
      }));
    if (!granted)
      return void (await showError(tabId, {
        kind: 'permission',
        message: new URL(linkUrl).origin,
      }));

    const res = await fetch(linkUrl, { credentials: 'omit' });
    if (!res.ok) throw new LLMError('server', `HTTP ${res.status} ${linkUrl}`, res.status);
    const html = (await res.text()).slice(0, MAX_LINK_BYTES);
    const extracted = (await browser.tabs.sendMessage(tabId, {
      type: 'briefme:extract-html',
      html,
      url: linkUrl,
    } satisfies TabMessage)) as ExtractResponse;
    if ('error' in extracted) return void (await showError(tabId, extracted.error));
    await browser.tabs.sendMessage(tabId, {
      type: 'briefme:run-article',
      article: extracted.article,
    } satisfies TabMessage);
  } catch (error) {
    await showError(tabId, toErrorInfo(error)).catch(() => {});
  }
}

// ---- auto-summarize ----

const AUTO_SCRIPT_ID = 'briefme-auto';
let autoSync: Promise<void> = Promise.resolve();

/** Pattern for a listed site: matches the site and its subdomains. */
const sitePattern = (site: string) => `*://*.${site.replace(/^\*\./, '')}/*`;

/** Register the auto-summarize stub for listed sites that have host access. Serialized. */
function syncAutoScripts(): Promise<void> {
  autoSync = autoSync.then(doSyncAutoScripts, doSyncAutoScripts);
  return autoSync;
}

async function doSyncAutoScripts(): Promise<void> {
  try {
    const settings = await loadSettings();
    const patterns: string[] = [];
    if (settings.autoSummarize && settings.onboarded) {
      for (const site of new Set(settings.autoSites)) {
        const pattern = sitePattern(site);
        if (await browser.permissions.contains({ origins: [pattern] }).catch(() => false)) {
          patterns.push(pattern);
        }
      }
    }
    patterns.sort();
    const [existing] = await browser.scripting.getRegisteredContentScripts({
      ids: [AUTO_SCRIPT_ID],
    });
    if (
      existing &&
      JSON.stringify([...(existing.matches ?? [])].sort()) === JSON.stringify(patterns)
    ) {
      return;
    }
    if (existing) await browser.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] });
    if (patterns.length) {
      await browser.scripting.registerContentScripts([
        {
          id: AUTO_SCRIPT_ID,
          matches: patterns,
          js: ['/content-scripts/auto.js'],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
    }
  } catch {
    // registration is best effort; auto-summarize simply stays off
  }
}

async function autoSummarize(tab: Browser.tabs.Tab): Promise<void> {
  const settings = await loadSettings();
  if (!settings.autoSummarize || !settings.onboarded || !tab.url) return;
  const host = hostOf(tab.url);
  if (!host || !hostInList(host, settings.autoSites)) return;
  await summarizeTab(tab, { onlyIfReaderable: true });
}

// ---- streaming ----

function makePoster(port: Port) {
  let open = true;
  port.onDisconnect.addListener(() => (open = false));
  return (msg: ServerMessage) => {
    if (open) port.postMessage(msg);
  };
}

async function checkReady(settings: Settings): Promise<void> {
  if (!settings.model || !settings.baseUrl) {
    throw new LLMError('config', 'No provider or model selected');
  }
  const pattern = originPattern(settings.baseUrl);
  if (!pattern || !(await hasOrigin(pattern))) throw new LLMError('permission', settings.baseUrl);
}

function keepAlive(): () => void {
  const timer = setInterval(() => void browser.runtime.getPlatformInfo(), KEEPALIVE_MS);
  return () => clearInterval(timer);
}

const entityLabels = () =>
  Object.fromEntries(
    ['keyPoints', 'people', 'organizations', 'numbers', 'dates', 'quotes'].map((k) => [
      k,
      t(`entities_${k}`, k),
    ]),
  );

async function handleSummarize(port: Port, msg: Extract<ClientMessage, { type: 'summarize' }>) {
  const post = makePoster(port);
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  const stopKeepAlive = keepAlive();
  try {
    const loaded = await loadSettings();
    await checkReady(loaded);
    const settings = await effectiveSettings(loaded);
    const secrets = await loadSecrets();
    const { article } = msg;
    const style = msg.style ?? settings.style;
    const language = msg.language ?? settings.language;
    const model = pickModel(settings, hostOf(article.url), article.text.length);
    const readMinutes = readingMinutes(article.text);
    const key = await hashKey(cacheKeyParts({ article, settings, model, style, language }));

    if (!msg.refresh) {
      const cached = await findCached(key);
      if (cached) {
        post({
          type: 'done',
          summary: cached.summary,
          model: cached.model,
          cached: true,
          readMinutes,
          elapsedSec: 0,
          tokensEstimate: estimateTokens(cached.summary),
        });
        return;
      }
    }

    const started = Date.now();
    post({ type: 'status', phase: 'connecting' });
    let summary = '';
    for await (const event of runSummary({
      provider: createProvider(settings, secrets),
      article,
      settings,
      style,
      language,
      model,
      signal: controller.signal,
      entityLabels: entityLabels(),
    })) {
      if (event.type === 'token') summary += event.text;
      else if (event.type === 'replace') summary = event.text;
      post(event);
    }
    const elapsedSec = Math.max(1, Math.round((Date.now() - started) / 1000));
    await addHistory({
      id: crypto.randomUUID(),
      key,
      url: article.url,
      title: article.title,
      style,
      model,
      language,
      summary,
      createdAt: Date.now(),
      readMinutes,
      elapsedSec,
    });
    await addStats(readMinutes * 60 - elapsedSec);
    post({
      type: 'done',
      summary,
      model,
      cached: false,
      readMinutes,
      elapsedSec,
      tokensEstimate: estimateTokens(article.text),
    });
  } catch (error) {
    if (!controller.signal.aborted) post({ type: 'error', error: toErrorInfo(error) });
  } finally {
    stopKeepAlive();
  }
}

async function handleChat(port: Port, msg: Extract<ClientMessage, { type: 'chat' }>) {
  const post = makePoster(port);
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  const stopKeepAlive = keepAlive();
  try {
    const loaded = await loadSettings();
    await checkReady(loaded);
    const settings = await effectiveSettings(loaded);
    const secrets = await loadSecrets();
    const model = pickModel(settings, hostOf(msg.article.url), msg.article.text.length);
    const messages = buildChatMessages({
      article: msg.article,
      summary: msg.summary,
      history: msg.history,
      question: msg.question,
      maxChars: Math.min(settings.maxInputChars, chunkBudget(settings.numCtx)),
    });
    const provider = createProvider(settings, secrets);
    let answer = '';
    for await (const token of provider.chat({
      model,
      messages,
      temperature: settings.temperature,
      numCtx: settings.numCtx,
      keepAlive: settings.keepAlive || undefined,
      signal: controller.signal,
    })) {
      answer += token;
      post({ type: 'token', text: token });
    }
    post({
      type: 'done',
      summary: answer,
      model,
      cached: false,
      readMinutes: 0,
      elapsedSec: 0,
      tokensEstimate: 0,
    });
  } catch (error) {
    if (!controller.signal.aborted) post({ type: 'error', error: toErrorInfo(error) });
  } finally {
    stopKeepAlive();
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({ id: MENU_PAGE, title: t('menuPage'), contexts: ['page'] });
    browser.contextMenus.create({
      id: MENU_SELECTION,
      title: t('menuSelection'),
      contexts: ['selection'],
    });
    browser.contextMenus.create({ id: MENU_LINK, title: t('menuLink'), contexts: ['link'] });
    await syncAutoScripts();
    if (details.reason === 'install') await browser.runtime.openOptionsPage();
  });

  void loadSettings().then((s) => (uiModeCache = s.uiMode));
  browser.storage.onChanged.addListener((changes) => {
    const next = changes.settings?.newValue as Partial<Settings> | undefined;
    if (next?.uiMode) uiModeCache = next.uiMode;
    if (changes.settings) void syncAutoScripts();
  });

  browser.action.onClicked.addListener((tab) => {
    void summarizeTab(tab, { panelOpened: openPanelNow(tab) });
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'summarize') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab) await summarizeTab(tab);
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_LINK && info.linkUrl) void summarizeLink(tab, info.linkUrl);
    else if (tab && (info.menuItemId === MENU_PAGE || info.menuItemId === MENU_SELECTION)) {
      void summarizeTab(tab, { panelOpened: openPanelNow(tab) });
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_SUMMARIZE && port.name !== PORT_CHAT) return;
    port.onMessage.addListener((raw) => {
      const msg = raw as ClientMessage;
      if (msg.type === 'summarize') void handleSummarize(port, msg);
      else if (msg.type === 'chat') void handleChat(port, msg);
    });
  });

  browser.runtime.onMessage.addListener((raw, sender) => {
    const msg = raw as RuntimeMessage;
    if (msg?.type === 'briefme:open-options') void browser.runtime.openOptionsPage();
    else if (msg?.type === 'briefme:auto' && sender.tab) void autoSummarize(sender.tab);
    else if (msg?.type === 'briefme:panel-retry') {
      // The panel is already open; run the same job again with the user's override.
      void browser.tabs
        .get(msg.tabId)
        .then((tab) => summarizeTab(tab, { panelOpened: Promise.resolve('opened'), force: true }))
        .catch(() => {});
    }
    return false;
  });

  // Auto-summarize runs through a content script registered only for the listed sites, so the
  // worker is not woken on every page load. Keep the registration in step with the settings.
  browser.runtime.onStartup.addListener(() => void syncAutoScripts());
  browser.permissions.onAdded.addListener(() => void syncAutoScripts());
  browser.permissions.onRemoved.addListener(() => void syncAutoScripts());
});

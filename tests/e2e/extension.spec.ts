/// <reference types="chrome" />
import AxeBuilder from '@axe-core/playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import {
  startServer,
  writeOllamaStream,
  writeSse,
  type MockServer,
} from '../integration/mock-server';

const EXTENSION = join(process.cwd(), 'dist-e2e', 'chrome-mv3');
const ARTICLE = readFileSync(join(process.cwd(), 'tests/fixtures/article.html'), 'utf8');
const LOGIN = ARTICLE.replace('</main>', '<form><input type="password"></form></main>');

let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let site: Server;
let siteUrl: string;
let ollama: MockServer;
let fallback: MockServer;
let ollamaMode: 'ok' | 'forbidden' = 'ok';
let slowStarted = false;
let slowClosed = false;

const chatCalls = () => ollama.requests.filter((r) => r.url === '/api/chat').length;

async function configure(patch: Record<string, unknown>) {
  await worker.evaluate(
    async ({ settings }) => {
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();
      await chrome.storage.sync.set({ settings });
    },
    {
      settings: {
        primaryType: 'ollama',
        baseUrl: ollama.url,
        model: 'mock-model',
        onboarded: true,
        style: 'bullets',
        ...patch,
      },
    },
  );
}

async function openArticle(path = '/article'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${siteUrl}${path}`);
  return page;
}

async function runOn(page: Page) {
  const url = page.url();
  await worker.evaluate(async (pageUrl) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl });
    const tabId = tab?.id as number;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
    await chrome.tabs.sendMessage(tabId, { type: 'briefme:run' });
  }, url);
}

test.beforeAll(async () => {
  ollama = await startServer(async (req, res, body) => {
    if (req.url === '/api/tags')
      return res.writeHead(200).end(JSON.stringify({ models: [{ name: 'mock-model' }] }));
    if (ollamaMode === 'forbidden') return res.writeHead(403).end('');
    const messages = (JSON.parse(body || '{}').messages ?? []) as { content: string }[];
    if (messages.at(-1)?.content === 'slow question') {
      // Streams until the client goes away, so a cancelled request can be observed.
      slowStarted = true;
      res.on('close', () => (slowClosed = true));
      res.writeHead(200);
      while (!res.destroyed) {
        res.write(JSON.stringify({ message: { content: 'tick ' } }) + '\n');
        await new Promise((r) => setTimeout(r, 30));
      }
      return;
    }
    return writeOllamaStream(res, ['- Mock ', 'summary ', 'of the article.']);
  });
  fallback = await startServer((_req, res) => writeSse(res, ['Fallback ', 'summary.']));
  site = createServer((req, res) => {
    const headers: Record<string, string> = { 'Content-Type': 'text/html' };
    if (req.url === '/csp') {
      headers['Content-Security-Policy'] =
        "default-src 'self'; style-src 'self'; script-src 'self'";
    }
    res.writeHead(200, headers);
    res.end(req.url === '/login' ? LOGIN : ARTICLE);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'briefme-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await ollama?.close();
  await fallback?.close();
  site?.close();
});

test.beforeEach(() => {
  ollamaMode = 'ok';
  ollama.requests.length = 0;
  fallback.requests.length = 0;
  slowStarted = false;
  slowClosed = false;
});

test('summarizes a page into the overlay and shows reading stats', async () => {
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .out').first()).toContainText(
    'Mock summary of the article.',
  );
  await expect(page.locator('#briefme-root .foot')).toContainText('mock-model');
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  await expect(page.locator('#briefme-root .title')).toContainText('Harbour town');

  const sent = JSON.parse(ollama.requests.find((r) => r.url === '/api/chat')?.body ?? '{}');
  expect(sent.model).toBe('mock-model');
  const prompt = sent.messages.at(-1).content as string;
  expect(prompt).toContain('council of the small harbour town');
  expect(prompt).not.toContain('cheap watches');
  await page.close();
});

test('serves the second run from history without calling the model', async () => {
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  expect(chatCalls()).toBe(1);
  await runOn(page);
  await expect(page.locator('#briefme-root .status')).toContainText('Loaded from your history');
  expect(chatCalls()).toBe(1);
  await page.locator('#briefme-root button', { hasText: 'Regenerate' }).click();
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  expect(chatCalls()).toBe(2);
  await page.close();
});

test('shows the origins fix when Ollama answers 403', async () => {
  ollamaMode = 'forbidden';
  await configure({});
  const page = await openArticle();
  await runOn(page);
  const err = page.locator('#briefme-root .err');
  await expect(err).toContainText('rejected this extension');
  await expect(err).toContainText('OLLAMA_ORIGINS');
  await page.close();
});

test('uses the OpenRouter-style fallback when Ollama fails', async () => {
  ollamaMode = 'forbidden';
  await configure({
    fallbackEnabled: true,
    fallbackBaseUrl: `${fallback.url}/api/v1`,
    fallbackModel: 'router/model',
  });
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .out').first()).toContainText('Fallback summary.');
  await expect(page.locator('#briefme-root .note')).toContainText('backup provider was used');
  // The footer and the saved history name the model that wrote the summary, not the primary.
  await expect(page.locator('#briefme-root .foot')).toContainText('router/model');
  await expect(page.locator('#briefme-root .foot')).not.toContainText('mock-model');
  const models = await worker.evaluate(async () =>
    ((await chrome.storage.local.get('history')).history as { model: string }[]).map(
      (e) => e.model,
    ),
  );
  expect(models).toEqual(['router/model']);
  await page.close();
});

test('changing the backup provider invalidates a summary the backup wrote', async () => {
  ollamaMode = 'forbidden';
  const backup = (model: string) => ({
    fallbackEnabled: true,
    fallbackBaseUrl: `${fallback.url}/api/v1`,
    fallbackModel: model,
  });
  await configure(backup('router/one'));
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('router/one');
  const calls = () => fallback.requests.filter((r) => r.url.endsWith('/chat/completions')).length;
  expect(calls()).toBe(1);

  await runOn(page);
  await expect(page.locator('#briefme-root .status')).toContainText('Loaded from your history');
  expect(calls()).toBe(1);

  await configure(backup('router/two'));
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('router/two');
  expect(calls()).toBe(2);
  await page.close();
});

test('answers follow-up questions about the article', async () => {
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  await page.locator('#briefme-root .ask input').fill('Who is quoted?');
  await page.locator('#briefme-root .ask button').click();
  await expect(page.locator('#briefme-root .qa .q')).toHaveText('Who is quoted?');
  await expect(page.locator('#briefme-root .qa .out')).toContainText('Mock summary');
  const last = JSON.parse(ollama.requests.at(-1)?.body ?? '{}');
  expect(last.messages.at(-1).content).toBe('Who is quoted?');
  await page.close();
});

test('refuses pages with a password field unless overridden', async () => {
  await configure({});
  const page = await openArticle('/login');
  await runOn(page);
  await expect(page.locator('#briefme-root .err')).toContainText('password field');
  expect(chatCalls()).toBe(0);
  await page.locator('#briefme-root .err button', { hasText: 'Retry' }).click();
  await expect(page.locator('#briefme-root .out').first()).toContainText('Mock summary');
  await page.close();
});

test('closes with Escape and removes the overlay', async () => {
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#briefme-root')).toHaveCount(0);
  await page.close();
});

test('options page starts the first-run wizard when not configured', async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByText('Welcome to BriefMe').first()).toBeVisible();
  await expect(page.locator('#f-baseUrl')).toHaveValue('');
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'LM Studio' }).click();
  await expect(page.getByRole('button', { name: 'LM Studio' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#f-primaryType')).toHaveValue('openai');
  await expect(page.locator('#f-baseUrl')).toHaveValue('http://localhost:1234/v1');
  await page.getByRole('button', { name: 'Ollama', exact: true }).click();
  await expect(page.locator('#f-primaryType')).toHaveValue('ollama');
  await expect(page.locator('#f-baseUrl')).toHaveValue('http://localhost:11434');
  await page.close();
});

test('first-run wizard saves an OpenAI-compatible server and its type', async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
  });
  const modelsServer = await startServer((req, res) => {
    if (req.url?.endsWith('/models'))
      return res.writeHead(200).end('{"data":[{"id":"vendor/model-a"}]}');
    return writeSse(res, ['Wizard ', 'summary.']);
  });
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.getByRole('button', { name: 'Other', exact: true }).click();
    await page.locator('#f-baseUrl').fill(`${modelsServer.url}/api/v1`);
    await page.locator('#f-authToken').fill('sk-test');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'vendor/model-a' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.locator('#f-primaryType')).toHaveValue('openai');
    const saved = await worker.evaluate(async () => {
      const got = await chrome.storage.sync.get('settings');
      const local = await chrome.storage.local.get('secrets');
      return {
        ...(got.settings as Record<string, unknown>),
        key: (local.secrets as { authToken: string }).authToken,
      };
    });
    expect(saved).toMatchObject({
      primaryType: 'openai',
      baseUrl: `${modelsServer.url}/api/v1`,
      model: 'vendor/model-a',
      onboarded: true,
      key: 'sk-test',
    });

    const article = await openArticle();
    await runOn(article);
    await expect(article.locator('#briefme-root .out').first()).toContainText('Wizard summary.');
    const sent = modelsServer.requests.find((r) => r.url.endsWith('/chat/completions'));
    expect(sent?.url).toBe('/api/v1/chat/completions');
    expect(sent?.headers.authorization).toBe('Bearer sk-test');
    await article.close();
    await page.close();
  } finally {
    await modelsServer.close();
  }
});

test('Test connection explains an unreachable server', async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
  });
  const gone = await startServer(() => {});
  const url = gone.url;
  await gone.close();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByRole('button', { name: 'Other', exact: true }).click();
  await page.locator('#f-baseUrl').fill(url);
  await page.getByRole('button', { name: 'Test connection' }).click();
  const status = page.locator('.status').first();
  await expect(status).toContainText('Cannot reach the server');
  await expect(status).toContainText(`Cannot reach ${url}`);
  await expect(status).toContainText('could not connect at all');
  await expect(status).toContainText('Site access granted: yes');
  await page.close();
});

test('options page shows full settings once configured and saves changes', async () => {
  await configure({});
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator('#f-model')).toHaveValue('mock-model');
  await expect(page.locator('#f-firstResponseTimeoutSec')).toHaveValue('600');
  await expect(page.locator('#f-idleTimeoutSec')).toHaveValue('180');
  await page.locator('#f-idleTimeoutSec').fill('300');
  await page.locator('#f-temperature').fill('0.7');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const saved = await worker.evaluate(
    async () =>
      (await chrome.storage.sync.get('settings')).settings as {
        temperature: number;
        idleTimeoutSec: number;
      },
  );
  expect(saved.temperature).toBe(0.7);
  expect(saved.idleTimeoutSec).toBe(300);
  await page.close();
});

test('uses an OpenAI-compatible server (LM Studio, llama.cpp) as the primary provider', async () => {
  await configure({ primaryType: 'openai', baseUrl: `${fallback.url}/v1`, model: 'local-gguf' });
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .out').first()).toContainText('Fallback summary.');
  await expect(page.locator('#briefme-root .foot')).toContainText('local-gguf');
  expect(chatCalls()).toBe(0);
  const sent = JSON.parse(
    fallback.requests.find((r) => r.url.endsWith('/chat/completions'))?.body ?? '{}',
  );
  expect(sent.model).toBe('local-gguf');
  expect(sent.stream).toBe(true);
  await page.close();
});

test('an Ollama server can be the fallback for an OpenAI-compatible primary', async () => {
  ollamaMode = 'ok';
  const broken = await startServer((_req, res) => res.writeHead(500).end('{"error":"down"}'));
  try {
    await configure({
      primaryType: 'openai',
      baseUrl: `${broken.url}/v1`,
      model: 'm',
      fallbackEnabled: true,
      fallbackType: 'ollama',
      fallbackBaseUrl: ollama.url,
      fallbackModel: 'mock-model',
    });
    const page = await openArticle();
    await runOn(page);
    await expect(page.locator('#briefme-root .out').first()).toContainText('Mock summary');
    await expect(page.locator('#briefme-root .note')).toContainText('backup provider was used');
    await page.close();
  } finally {
    await broken.close();
  }
});

test('works on a page with a strict content security policy', async () => {
  await configure({});
  const page = await openArticle('/csp');
  await runOn(page);
  await expect(page.locator('#briefme-root .out').first()).toContainText('Mock summary');
  const position = await page
    .locator('#briefme-root .card')
    .evaluate((el) => getComputedStyle(el).position);
  expect(position).toBe('fixed');
  await page.close();
});

async function waitForAutoScript(expected: number) {
  await expect
    .poll(() =>
      worker.evaluate(
        async () =>
          (await chrome.scripting.getRegisteredContentScripts({ ids: ['briefme-auto'] })).length,
      ),
    )
    .toBe(expected);
}

test('auto-summarizes listed sites on article pages', async () => {
  await configure({ autoSummarize: true, autoSites: ['127.0.0.1'] });
  await waitForAutoScript(1);
  const page = await context.newPage();
  await page.goto(`${siteUrl}/article`);
  await expect(page.locator('#briefme-root .out').first()).toContainText('Mock summary');
  await page.close();
});

test('does not auto-summarize sites that are not listed', async () => {
  await configure({ autoSummarize: true, autoSites: ['example.org'] });
  await waitForAutoScript(1);
  const page = await context.newPage();
  await page.goto(`${siteUrl}/article`);
  await page.waitForTimeout(800);
  await expect(page.locator('#briefme-root')).toHaveCount(0);
  expect(chatCalls()).toBe(0);
  await page.close();
});

test('removes the auto-summarize registration when the feature is turned off', async () => {
  await configure({ autoSummarize: true, autoSites: ['127.0.0.1'] });
  await waitForAutoScript(1);
  await configure({ autoSummarize: false, autoSites: ['127.0.0.1'] });
  await waitForAutoScript(0);
});

test('lists summaries in the history view', async () => {
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#history`);
  await expect(options.locator('.item .t')).toContainText('Harbour town');
  await options.getByRole('button', { name: 'Show' }).click();
  await expect(options.locator('.item .body')).toContainText('Mock summary');
  await expect(options.locator('.stats')).toContainText('1');
  await options.close();
  await page.close();
});

test('custom prompts created in options appear as styles and are used', async () => {
  await configure({});
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#prompts`);
  await options.getByRole('button', { name: 'New prompt' }).click();
  await options.locator('#p-name').fill('Haiku');
  await options.locator('#p-template').fill('Write a haiku about this: {{text}}');
  await options.getByRole('button', { name: 'Save' }).click();
  await expect(options.locator('.item .t')).toHaveText('Haiku');
  await options.close();

  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  ollama.requests.length = 0;
  await page.locator('#briefme-root select').first().selectOption({ label: 'Haiku' });
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  const sent = JSON.parse(ollama.requests.find((r) => r.url === '/api/chat')?.body ?? '{}');
  expect(sent.messages.at(-1).content).toMatch(/^Write a haiku about this: /);
  await page.close();
});

const sidePanelUrl = () => `chrome-extension://${extensionId}/sidepanel.html`;
const windowIdOf = (page: Page) =>
  page.evaluate(async () => (await chrome.windows.getCurrent()).id as number);

function panelJob(windowId: number, title: string) {
  return {
    id: `${Date.now()}-e2e`,
    tabId: 1,
    windowId,
    article: {
      title,
      url: 'http://127.0.0.1/panel',
      byline: '',
      siteName: 'Test',
      lang: 'en',
      text: 'Panel text. '.repeat(40),
      source: 'readability',
    },
  };
}

test('side panel page renders a summary job for its own window', async () => {
  await configure({});
  const panel = await context.newPage();
  await panel.goto(sidePanelUrl());
  await expect(panel.locator('#idle')).toContainText('Click the BriefMe toolbar button');
  const windowId = await windowIdOf(panel);
  await worker.evaluate(
    async ({ key, job }) => {
      await chrome.storage.local.set({ [key]: job });
    },
    { key: `panelJob:${windowId}`, job: panelJob(windowId, 'Panel article') },
  );
  await expect(panel.locator('.out').first()).toContainText('Mock summary');
  await expect(panel.locator('.title')).toHaveText('Panel article');
  await panel.close();
});

test('a side panel job is consumed only by the panel of the window it was made in', async () => {
  await configure({});
  const first = await context.newPage();
  await first.goto(sidePanelUrl());
  const secondPromise = context.waitForEvent('page');
  const idSecond = await worker.evaluate(async (url) => {
    const created = await chrome.windows.create({ url, type: 'normal' });
    return created?.id as number;
  }, sidePanelUrl());
  const second = await secondPromise;
  await second.waitForURL(/sidepanel\.html/);
  const idFirst = await windowIdOf(first);
  expect(await windowIdOf(second)).toBe(idSecond);
  expect(idFirst).not.toBe(idSecond);
  await expect(first.locator('#idle')).toBeVisible();
  await expect(second.locator('#idle')).toBeVisible();

  await worker.evaluate(
    async ({ key, job }) => {
      await chrome.storage.local.set({ [key]: job });
    },
    { key: `panelJob:${idFirst}`, job: panelJob(idFirst, 'Only for the first window') },
  );
  await expect(first.locator('.title')).toHaveText('Only for the first window');
  await first.locator('.foot').waitFor();
  await second.waitForTimeout(500);
  await expect(second.locator('.title')).toHaveCount(0);
  await expect(second.locator('#idle')).toBeVisible();
  expect(chatCalls()).toBe(1);
  await second.close();
  await first.close();
});

test('the panel offers an override for password pages and retries with it', async () => {
  await configure({ uiMode: 'sidepanel' });
  const panel = await context.newPage();
  await panel.goto(sidePanelUrl());
  const windowId = await windowIdOf(panel);
  const page = await openArticle('/login');
  const tabId = await worker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return tab?.id as number;
  }, page.url());
  await worker.evaluate(
    async ({ key, job }) => {
      await chrome.storage.local.set({ [key]: job });
    },
    {
      key: `panelJob:${windowId}`,
      job: {
        id: `${Date.now()}-blocked`,
        tabId,
        windowId,
        error: { kind: 'blocked', message: '' },
      },
    },
  );
  await expect(panel.locator('.err')).toContainText('password field');
  expect(chatCalls()).toBe(0);
  await panel.locator('.err button', { hasText: 'Retry' }).click();
  await expect(panel.locator('.out').first()).toContainText('Mock summary');
  expect(chatCalls()).toBe(1);
  await page.close();
  await panel.close();
});

test('builds a digest from several tabs', async () => {
  await configure({});
  const a = await openArticle('/article');
  const b = await openArticle('/article?second');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#digest`);
  await options.getByRole('button', { name: 'Load tabs' }).click();
  const boxes = options.locator('.tabs-list input[type=checkbox]');
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await options.getByRole('button', { name: 'Create digest' }).click();
  await expect(options.locator('.digest-out')).toContainText('Mock summary');
  await expect(options.locator('.digest-out')).toContainText('Sources');
  await expect(options.locator('.digest-out a')).toHaveCount(2);
  expect(chatCalls()).toBe(3);
  await options.close();
  await a.close();
  await b.close();
});

test('overlay and options page have no serious accessibility violations', async () => {
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  const overlay = await new AxeBuilder({ page }).include('#briefme-root').analyze();
  expect(overlay.passes.length).toBeGreaterThan(5);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.locator('#f-model')).toBeVisible();
  const settingsPage = await new AxeBuilder({ page: options }).analyze();
  const serious = [...overlay.violations, ...settingsPage.violations].filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
  await options.close();
  await page.close();
});

async function sendToTab(page: Page, message: Record<string, unknown>) {
  return worker.evaluate(
    async ({ url, message }) => {
      const [tab] = await chrome.tabs.query({ url });
      const tabId = tab?.id as number;
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/content.js'],
      });
      return chrome.tabs.sendMessage(tabId, message);
    },
    { url: page.url(), message },
  );
}

type Extracted = { article?: { text: string; source: string }; error?: { kind: string } };

test('side panel and digest extraction refuse password pages unless overridden', async () => {
  await configure({});
  const page = await openArticle('/login');
  const blocked = (await sendToTab(page, { type: 'briefme:extract' })) as Extracted;
  expect(blocked.error?.kind).toBe('blocked');
  expect(blocked.article).toBeUndefined();
  const forced = (await sendToTab(page, { type: 'briefme:extract', force: true })) as Extracted;
  expect(forced.article?.text).toContain('council of the small harbour town');
  await page.close();
});

test('summarize-link extraction refuses fetched pages with a password field', async () => {
  await configure({});
  const page = await openArticle('/article');
  const html = (body: string) => `<html><head><title>L</title></head><body>${body}</body></html>`;
  const paragraphs =
    '<p>Linked page text that is long enough to count as readable content. </p>'.repeat(8);
  const blocked = (await sendToTab(page, {
    type: 'briefme:extract-html',
    html: html(`${paragraphs}<form><input type="password"></form>`),
    url: 'https://linked.example/login',
  })) as Extracted;
  expect(blocked.error?.kind).toBe('blocked');
  const ok = (await sendToTab(page, {
    type: 'briefme:extract-html',
    html: html(paragraphs),
    url: 'https://linked.example/page',
  })) as Extracted;
  expect(ok.article?.text).toContain('Linked page text');
  await page.close();
});

test('selection summarization in side panel mode sends only the selected passage', async () => {
  await configure({});
  const page = await openArticle('/article');
  await page.evaluate(() => {
    const p = document.querySelectorAll('article p')[3] as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(p);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
  const selected = (await sendToTab(page, {
    type: 'briefme:extract',
    useSelection: true,
  })) as Extracted;
  expect(selected.article?.source).toBe('selection');
  expect(selected.article?.text).toContain('review would be held after twelve months');
  expect(selected.article?.text).not.toContain('council of the small harbour town');
  const whole = (await sendToTab(page, { type: 'briefme:extract' })) as Extracted;
  expect(whole.article?.source).toBe('readability');
  expect(whole.article?.text).toContain('council of the small harbour town');
  await page.close();
});

test('digest skips denied sites and password pages and does not send them', async () => {
  const port = new URL(siteUrl).port;
  await configure({ denyList: ['localhost'] });
  const allowed = await openArticle('/article');
  const denied = await context.newPage();
  await denied.goto(`http://localhost:${port}/article`);
  const password = await openArticle('/login');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#digest`);
  await options.getByRole('button', { name: 'Load tabs' }).click();
  const boxes = options.locator('.tabs-list input[type=checkbox]');
  await expect(boxes).toHaveCount(3);
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await options.getByRole('button', { name: 'Create digest' }).click();
  await expect(options.locator('.digest-out')).toContainText('Mock summary');
  const out = options.locator('.digest-out');
  await expect(out).toContainText('Skipped');
  await expect(out).toContainText('deny list');
  await expect(out).toContainText('password field');
  await expect(out.locator('a')).toHaveCount(1);
  expect(chatCalls()).toBe(2);
  await options.close();
  for (const p of [allowed, denied, password]) await p.close();
});

test('closing or regenerating cancels a follow-up question in flight', async () => {
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  await page.locator('#briefme-root .ask input').fill('slow question');
  await page.locator('#briefme-root .ask button').click();
  await expect.poll(() => slowStarted).toBe(true);
  await expect(page.locator('#briefme-root .qa .out')).toContainText('tick');

  await page.locator('#briefme-root button', { hasText: 'Regenerate' }).click();
  await expect.poll(() => slowClosed).toBe(true);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  await expect(page.locator('#briefme-root .qa .q')).toHaveCount(0);

  await page.locator('#briefme-root .ask input').fill('fresh question');
  await page.locator('#briefme-root .ask button').click();
  await expect(page.locator('#briefme-root .qa .q')).toHaveText('fresh question');
  await expect(page.locator('#briefme-root .qa .out')).toContainText('Mock summary');
  const last = ollama.requests.at(-1)?.body ?? '';
  expect(last).toContain('fresh question');
  expect(last).not.toContain('slow question');

  // Reset both flags: slowStarted is still true from the first slow question, so waiting on it
  // alone would let Escape race ahead of the second request and the server would never see it.
  slowStarted = false;
  slowClosed = false;
  await page.locator('#briefme-root .ask input').fill('slow question');
  await page.locator('#briefme-root .ask button').click();
  await expect.poll(() => slowStarted).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => slowClosed).toBe(true);
  await page.close();
});

test('copy format selector is shown and changes what is copied', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: siteUrl });
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  const format = page.locator('#briefme-root .actions select');
  await expect(format).toBeVisible();
  await expect(format).toHaveAccessibleName('Copy format');
  const copy = page.locator('#briefme-root .actions button', { hasText: 'Copy' });
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  await format.selectOption('markdown');
  await copy.click();
  await expect.poll(clipboard).toBe('- Mock summary of the article.');

  await format.selectOption('plain');
  await copy.click();
  await expect.poll(clipboard).toBe('Mock summary of the article.');

  await expect(format.locator('option')).toHaveText(['Markdown', 'Plain text']);
  await page.close();
});

test('changing a prompt or the provider setting invalidates the cached summary', async () => {
  await configure({});
  const page = await openArticle();
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  expect(chatCalls()).toBe(1);

  await configure({ systemPrompt: 'Answer in pirate speak.' });
  await runOn(page);
  await expect(page.locator('#briefme-root .foot')).toContainText('min read');
  expect(chatCalls()).toBe(2);

  await runOn(page);
  await expect(page.locator('#briefme-root .status')).toContainText('Loaded from your history');
  expect(chatCalls()).toBe(2);
  await page.close();
});

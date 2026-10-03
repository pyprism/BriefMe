import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Loads the real Firefox build in a real Firefox. Skipped when Firefox is not installed.
 * Set FIREFOX_BIN to use a specific binary.
 */
const CANDIDATES = [
  process.env.FIREFOX_BIN,
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/usr/bin/firefox',
  '/usr/local/bin/firefox',
].filter((p): p is string => !!p);
const binary = CANDIDATES.find((p) => existsSync(p));

const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

const UUID = '11111111-2222-3333-4444-555555555555';
const GECKO_ID = 'briefme@briefme.invalid';

describe.skipIf(!binary)('Firefox build in real Firefox', () => {
  let driver: firefox.Driver;
  let server: Server;
  let port: number;

  const openExtensionPage = async (page: string) => {
    const before = await driver.getAllWindowHandles();
    await driver.setContext(firefox.Context.CHROME);
    await driver.executeScript(
      `const tab = gBrowser.addTab(arguments[0], {
         triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
       gBrowser.selectedTab = tab;`,
      `moz-extension://${UUID}/${page}`,
    );
    await driver.setContext(firefox.Context.CONTENT);
    await driver.wait(
      async () => (await driver.getAllWindowHandles()).length > before.length,
      10_000,
    );
    const added = (await driver.getAllWindowHandles()).find((h) => !before.includes(h));
    await driver.switchTo().window(added as string);
    await driver.wait(async () => (await driver.getCurrentUrl()).includes(page), 10_000);
    await driver.wait(
      async () => driver.executeScript<boolean>('return !!document.querySelector(".field")'),
      10_000,
    );
  };

  const fetchAll = (urls: string[]) =>
    driver.executeAsyncScript<Record<string, string>>(
      `const [urls, done] = [arguments[0], arguments[arguments.length - 1]];
       const out = {};
       Promise.all(urls.map((u) => fetch(u, { mode: 'no-cors' }).then(
         () => (out[u] = 'ok'), (e) => (out[u] = 'ERR ' + e.message)))).then(() => done(out));`,
      urls,
    );

  beforeAll(async () => {
    execFileSync('npx', ['wxt', 'zip', '-b', 'firefox'], { stdio: 'ignore' });
    server = createServer((_req, res) => res.writeHead(200).end('{"models":[]}'));
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    port = (server.address() as AddressInfo).port;

    const options = new firefox.Options();
    options.addArguments('-headless');
    options.setBinary(binary as string);
    options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: UUID }));
    const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
    driver = (await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .setFirefoxService(service)
      .build()) as firefox.Driver;
    const zip = join(process.cwd(), 'dist', 'briefme-0.1.0-firefox.zip');
    await driver.installAddon(zip, true);
  });

  afterAll(async () => {
    await driver?.quit();
    server?.close();
  });

  it('opens the first-run page', async () => {
    await openExtensionPage('options.html');
    const heading = await driver.executeScript<string>(
      'return document.querySelector("h2")?.textContent ?? ""',
    );
    expect(heading).toContain('Welcome to BriefMe');
    const presets = await driver.executeScript<string[]>(
      'return [...document.querySelectorAll(".chip")].map((b) => b.textContent)',
    );
    expect(presets).toEqual(
      expect.arrayContaining(['Ollama', 'LM Studio', 'llama.cpp', 'OpenRouter', 'OpenAI', 'Other']),
    );
  });

  it.skipIf(!lanAddress)(
    'reaches a plain-http server that is not on localhost (no https upgrade)',
    async () => {
      await openExtensionPage('options.html');
      const urls = [`http://127.0.0.1:${port}/`, `http://${lanAddress}:${port}/`];
      const result = await fetchAll(urls);
      expect(result[urls[0] as string]).toBe('ok');
      expect(result[urls[1] as string]).toBe('ok');
    },
  );
});

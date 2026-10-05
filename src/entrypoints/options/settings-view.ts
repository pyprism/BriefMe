import { browser } from 'wxt/browser';
import { ORIGINS_COMMANDS } from '../../lib/help';
import { t } from '../../lib/i18n';
import { toErrorInfo, type ErrorInfo } from '../../lib/errors';
import { diagnosisKey, probeReach } from '../../lib/diagnose';
import { buildProvider } from '../../lib/providers/factory';
import { PROVIDER_PRESETS, matchPreset } from '../../lib/presets';
import type { LLMProvider } from '../../lib/providers/types';
import {
  BUILTIN_STYLES,
  DEFAULT_SECRETS,
  PROVIDER_TYPES,
  type ProviderType,
  validateSettings,
  type Secrets,
  type Settings,
} from '../../lib/settings-schema';
import {
  loadSecrets,
  loadSettings,
  resetAll,
  saveSecrets,
  saveSettings,
} from '../../lib/storage/settings';
import { normalizeBaseUrl, originPattern, parseList } from '../../lib/url';
import { LANGUAGES } from '../../lib/ui/view';
import { h } from '../../lib/ui/dom';

type Kind = 'text' | 'password' | 'number' | 'select' | 'checkbox' | 'textarea' | 'list';
type Key = keyof Settings | keyof Secrets;

interface Field {
  key: Key;
  kind: Kind;
  options?: string[];
  optionLabel?: (value: string) => string;
  datalist?: string;
  step?: string;
}

const tl = (prefix: string) => (v: string) => t(`${prefix}_${v}`, v);

const sidePanelOk = () => {
  const api = browser as unknown as { sidePanel?: unknown; sidebarAction?: unknown };
  return Boolean(api.sidePanel || api.sidebarAction);
};

function groups(settings: Settings): Record<string, Field[]> {
  const styleOptions = [...BUILTIN_STYLES, ...settings.customPrompts.map((p) => `custom:${p.id}`)];
  return {
    connection: [
      { key: 'primaryType', kind: 'select', options: [...PROVIDER_TYPES], optionLabel: tl('opt') },
      { key: 'baseUrl', kind: 'text' },
      { key: 'authToken', kind: 'password' },
      { key: 'model', kind: 'text', datalist: 'models' },
    ],
    summaries: [
      {
        key: 'style',
        kind: 'select',
        options: styleOptions,
        optionLabel: (v) =>
          v.startsWith('custom:')
            ? (settings.customPrompts.find((p) => `custom:${p.id}` === v)?.name ?? v)
            : t(`style_${v}`, v),
      },
      {
        key: 'language',
        kind: 'select',
        options: ['auto', ...LANGUAGES],
        optionLabel: (v) => (v === 'auto' ? t('langAuto') : v),
      },
    ],
    summariesAdvanced: [
      { key: 'temperature', kind: 'number', step: '0.1' },
      { key: 'numCtx', kind: 'number', step: '512' },
      { key: 'keepAlive', kind: 'text' },
      { key: 'maxInputChars', kind: 'number', step: '1000' },
      { key: 'firstResponseTimeoutSec', kind: 'number', step: '30' },
      { key: 'idleTimeoutSec', kind: 'number', step: '30' },
      { key: 'maxParallelRequests', kind: 'number', step: '1' },
      { key: 'fastModel', kind: 'text', datalist: 'models' },
      { key: 'fastBelowChars', kind: 'number', step: '500' },
      { key: 'siteModels', kind: 'textarea' },
    ],
    display: [
      { key: 'theme', kind: 'select', options: ['auto', 'light', 'dark'], optionLabel: tl('opt') },
      {
        key: 'position',
        kind: 'select',
        options: ['top-right', 'top-left', 'bottom-right', 'bottom-left'],
        optionLabel: tl('opt'),
      },
      {
        key: 'uiMode',
        kind: 'select',
        options: sidePanelOk() ? ['overlay', 'sidepanel'] : ['overlay'],
        optionLabel: tl('opt'),
      },
    ],
    privacy: [
      { key: 'denyList', kind: 'list' },
      { key: 'allowList', kind: 'list' },
    ],
    auto: [
      { key: 'autoSummarize', kind: 'checkbox' },
      { key: 'autoSites', kind: 'list' },
    ],
    prompts: [
      { key: 'systemPrompt', kind: 'textarea' },
      { key: 'promptTemplate', kind: 'textarea' },
    ],
    fallback: [
      { key: 'fallbackEnabled', kind: 'checkbox' },
      { key: 'fallbackType', kind: 'select', options: [...PROVIDER_TYPES], optionLabel: tl('opt') },
      { key: 'fallbackBaseUrl', kind: 'text' },
      { key: 'fallbackApiKey', kind: 'password' },
      { key: 'fallbackModel', kind: 'text', datalist: 'fallbackModels' },
    ],
    integrations: [{ key: 'obsidianVault', kind: 'text' }],
  };
}

export async function renderSettings(container: HTMLElement): Promise<void> {
  let settings = await loadSettings();
  let secrets = await loadSecrets();
  const wizard = !settings.onboarded;
  const readers = new Map<Key, () => unknown>();
  const errorEls = new Map<Key, HTMLElement>();
  const g = groups(settings);

  type Role = { typeKey: 'primaryType' | 'fallbackType'; urlKey: 'baseUrl' | 'fallbackBaseUrl' };
  const presetRows: {
    role: Role;
    buttons: Map<string, HTMLButtonElement>;
    other: HTMLButtonElement;
  }[] = [];

  const typeInput = (role: Role) =>
    container.querySelector<HTMLSelectElement>(`#f-${role.typeKey}`);
  const urlInput = (role: Role) => container.querySelector<HTMLInputElement>(`#f-${role.urlKey}`);

  /** Highlight the preset that matches the current type and URL. */
  function refreshPresets(): void {
    for (const row of presetRows) {
      const url = urlInput(row.role)?.value ?? '';
      const match = matchPreset(typeInput(row.role)?.value ?? '', url);
      for (const [id, button] of row.buttons)
        button.setAttribute('aria-pressed', String(match?.id === id));
      row.other.setAttribute('aria-pressed', String(!match && url.trim() !== ''));
    }
  }
  container.addEventListener('input', refreshPresets);
  container.addEventListener('change', refreshPresets);

  /** When the API type changes and the URL is empty or a preset URL, set the URL for the new type. */
  function onTypeChange(role: Role, type: ProviderType): void {
    const url = urlInput(role);
    if (!url) return;
    const value = url.value.trim();
    if (value && !PROVIDER_PRESETS.some((p) => p.url === value)) return;
    url.value =
      type === 'ollama' ? (PROVIDER_PRESETS.find((p) => p.id === 'ollama')?.url ?? '') : '';
    refreshPresets();
  }

  /** One-click presets that fill the API type and URL. */
  function presetRow(typeKey: Role['typeKey'], urlKey: Role['urlKey']): HTMLElement {
    const role: Role = { typeKey, urlKey };
    const fill = (type: ProviderType, value: string) => {
      const typeEl = typeInput(role);
      const urlEl = urlInput(role);
      if (typeEl) typeEl.value = type;
      if (urlEl) {
        urlEl.value = value;
        urlEl.focus();
      }
      refreshPresets();
    };
    const buttons = new Map<string, HTMLButtonElement>();
    for (const p of PROVIDER_PRESETS) {
      buttons.set(
        p.id,
        h('button', {
          class: 'chip',
          type: 'button',
          text: p.name,
          'aria-pressed': 'false',
          onclick: () => fill(p.type, p.url),
        }),
      );
    }
    const other = h('button', {
      class: 'chip',
      type: 'button',
      text: t('presetOther'),
      'aria-pressed': 'false',
      onclick: () => fill('openai', ''),
    });
    presetRows.push({ role, buttons, other });
    return h(
      'div',
      { class: 'field' },
      h('label', { text: t('presetsLabel') }),
      h('div', { class: 'chips' }, ...buttons.values(), other),
    );
  }

  function fieldRow(f: Field): HTMLElement {
    const id = `f-${f.key}`;
    const value = (
      f.key in settings ? settings[f.key as keyof Settings] : secrets[f.key as keyof Secrets]
    ) as unknown;
    let input: HTMLElement;
    let read: () => unknown;
    switch (f.kind) {
      case 'checkbox': {
        const el = h('input', { type: 'checkbox', id });
        el.checked = value === true;
        input = el;
        read = () => el.checked;
        break;
      }
      case 'select': {
        const el = h(
          'select',
          { id },
          ...(f.options ?? []).map((o) => h('option', { value: o, text: f.optionLabel?.(o) ?? o })),
        );
        el.value = String(value);
        if (f.key === 'primaryType' || f.key === 'fallbackType') {
          el.addEventListener('change', () =>
            onTypeChange(
              f.key === 'primaryType'
                ? { typeKey: 'primaryType', urlKey: 'baseUrl' }
                : { typeKey: 'fallbackType', urlKey: 'fallbackBaseUrl' },
              el.value as ProviderType,
            ),
          );
        }
        input = el;
        read = () => el.value;
        break;
      }
      case 'textarea':
      case 'list': {
        const el = h('textarea', { id, rows: 4 });
        el.value = Array.isArray(value) ? value.join('\n') : String(value ?? '');
        input = el;
        read = () => (f.kind === 'list' ? parseList(el.value) : el.value);
        break;
      }
      default: {
        const el = h('input', {
          id,
          type: f.kind,
          list: f.datalist,
          step: f.step,
          autocomplete: 'off',
          spellcheck: 'false',
        });
        el.value = String(value ?? '');
        input = el;
        read = () => (f.kind === 'number' ? Number(el.value) : el.value);
      }
    }
    readers.set(f.key, read);
    const help = t(`help_${f.key}`, '');
    const error = h('div', { class: 'error', hidden: true, role: 'alert' });
    errorEls.set(f.key, error);
    return h(
      'div',
      { class: 'field' },
      h('label', { for: id, text: t(`field_${f.key}`) }),
      input,
      help ? h('div', { class: 'help', text: help }) : null,
      error,
    );
  }

  const card = (titleKey: string, ...children: (Node | null)[]) =>
    h('section', { class: 'card' }, h('h2', { text: t(titleKey) }), ...children);

  const modelsList = h('datalist', { id: 'models' });
  const fallbackModelsList = h('datalist', { id: 'fallbackModels' });

  // ---- connection test ----
  const connStatus = h('div', { class: 'status', role: 'status' });
  const connChips = h('div', { class: 'chips' });
  const connHelp = h('div');

  function showTestError(el: HTMLElement, info: ErrorInfo): void {
    el.className = 'status bad';
    el.textContent = `${t(`err_${info.kind}`, info.message)}${info.message && info.kind !== 'forbidden' ? ` (${info.message})` : ''}`;
  }

  function showCors(): void {
    connHelp.replaceChildren(
      h('p', { text: t('corsIntro') }),
      ...ORIGINS_COMMANDS.flatMap(({ label, command }) => [
        h('strong', { text: label }),
        h('pre', { class: 'cmd', text: command }),
      ]),
    );
  }

  function chips(
    target: HTMLElement,
    list: HTMLDataListElement,
    models: string[],
    inputKey: Key,
  ): void {
    list.replaceChildren(...models.map((m) => h('option', { value: m })));
    target.replaceChildren(
      ...models.slice(0, 40).map((m) =>
        h('button', {
          class: 'chip',
          type: 'button',
          text: m,
          onclick: () => {
            (container.querySelector(`#f-${inputKey}`) as HTMLInputElement).value = m;
          },
        }),
      ),
    );
  }

  async function testProvider(
    status: HTMLElement,
    chipsEl: HTMLElement,
    list: HTMLDataListElement,
    kind: 'primary' | 'fallback',
    interactive: boolean,
  ): Promise<boolean> {
    const urlKey = kind === 'primary' ? 'baseUrl' : 'fallbackBaseUrl';
    const keyKey = kind === 'primary' ? 'authToken' : 'fallbackApiKey';
    const modelKey = kind === 'primary' ? 'model' : 'fallbackModel';
    const url = normalizeBaseUrl(String(readers.get(urlKey)?.() ?? ''));
    status.className = 'status';
    if (!url) {
      status.className = 'status bad';
      status.textContent = t('err_invalid-url');
      return false;
    }
    const pattern = originPattern(url);
    // Firefox (and Chrome) only accept request() while the click is still being handled, so it
    // must be the first await here. Automatic calls (no click) can only check what is granted.
    let granted = false;
    if (pattern) {
      try {
        granted = interactive
          ? await browser.permissions.request({ origins: [pattern] })
          : await browser.permissions.contains({ origins: [pattern] });
      } catch {
        granted = false;
      }
    }
    if (!granted) {
      showTestError(status, { kind: 'permission', message: '' });
      return false;
    }
    status.textContent = t('statusTesting');
    const token = String(readers.get(keyKey)?.() ?? '');
    const type = String(
      readers.get(kind === 'primary' ? 'primaryType' : 'fallbackType')?.() ?? 'openai',
    ) as ProviderType;
    const provider: LLMProvider = buildProvider(type, url, token);
    try {
      const models = (await provider.listModels()).map((m) => m.id);
      status.className = 'status ok';
      status.textContent = `${t('statusConnected')} ${models.length} ${t('unitModels')}`;
      if (kind === 'primary') connHelp.replaceChildren();
      chips(chipsEl, list, models, modelKey);
      if (models.length === 0 && kind === 'primary') {
        status.textContent += ` - ${type === 'ollama' ? `${t('hintPull')} ollama pull llama3.2` : t('hintNoModels')}`;
      }
      return true;
    } catch (error) {
      const info = toErrorInfo(error);
      showTestError(status, info);
      if (info.kind === 'unreachable') {
        const [reach, access] = await Promise.all([
          probeReach(`${url}${type === 'ollama' ? '/api/tags' : '/models'}`),
          pattern
            ? browser.permissions.contains({ origins: [pattern] }).catch(() => false)
            : Promise.resolve(false),
        ]);
        status.append(
          h('div', { text: t(diagnosisKey({ reach, access })) }),
          h('div', { class: 'help', text: `${t('diagAccess')}: ${access ? t('yes') : t('no')}` }),
        );
      }
      if (kind === 'primary' && type === 'ollama' && info.kind === 'forbidden') showCors();
      return false;
    }
  }

  const testPrimary = (interactive = true) =>
    testProvider(connStatus, connChips, modelsList, 'primary', interactive);

  const fbStatus = h('div', { class: 'status', role: 'status' });
  const fbChips = h('div', { class: 'chips' });
  const testFallback = () => testProvider(fbStatus, fbChips, fallbackModelsList, 'fallback', true);

  // ---- save ----
  const saveStatus = h('div', { class: 'status', role: 'status' });

  function collect(finish: boolean): { settings: Settings; secrets: Secrets; errors: string[] } {
    const raw: Record<string, unknown> = { ...settings };
    const nextSecrets: Secrets = { ...secrets };
    for (const [key, read] of readers) {
      if (key in DEFAULT_SECRETS)
        (nextSecrets as unknown as Record<string, unknown>)[key] = String(read() ?? '').trim();
      else raw[key] = read();
    }
    if (finish) raw.onboarded = true;
    const result = validateSettings(raw as Partial<Settings>);
    for (const el of errorEls.values()) el.hidden = true;
    const errors = Object.entries(result.errors);
    for (const [key, code] of errors) {
      const el = errorEls.get(key as Key);
      if (el) {
        el.hidden = false;
        el.textContent = t(`err_${code}`, code);
      }
    }
    return { settings: result.settings, secrets: nextSecrets, errors: errors.map(([k]) => k) };
  }

  function neededOrigins(next: Settings): string[] {
    const origins = new Set<string>();
    const primary = originPattern(next.baseUrl);
    if (primary) origins.add(primary);
    if (next.fallbackEnabled) {
      const fb = originPattern(next.fallbackBaseUrl);
      if (fb) origins.add(fb);
    }
    if (next.autoSummarize)
      for (const site of next.autoSites) origins.add(`*://*.${site.replace(/^\*\./, '')}/*`);
    return [...origins];
  }

  async function save(finish = false): Promise<boolean> {
    const next = collect(finish);
    if (next.errors.length) {
      saveStatus.className = 'status bad';
      saveStatus.textContent = t('statusFixErrors');
      return false;
    }
    // request() must be the first await so it still counts as part of the click.
    const origins = neededOrigins(next.settings);
    if (origins.length) await browser.permissions.request({ origins }).catch(() => false);
    await saveSettings(next.settings);
    await saveSecrets(next.secrets);
    settings = next.settings;
    secrets = next.secrets;

    const denied: string[] = [];
    for (const origin of origins) {
      const ok = await browser.permissions.contains({ origins: [origin] }).catch(() => false);
      if (!ok) denied.push(origin);
    }
    saveStatus.className = denied.length ? 'status bad' : 'status ok';
    saveStatus.textContent = denied.length
      ? `${t('statusSavedNoAccess')} ${denied.join(', ')}. ${t('hintSavedNoAccess')}`
      : t('statusSaved');
    return true;
  }

  const fields = (key: string) => (g[key] ?? []).map(fieldRow);

  if (wizard) return renderWizard();

  // ---- normal page ----
  const diagnostics = h('button', {
    class: 'btn',
    text: t('btnDiagnostics'),
    onclick: async () => {
      const granted = await browser.permissions.getAll();
      const { customPrompts, systemPrompt, promptTemplate, ...rest } = settings;
      const info = {
        version: browser.runtime.getManifest().version,
        userAgent: navigator.userAgent,
        settings: {
          ...rest,
          customPrompts: customPrompts.length,
          hasCustomSystemPrompt: Boolean(systemPrompt),
          hasCustomTemplate: Boolean(promptTemplate),
        },
        secrets: {
          authToken: Boolean(secrets.authToken),
          fallbackApiKey: Boolean(secrets.fallbackApiKey),
        },
        permissions: granted,
      };
      await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
      saveStatus.className = 'status ok';
      saveStatus.textContent = t('statusDiagnostics');
    },
  });
  const reset = h('button', {
    class: 'btn danger',
    text: t('btnReset'),
    onclick: async () => {
      if (!confirm(t('confirmReset'))) return;
      await resetAll();
      location.reload();
    },
  });

  container.replaceChildren(
    card(
      'groupConnection',
      presetRow('primaryType', 'baseUrl'),
      ...fields('connection'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', text: t('btnTest'), onclick: () => void testPrimary() }),
      ),
      connStatus,
      connChips,
      connHelp,
      modelsList,
    ),
    card('groupSummaries', ...fields('summaries'), ...fields('summariesAdvanced')),
    card('groupDisplay', ...fields('display')),
    card('groupPrivacy', ...fields('privacy')),
    card('groupAuto', ...fields('auto')),
    card('groupPrompts', ...fields('prompts')),
    card(
      'groupFallback',
      h('div', { class: 'warn', text: t('fallbackWarning') }),
      presetRow('fallbackType', 'fallbackBaseUrl'),
      ...fields('fallback'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', text: t('btnTest'), onclick: () => void testFallback() }),
      ),
      fbStatus,
      fbChips,
      fallbackModelsList,
    ),
    card('groupIntegrations', ...fields('integrations')),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn primary', text: t('btnSave'), onclick: () => void save() }),
      diagnostics,
      reset,
    ),
    saveStatus,
  );
  setTimeout(refreshPresets, 0);

  // ---- first-run wizard ----
  function renderWizard(): void {
    let step = 0;
    const draw = () => {
      readers.clear();
      errorEls.clear();
      presetRows.length = 0;
      const stepLabel = h('div', { class: 'steps', text: `${t('wizardStep')} ${step + 1} / 3` });
      const nav = h('div', { class: 'row' });
      const back = h('button', {
        class: 'btn',
        text: t('btnBack'),
        onclick: () => ((step = Math.max(0, step - 1)), draw()),
      });
      if (step > 0) nav.append(back);

      let body: Node[];
      if (step === 0) {
        const connectionFields = (g.connection ?? [])
          .filter((f) => f.key !== 'model')
          .map(fieldRow);
        body = [
          h('p', { text: t('wizardWelcome') }),
          presetRow('primaryType', 'baseUrl'),
          ...connectionFields,
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn', text: t('btnTest'), onclick: () => void testPrimary() }),
          ),
          connStatus,
          connHelp,
        ];
        nav.append(
          h('button', {
            class: 'btn primary',
            text: t('btnNext'),
            onclick: async () => {
              if (!(await testPrimary())) return;
              if (await saveStep(['primaryType', 'baseUrl', 'authToken'])) {
                step = 1;
                draw();
              }
            },
          }),
        );
      } else if (step === 1) {
        const modelField = fieldRow({ key: 'model', kind: 'text', datalist: 'models' });
        body = [h('p', { text: t('wizardModel') }), modelField, connChips, modelsList];
        void testPrimary(false);
        nav.append(
          h('button', {
            class: 'btn primary',
            text: t('btnNext'),
            onclick: async () => {
              const model = String(readers.get('model')?.() ?? '').trim();
              if (!model) {
                const el = errorEls.get('model');
                if (el) {
                  el.hidden = false;
                  el.textContent = t('err_required');
                }
                return;
              }
              if (await saveStep(['model'])) {
                step = 2;
                draw();
              }
            },
          }),
        );
      } else {
        body = [h('p', { text: t('wizardPrefs') }), ...fields('summaries'), ...fields('display')];
        nav.append(
          h('button', {
            class: 'btn primary',
            text: t('btnFinish'),
            onclick: async () => {
              if (await saveStep(['style', 'language', 'theme', 'position', 'uiMode'], true))
                location.reload();
            },
          }),
        );
      }
      container.replaceChildren(card('wizardTitle', stepLabel, ...body, nav, saveStatus));
      setTimeout(refreshPresets, 0);
    };
    draw();
  }

  /** Save only the fields visible in the current wizard step. */
  async function saveStep(keys: Key[], finish = false): Promise<boolean> {
    const patch: Record<string, unknown> = {};
    for (const key of keys) {
      const read = readers.get(key);
      if (!read) continue;
      if (key in DEFAULT_SECRETS) secrets = { ...secrets, [key]: String(read() ?? '').trim() };
      else patch[key] = read();
    }
    const result = validateSettings({
      ...settings,
      ...patch,
      onboarded: finish || settings.onboarded,
    } as Partial<Settings>);
    const bad = keys.filter((k) => k in result.errors);
    if (bad.length) {
      for (const k of bad) {
        const el = errorEls.get(k);
        if (el) {
          el.hidden = false;
          el.textContent = t(`err_${result.errors[k as keyof Settings]}`);
        }
      }
      return false;
    }
    settings = result.settings;
    await saveSettings(settings);
    await saveSecrets(secrets);
    return true;
  }
}

import { t } from '../../lib/i18n';
import { h } from '../../lib/ui/dom';
import { DEFAULT_SYSTEM, DEFAULT_TEMPLATE } from '../../lib/summarize/prompts';
import { validateSettings, type CustomPrompt } from '../../lib/settings-schema';
import { loadSettings, saveSettings } from '../../lib/storage/settings';

function download(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function renderPrompts(container: HTMLElement): Promise<void> {
  const settings = await loadSettings();
  let prompts = settings.customPrompts;

  const persist = async () => {
    const result = validateSettings({ ...settings, customPrompts: prompts });
    prompts = result.settings.customPrompts;
    await saveSettings({ ...settings, customPrompts: prompts, style: result.settings.style });
  };

  const draw = (editing?: CustomPrompt) => {
    const list = h(
      'section',
      { class: 'card' },
      h('h2', { text: t('groupPrompts') }),
      h('p', { class: 'help', text: t('promptsIntro') }),
      ...(prompts.length === 0 ? [h('p', { text: t('promptsEmpty') })] : []),
      ...prompts.map((p) =>
        h(
          'div',
          { class: 'item' },
          h('div', { class: 't', text: p.name }),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn', text: t('btnEdit'), onclick: () => draw(p) }),
            h('button', {
              class: 'btn danger',
              text: t('btnDelete'),
              onclick: async () => {
                prompts = prompts.filter((x) => x.id !== p.id);
                await persist();
                draw();
              },
            }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn primary',
          text: t('btnNewPrompt'),
          onclick: () => draw({ id: '', name: '', system: '', template: '' }),
        }),
        h('button', {
          class: 'btn',
          text: t('btnExport'),
          onclick: () => download('briefme-prompts.json', JSON.stringify(prompts, null, 2)),
        }),
        h('button', { class: 'btn', text: t('btnImport'), onclick: () => fileInput.click() }),
      ),
    );
    const fileInput = h('input', {
      type: 'file',
      accept: 'application/json',
      hidden: true,
      onchange: async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text()) as unknown;
          const incoming = (Array.isArray(data) ? data : []) as CustomPrompt[];
          const used = new Set(prompts.map((p) => p.id));
          for (const p of incoming) {
            let id = String(p.id || 'prompt');
            while (used.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
            used.add(id);
            prompts = [...prompts, { ...p, id }];
          }
          await persist();
          draw();
        } catch {
          alert(t('err_import'));
        }
      },
    });
    list.append(fileInput);

    if (!editing) return void container.replaceChildren(list);

    const name = h('input', { type: 'text', value: editing.name, id: 'p-name' });
    const system = h('textarea', { id: 'p-system', placeholder: DEFAULT_SYSTEM, rows: 4 });
    system.value = editing.system;
    const template = h('textarea', { id: 'p-template', placeholder: DEFAULT_TEMPLATE, rows: 8 });
    template.value = editing.template;
    const form = h(
      'section',
      { class: 'card' },
      h('h2', { text: editing.id ? t('btnEdit') : t('btnNewPrompt') }),
      h('div', { class: 'field' }, h('label', { for: 'p-name', text: t('promptName') }), name),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'p-system', text: t('field_systemPrompt') }),
        system,
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'p-template', text: t('field_promptTemplate') }),
        template,
        h('div', { class: 'help', text: t('promptVars') }),
      ),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn primary',
          text: t('btnSave'),
          onclick: async () => {
            const n = name.value.trim();
            if (!n) return void name.focus();
            const id = editing.id || `p${Date.now().toString(36)}`;
            const next: CustomPrompt = {
              id,
              name: n,
              system: system.value,
              template: template.value,
            };
            prompts = editing.id
              ? prompts.map((p) => (p.id === id ? next : p))
              : [...prompts, next];
            await persist();
            draw();
          },
        }),
        h('button', { class: 'btn', text: t('btnCancel'), onclick: () => draw() }),
      ),
    );
    container.replaceChildren(list, form);
  };
  draw();
}

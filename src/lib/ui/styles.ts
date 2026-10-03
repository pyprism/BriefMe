/** Styles for the summary view. Applied via adoptedStyleSheets when possible (page CSP safe). */
export const VIEW_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.card {
  --bg: #ffffff; --fg: #1d2330; --muted: #5d6677; --line: #dde2ea; --accent: #2f6fed;
  --accent-fg: #ffffff; --soft: #f2f5fa; --err-bg: #fdecec; --err-fg: #8a1c1c; --warn-bg: #fff6e0;
  position: fixed; z-index: 2147483647; width: 400px; min-width: 300px; max-width: 95vw;
  height: auto; max-height: 85vh; min-height: 160px; display: flex; flex-direction: column;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.25); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  resize: both; overflow: hidden; text-align: left;
}
.card.dark {
  --bg: #1b1f27; --fg: #e6e9ef; --muted: #9aa3b2; --line: #2e3542; --accent: #6b9bff;
  --accent-fg: #0d1117; --soft: #242a35; --err-bg: #3a1f22; --err-fg: #ffb4b4; --warn-bg: #3a3220;
}
.card.pos-top-right { top: 16px; right: 16px; }
.card.pos-top-left { top: 16px; left: 16px; }
.card.pos-bottom-right { bottom: 16px; right: 16px; }
.card.pos-bottom-left { bottom: 16px; left: 16px; }
.card.panel { position: static; width: 100%; max-width: none; max-height: none; height: 100vh;
  border: 0; border-radius: 0; box-shadow: none; resize: none; }
.card.min .body { display: none; }
.card.min { min-height: 0; height: auto !important; resize: none; }
.hdr { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: var(--soft);
  border-bottom: 1px solid var(--line); cursor: grab; user-select: none; }
.card.panel .hdr { cursor: default; }
.brand { font-weight: 600; flex: 1; }
.body { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow-y: auto; }
.bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; align-items: center; }
select, input[type=text], textarea { font: inherit; color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px; max-width: 100%; }
button { font: inherit; color: var(--fg); background: var(--soft); border: 1px solid var(--line);
  border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
button.icon { padding: 2px 8px; background: transparent; border-color: transparent; font-size: 16px; line-height: 1.2; }
button.icon:hover { background: var(--line); }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button[hidden], .hidden { display: none !important; }
.meta { padding: 0 12px; }
.meta .title { font-weight: 600; }
.meta .sub, .status, .foot { color: var(--muted); font-size: 12px; }
.status { padding: 4px 12px; min-height: 22px; display: flex; gap: 6px; align-items: center; }
.spin { width: 10px; height: 10px; border: 2px solid var(--line); border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.note { margin: 4px 12px; padding: 6px 8px; border-radius: 6px; background: var(--warn-bg); font-size: 12px; }
.out { padding: 4px 12px 8px; overflow-wrap: anywhere; }
.out h1, .out h2, .out h3 { font-size: 15px; margin: 10px 0 4px; }
.out p { margin: 6px 0; } .out ul, .out ol { margin: 6px 0; padding-left: 20px; }
.out code { background: var(--soft); padding: 0 4px; border-radius: 4px; }
.out pre { background: var(--soft); padding: 8px; border-radius: 6px; overflow-x: auto; }
.out a { color: var(--accent); }
.out blockquote { margin: 6px 0; padding-left: 10px; border-left: 3px solid var(--line); color: var(--muted); }
.qa { padding: 0 12px; }
.qa .q { margin: 8px 0 2px; font-weight: 600; }
.ask { display: flex; gap: 6px; padding: 8px 12px; }
.ask input { flex: 1; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }
.foot { padding: 6px 12px; border-top: 1px solid var(--line); margin-top: auto; }
.err { margin: 8px 12px; padding: 8px 10px; border-radius: 8px; background: var(--err-bg); color: var(--err-fg); }
.err .msg { font-weight: 600; } .err .hint { margin-top: 4px; }
.err pre { margin: 6px 0; padding: 6px; background: rgba(0,0,0,.08); border-radius: 6px; overflow-x: auto; white-space: pre-wrap; font-size: 12px; }
.err .row { display: flex; gap: 6px; margin-top: 8px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;

export function applyStyles(root: ShadowRoot | HTMLElement, css: string): void {
  if (root instanceof ShadowRoot) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    } catch {
      // fall through to a <style> element
    }
  }
  const style = document.createElement('style');
  style.textContent = css;
  root.prepend(style);
}

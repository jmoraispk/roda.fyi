// src/app/shell/sheet.js
import { el } from './page.js';

let current = null;
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function openSheet({ document, title, content, closeLabel = 'Close', onClose = () => {} }) {
  current?.close();
  const opener = document.activeElement;
  const backdrop = el(document, 'div', { className: 'sheet-backdrop' });
  const grab = el(document, 'div', { className: 'sheet-grab', attrs: { 'aria-hidden': 'true' } });
  const closeButton = el(document, 'button', {
    className: 'sheet-close', text: '×', attrs: { type: 'button', 'aria-label': closeLabel }, dataset: { sheetClose: '' },
  });
  const heading = el(document, 'h2', { className: 'sheet-title', text: title });
  const body = el(document, 'div', { className: 'sheet-body' }, [content]);
  const panel = el(document, 'section', {
    className: 'sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
  }, [grab, el(document, 'div', { className: 'sheet-head' }, [heading, closeButton]), body]);
  let startY = null;

  function close() {
    if (!panel.isConnected) return;
    backdrop.remove();
    panel.remove();
    document.removeEventListener('keydown', onKey);
    current = null;
    onClose();
    opener?.focus?.();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  backdrop.addEventListener('click', close);
  closeButton.addEventListener('click', close);
  grab.addEventListener('pointerdown', (event) => { startY = event.clientY; });
  grab.addEventListener('pointerup', (event) => {
    if (startY !== null && event.clientY - startY > 80) close();
    startY = null;
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop, panel);
  (body.querySelector(FOCUSABLE) ?? panel).focus();
  current = { close };
  return { element: panel, body, close };
}

export function closeSheet() {
  current?.close();
}

// src/app/screens/chat-box.js
import { el } from '../shell/page.js';

export function createChatBox({ document, i18n, onSubmit }) {
  const input = el(document, 'textarea', { className: 'chat-input', attrs: {
    rows: '1', 'aria-label': i18n.t('log.writeRound'), placeholder: i18n.t('log.placeholder'), maxlength: '4000',
  } });
  function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    onSubmit(text);
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  const send = el(document, 'button', { className: 'chat-send', text: '↑', attrs: { type: 'button', 'aria-label': i18n.t('log.addRound') }, on: { click: submit } });
  return {
    element: el(document, 'div', { className: 'chat-box' }, [input, send]),
    insert(text) {
      const current = input.value.trim();
      input.value = current ? `${current}, ${text}` : text;
    },
    focus() { input.focus(); },
  };
}

// src/app/screens/mode-slider.js
import { MODES } from '../shell/access.js';
import { el } from '../shell/page.js';

export function createModeSlider({ document, i18n, value = 'train', onChange = () => {} }) {
  let current = value;
  const buttons = MODES.map((mode) => el(document, 'button', {
    className: 'mode-option', text: i18n.t(`mode.${mode}`), attrs: { type: 'button', role: 'radio' }, dataset: { mode },
    on: { click: () => choose(mode) },
  }));
  const group = el(document, 'div', { className: 'mode-slider', attrs: { role: 'radiogroup', 'aria-label': i18n.t('mode.label') } }, buttons);

  function sync() {
    for (const button of buttons) {
      const on = button.dataset.mode === current;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
    }
  }
  function choose(mode) {
    if (mode === current) return;
    current = mode;
    sync();
    onChange(mode);
  }
  group.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = MODES[(MODES.indexOf(current) + step + MODES.length) % MODES.length];
    choose(next);
    buttons[MODES.indexOf(next)].focus();
  });
  sync();

  return {
    element: el(document, 'div', { className: 'mode-field' }, [
      el(document, 'div', { className: 'muted', text: i18n.t('mode.label') }),
      group,
      el(document, 'div', { className: 'mode-hints muted', attrs: { 'aria-hidden': 'true' } }, [
        el(document, 'span', { text: i18n.t('mode.trainHint') }),
        el(document, 'span', { text: i18n.t('mode.teachHint') }),
      ]),
    ]),
    value: () => current,
    set(mode) {
      current = mode;
      sync();
    },
  };
}

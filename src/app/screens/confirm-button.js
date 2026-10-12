// src/app/screens/confirm-button.js
import { el } from '../shell/page.js';

// A destructive action that needs a second tap; it disarms when focus leaves.
export function confirmButton(document, { text, confirmText, className = 'button-secondary small', label = null, dataset = {}, onConfirm }) {
  let armed = false;
  const button = el(document, 'button', { className, text, attrs: { type: 'button', 'aria-label': label }, dataset });
  function disarm() {
    armed = false;
    button.textContent = text;
    if (label) button.setAttribute('aria-label', label);
    else button.removeAttribute('aria-label');
  }
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmText;
      button.setAttribute('aria-label', confirmText);
      return;
    }
    button.disabled = true;
    try {
      await onConfirm();
    } finally {
      button.disabled = false;
      disarm();
    }
  });
  button.addEventListener('blur', () => { if (armed && !button.disabled) disarm(); });
  return button;
}

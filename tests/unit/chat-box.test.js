// tests/unit/chat-box.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createChatBox } from '../../src/app/screens/chat-box.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('chat box', () => {
  it('sends on Enter, keeps Shift+Enter, and ignores empty input', () => {
    const onSubmit = vi.fn();
    const box = createChatBox({ document, i18n, onSubmit });
    document.body.replaceChildren(box.element);
    const input = document.querySelector('textarea[aria-label="Write a round"]');
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onSubmit).not.toHaveBeenCalled();
    input.value = 'ginga 10 min';
    const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledWith('ginga 10 min');
    expect(input.value).toBe('');
    box.insert('Armada');
    box.insert('Aú');
    expect(input.value).toBe('Armada, Aú');
    document.querySelector('button[aria-label="Add round"]').click();
    expect(onSubmit).toHaveBeenLastCalledWith('Armada, Aú');
  });
});

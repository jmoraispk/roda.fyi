// tests/unit/mode-slider.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createModeSlider } from '../../src/app/screens/mode-slider.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('mode slider', () => {
  it('shows three choices with hints and reports changes', () => {
    const onChange = vi.fn();
    const slider = createModeSlider({ document, i18n, value: 'both', onChange });
    document.body.replaceChildren(slider.element);
    const group = document.querySelector('[role="radiogroup"]');
    expect(group.getAttribute('aria-label')).toBe('How I use roda');
    expect([...group.querySelectorAll('[role="radio"]')].map((button) => [button.textContent, button.getAttribute('aria-checked')]))
      .toEqual([['Train', 'false'], ['Both', 'true'], ['Teach', 'false']]);
    expect(slider.element.textContent).toContain('log my training');
    expect(slider.element.textContent).toContain('teach classes');
    group.querySelector('[data-mode="teach"]').click();
    expect(onChange).toHaveBeenCalledWith('teach');
    group.querySelector('[data-mode="teach"]').click();
    expect(onChange).toHaveBeenCalledTimes(1);
    group.querySelector('[data-mode="teach"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(slider.value()).toBe('both');
    expect(document.activeElement.dataset.mode).toBe('both');
    slider.set('train');
    expect(group.querySelector('[data-mode="train"]').getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

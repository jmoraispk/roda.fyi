// tests/unit/move-picker.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createMovePicker } from '../../src/app/ui/move-picker.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('move picker', () => {
  it('filters by category and reports picked moves', () => {
    const onPick = vi.fn();
    const picker = createMovePicker({ document, i18n, onPick });
    document.body.replaceChildren(picker.element);
    expect(document.querySelectorAll('[data-pick]').length).toBe(57);
    document.querySelector('[data-category="arm-strikes"]').click();
    expect([...document.querySelectorAll('[data-pick]')].map((tile) => tile.dataset.pick))
      .toEqual(['galopante', 'godeme', 'elbow-strike', 'escala']);
    expect(document.querySelector('[data-category="arm-strikes"]').getAttribute('aria-pressed')).toBe('true');
    document.querySelector('[data-pick="godeme"]').click();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ slug: 'godeme', name: 'Godeme' }));
  });

  it('draws figures for captured moves and placeholders for the rest', () => {
    const picker = createMovePicker({ document, i18n, onPick() {} });
    document.body.replaceChildren(picker.element);
    expect(document.querySelector('[data-pick="armada"] svg polyline')).not.toBeNull();
    expect(document.querySelector('[data-pick="ginga"] svg text').textContent).toBe('G');
    expect(document.querySelector('[data-pick="armada"]').getAttribute('aria-label')).toBe('Armada');
  });
});

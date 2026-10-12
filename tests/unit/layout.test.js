// tests/unit/layout.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createLayout } from '../../src/app/shell/layout.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('layout', () => {
  it('renders the five destinations and marks the active tab', () => {
    const onPlus = vi.fn();
    const layout = createLayout({ document, i18n, onPlus });
    document.body.replaceChildren(layout.root);
    const nav = document.querySelector('nav[aria-label="Main navigation"]');
    expect([...nav.querySelectorAll('[data-tab]')].map((link) => [link.dataset.tab, link.getAttribute('href')])).toEqual([
      ['today', '#/'], ['calendar', '#/calendar'], ['discover', '#/discover'], ['me', '#/me'],
    ]);
    layout.setActive('calendar');
    expect(nav.querySelector('[data-tab="calendar"]').getAttribute('aria-current')).toBe('page');
    expect(nav.querySelector('[data-tab="today"]').hasAttribute('aria-current')).toBe(false);
    nav.querySelector('button[aria-label="Create"]').click();
    nav.querySelector('.app-plus-side').click();
    expect(onPlus).toHaveBeenCalledTimes(2);
  });

  it('toggles the detail mode body class', () => {
    const layout = createLayout({ document, i18n, onPlus() {} });
    document.body.replaceChildren(layout.root);
    layout.setDetailMode(true);
    expect(document.body.classList.contains('app-detail-open')).toBe(true);
    layout.setDetailMode(false);
    expect(document.body.classList.contains('app-detail-open')).toBe(false);
  });

  it('labels the desktop + from the mode', () => {
    let label = 'app.logTraining';
    const layout = createLayout({ document, i18n, onPlus() {}, plusLabel: () => label });
    document.body.replaceChildren(layout.root);
    expect(document.querySelector('.app-plus-side').textContent).toBe('+ Log training');
    label = 'app.create';
    layout.refreshCopy();
    expect(document.querySelector('.app-plus-side').textContent).toBe('+ Create');
  });
});

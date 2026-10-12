// tests/unit/sheet.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openSheet } from '../../src/app/shell/sheet.js';
import { el, initials, pageHeader } from '../../src/app/shell/page.js';

describe('sheet', () => {
  beforeEach(() => { document.body.innerHTML = '<button id="opener">Open</button>'; });

  function open(onClose = vi.fn()) {
    const opener = document.querySelector('#opener');
    opener.focus();
    const content = el(document, 'div', {}, [el(document, 'button', { text: 'Inside' })]);
    return { sheet: openSheet({ document, title: 'Thursday 9', content, onClose }), opener, onClose };
  }

  it('opens as a labelled dialog and moves focus inside', () => {
    const { sheet } = open();
    expect(sheet.element.getAttribute('role')).toBe('dialog');
    expect(sheet.element.getAttribute('aria-label')).toBe('Thursday 9');
    expect(sheet.element.contains(document.activeElement)).toBe(true);
  });

  it.each([
    ['Escape', (sheet) => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['backdrop', () => document.querySelector('.sheet-backdrop').click()],
    ['close button', (sheet) => sheet.element.querySelector('[data-sheet-close]').click()],
    ['swipe', (sheet) => {
      const grab = sheet.element.querySelector('.sheet-grab');
      grab.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, bubbles: true }));
      grab.dispatchEvent(new PointerEvent('pointerup', { clientY: 220, bubbles: true }));
    }],
  ])('closes with %s and returns focus', (_label, act) => {
    const { sheet, opener, onClose } = open();
    act(sheet);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps only one sheet open', () => {
    open();
    open();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('builds headers and initials', () => {
    const onBack = vi.fn();
    const header = pageHeader({ document, title: 'Training', backLabel: 'Back', onBack });
    header.querySelector('button[aria-label="Back"]').click();
    expect(onBack).toHaveBeenCalled();
    expect(header.querySelector('h1').textContent).toBe('Training');
    expect(initials('João Morais')).toBe('JM');
    expect(initials('ana')).toBe('A');
    expect(initials('')).toBe('?');
  });

  it('closes the open sheet on request', async () => {
    const { closeSheet } = await import('../../src/app/shell/sheet.js');
    const { opener } = open();
    closeSheet();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(() => closeSheet()).not.toThrow();
  });
});

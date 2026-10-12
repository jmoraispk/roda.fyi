// tests/unit/plus-menu.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { openPlusMenu } from '../../src/app/screens/plus-menu.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

describe('+ menu', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('offers the actions for the mode and runs the chosen one', () => {
    const ctx = appCtx();
    openPlusMenu(ctx, ['log', 'schedule', 'record']);
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.getAttribute('aria-label')).toBe('Create');
    expect([...sheet.querySelectorAll('[data-plus]')].map((button) => button.textContent))
      .toEqual(['📝 Log my training', '📅 Schedule a class', '🧾 Record a past class']);
    sheet.querySelector('[data-plus="record"]').click();
    expect(ctx.navigate).toHaveBeenCalledWith('/me/teaching/record');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows only what Teach offers', () => {
    openPlusMenu(appCtx(), ['schedule', 'record']);
    expect(document.querySelectorAll('[role="dialog"] [data-plus]')).toHaveLength(2);
  });
});

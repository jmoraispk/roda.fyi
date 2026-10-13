import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('app styles', () => {
  it('respects the phone safe areas', async () => {
    const css = await readFile('assets/app.css', 'utf8');
    expect(css).toContain('env(safe-area-inset-top');
    expect(css).toContain('env(safe-area-inset-left');
    expect(css).toContain('env(safe-area-inset-right');
  });

  it('keeps form controls at 16px so iOS does not zoom on focus', async () => {
    const css = await readFile('assets/app.css', 'utf8');
    expect(css).toMatch(/input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*16px/);
    expect(css).toMatch(/\.chip-input\s*\{[^}]*font-size:\s*16px/);
  });

  it('styles the shared component classes used inside the app', async () => {
    const css = await readFile('assets/app.css', 'utf8');
    for (const selector of ['.field-input', '.field-textarea', '.field-label', '.primary-button', '.secondary-button', '.quiet-button']) {
      expect(css).toContain(selector);
    }
  });

  it('tints native radios and checkboxes with the app gold', async () => {
    const css = await readFile('assets/app.css', 'utf8');
    expect(css).toMatch(/input\[type="radio"\],\s*input\[type="checkbox"\]\s*\{[^}]*accent-color:\s*var\(--gold\)/);
  });

  it('wraps very long words instead of widening the page', async () => {
    const css = await readFile('assets/app.css', 'utf8');
    expect(css).toMatch(/\.screen,\s*\.sheet\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});

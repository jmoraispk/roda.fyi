// tests/unit/segment-strip.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { parseRound } from '../../src/app/training-text-parser.js';
import { buildSegments } from '../../src/app/training-sequence.js';
import { createSegmentStrip } from '../../src/app/ui/segment-strip.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('segment strip', () => {
  it('renders segments and edits one rating at a time', () => {
    const onChange = vi.fn();
    const strip = createSegmentStrip({ document, i18n, idPrefix: 'r1', onChange });
    document.body.replaceChildren(strip.element);
    strip.render(buildSegments(parseRound('armada, au').steps), new Map());
    const labels = [...document.querySelectorAll('[data-segment-key]')].map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual(['Setup', 'Armada', 'Transition Armada → Aú', 'Aú']);
    document.querySelector('[data-segment-key="t:1>2"]').click();
    const editor = document.querySelector('[data-segment-editor]');
    expect(editor.querySelector('legend').textContent).toBe('Difficulty for Transition Armada → Aú');
    editor.querySelector('input[value="hard"]').click();
    expect(onChange).toHaveBeenLastCalledWith('t:1>2', { difficulty: 'hard', note: '' });
    editor.querySelector('input[name="note"]').value = 'late hands';
    editor.querySelector('input[name="note"]').dispatchEvent(new Event('input', { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('t:1>2', { difficulty: 'hard', note: 'late hands' });
    editor.querySelector('input[value=""]').click();
    expect(onChange).toHaveBeenLastCalledWith('t:1>2', null);
  });

  it('shows existing ratings on the segment buttons', () => {
    const strip = createSegmentStrip({ document, i18n, idPrefix: 'r2', onChange() {} });
    document.body.replaceChildren(strip.element);
    strip.render(buildSegments(parseRound('armada').steps), new Map([['m:1', { difficulty: 'hard', note: '' }]]));
    expect(document.querySelector('[data-segment-key="m:1"]').dataset.difficulty).toBe('hard');
  });
});

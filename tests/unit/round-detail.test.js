// tests/unit/round-detail.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createRoundDetail } from '../../src/app/ui/round-detail.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('round detail', () => {
  it('shows the written text, planned difficulty, and saves felt ratings', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'saved' });
    const round = {
      id: 'round-1', source_text: 'armada, au', sequence: [],
      ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'okay' }],
      planned: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }],
      movements: [],
    };
    document.body.replaceChildren(createRoundDetail({ document, i18n, round, index: 0, editable: true, onSave }));
    expect(document.querySelector('.round-source').textContent).toBe('armada, au');
    expect(document.querySelector('[data-planned]').textContent).toBe('Planned: Hard');
    expect(document.querySelector('[data-round-rating-form] input[value="okay"]').checked).toBe(true);
    document.querySelector('[data-round-rating-form] input[value="hard"]').click();
    document.querySelector('button[aria-label="Rate parts"]').click();
    document.querySelector('[data-segment-key="t:1>2"]').click();
    document.querySelector('[data-segment-editor] input[value="hard"]').click();
    document.querySelector('[data-round-rating-form]').requestSubmit();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { segment_key: 'r', segment_kind: 'round', difficulty: 'hard', note: null, from_movement_key: null, to_movement_key: null },
      { segment_key: 't:1>2', segment_kind: 'transition', difficulty: 'hard', note: null, from_movement_key: 'armada', to_movement_key: 'au' },
    ]));
    expect(document.querySelector('[data-round-rating-form] [role="status"]').textContent).toBe('Ratings saved.');
  });

  it('falls back to movement names for rounds recorded before text existed', () => {
    const round = {
      id: 'legacy', source_text: null, sequence: null, ratings: [], planned: [],
      movements: [{ movement_name: 'Armada', repetitions: 10, assessment: { difficulty: 'hard' } }],
    };
    document.body.replaceChildren(createRoundDetail({ document, i18n, round, index: 1, editable: false, onSave() {} }));
    expect(document.querySelector('h4').textContent).toBe('Round 2');
    expect(document.querySelector('.round-source').textContent).toBe('10x Armada');
    expect(document.querySelector('.round-legacy-ratings').textContent).toBe('Armada: Hard');
    expect(document.querySelector('[data-round-rating-form]')).toBeNull();
  });

  it('keeps entered ratings and reports a failed save', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('offline'));
    const round = { id: 'r', source_text: 'au', sequence: [], ratings: [], planned: [], movements: [] };
    document.body.replaceChildren(createRoundDetail({ document, i18n, round, index: 0, editable: true, onSave }));
    document.querySelector('[data-round-rating-form] input[value="easy"]').click();
    document.querySelector('[data-round-rating-form]').requestSubmit();
    await vi.waitFor(() => expect(document.querySelector('[data-round-rating-form] [role="status"]').textContent).toBe('offline'));
    expect(document.querySelector('[data-round-rating-form] input[value="easy"]').checked).toBe(true);
  });
});

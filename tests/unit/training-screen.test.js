// tests/unit/training-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderTraining } from '../../src/app/screens/training.js';
import { openSheet } from '../../src/app/shell/sheet.js';
import { AppError } from '../../src/app/errors.js';

const base = {
  occurrence_id: 'o1', kind: 'group', local_date: '2026-09-26', timezone: 'Europe/Lisbon',
  occurred_at: '2026-09-26T13:19:30Z', duration_minutes: 86, group_name: 'Grupo Lua', coach_name: 'João',
  attendee_count: 6, role: 'participant', participation: { id: 'p1', personal_notes: 'Knees ok', duration_minutes: 86 },
  rounds: [
    { id: 'r1', source_text: 'ginga 10 min', sequence: [], ratings: [], planned: [], movements: [] },
    { id: 'r2', source_text: '10x (armada, au)', sequence: [], ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }], planned: [], movements: [] },
  ],
  feedback: [{ id: 'f1', coach_name: 'João', body: 'Loose shoulders.' }],
  resources: [
    { id: 'v', kind: 'video', title: 'Recording', url: 'https://youtu.be/VAI3JUKTwz0', body: null, can_edit: false },
    { id: 's', kind: 'summary', title: null, url: null, body: '# Class 1', can_edit: false },
  ],
  can_add_resources: false,
};

function ctx(training) {
  return {
    document, i18n: createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } }),
    profile: { id: 'me' }, timezone: 'Europe/Lisbon', services: { training }, navigate: vi.fn(), back: vi.fn(),
    getTermMappings: () => [], openSheet: (options) => openSheet({ document, ...options }),
  };
}

describe('training screen', () => {
  it('puts the video first and always shows time, duration, and attendees', async () => {
    const view = await renderTraining(ctx({ getTraining: vi.fn().mockResolvedValue(base) }), { params: { id: 'o1' } });
    document.body.replaceChildren(view);
    expect(view.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/VAI3JUKTwz0');
    expect(view.querySelector('h1').textContent).toBe('Group · Grupo Lua');
    expect(view.querySelector('.training-meta').textContent).toContain('João');
    expect([...view.querySelectorAll('.tag')].map((tag) => tag.textContent)).toEqual(['⏱ 1h 26m', '👥 6 attended']);
    expect([...view.querySelectorAll('.chapter')].map((row) => row.textContent)).toEqual(['1ginga 10 min', '210x (armada, au)felt Hard']);
    expect(view.textContent).toContain('Knees ok');
    expect(view.textContent).toContain('Loose shoulders.');
    view.querySelector('button[data-resource="s"]').click();
    expect(document.querySelector('[role="dialog"] .resource-markdown h1').textContent).toBe('Class 1');
  });

  it('works without a video', async () => {
    const training = { ...base, kind: 'alone', group_name: null, attendee_count: 1, resources: [] };
    const view = await renderTraining(ctx({ getTraining: vi.fn().mockResolvedValue(training) }), { params: { id: 'o1' } });
    expect(view.querySelector('iframe')).toBeNull();
    expect(view.querySelector('h1').textContent).toBe('Alone');
    expect([...view.querySelectorAll('.tag')].map((tag) => tag.textContent)).toEqual(['⏱ 1h 26m']);
  });

  it('rates rounds and saves notes from the bottom bar', async () => {
    const training = {
      getTraining: vi.fn().mockResolvedValue(base),
      saveRoundAssessments: vi.fn().mockResolvedValue({ status: 'saved' }),
      saveNotes: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const view = await renderTraining(ctx(training), { params: { id: 'o1' } });
    document.body.replaceChildren(view);
    view.querySelector('button[data-action="rate"]').click();
    const form = document.querySelector('[role="dialog"] [data-round-rating-form="r1"]');
    form.querySelector('input[value="easy"]').click();
    form.requestSubmit();
    await vi.waitFor(() => expect(training.saveRoundAssessments).toHaveBeenCalledWith(expect.objectContaining({ participationId: 'p1', roundId: 'r1' })));
    view.querySelector('button[data-action="notes"]').click();
    const notes = document.querySelector('[role="dialog"] textarea');
    notes.value = 'Better hips';
    document.querySelector('[role="dialog"] form').requestSubmit();
    await vi.waitFor(() => expect(training.saveNotes).toHaveBeenCalledWith({ participationId: 'p1', notes: 'Better hips' }));
  });

  it('explains a training that is not available', async () => {
    const training = { getTraining: vi.fn().mockRejectedValue(new AppError('authorization', 'not_authorized')) };
    const context = ctx(training);
    const view = await renderTraining(context, { params: { id: 'someone-else' } });
    expect(view.textContent).toContain("This training isn't available.");
    view.querySelector('button[aria-label="Back"]').click();
    expect(context.back).toHaveBeenCalledWith('/');
  });

  it('shows resources still waiting to sync on the page', async () => {
    localStorage.setItem('roda.pendingResources:o1', JSON.stringify([
      { occurrenceId: 'o1', kind: 'summary', title: '', url: null, body: '# Notes' },
    ]));
    const training = { ...base, can_add_resources: true };
    const view = await renderTraining(ctx({ getTraining: vi.fn().mockResolvedValue(training), addResource: vi.fn() }), { params: { id: 'o1' } });
    expect(view.querySelector('[data-pending-resources]').textContent).toBe('1 resource waiting to sync.');
    expect(view.querySelector('button[data-action="retry-resources"]')).not.toBeNull();
    localStorage.clear();
  });
});

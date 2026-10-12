// tests/unit/log-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { renderLog } from '../../src/app/screens/log.js';
import { openSheet } from '../../src/app/shell/sheet.js';

function ctx(training, extra = {}) {
  return {
    document, window, i18n: createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } }),
    profile: { id: 'p1' }, timezone: 'Europe/Lisbon', services: { training, repertoire: { list: vi.fn().mockResolvedValue([{ id: 's1', title: 'Flow', source_text: '10x (armada, au)' }]) } },
    navigate: vi.fn(), back: vi.fn(), today: () => '2026-10-11', getTermMappings: () => [],
    openSheet: (options) => openSheet({ document, ...options }),
    now: () => new Date('2026-10-11T12:00:00Z'), ...extra,
  };
}

function send(text) {
  const input = document.querySelector('textarea[aria-label="Write a round"]');
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('log screen', () => {
  beforeEach(() => { localStorage.clear(); });

  it('turns chat messages into rounds and saves once', async () => {
    let finish;
    const training = {
      createIdempotencyKey: vi.fn(() => 'key-1'),
      recordAloneTraining: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
      addResource: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const context = ctx(training);
    const view = await renderLog(context);
    document.body.replaceChildren(view);
    send('ginga 10 min');
    send('Round 2: 10x (armada, au)\nRound 3: 3x negativa');
    expect([...document.querySelectorAll('textarea[data-round-text]')].map((input) => input.value))
      .toEqual(['ginga 10 min', '10x (armada, au)', '3x negativa']);
    document.querySelector('button[data-chip="yesterday"]').click();
    const save = document.querySelector('button[data-action="save"]');
    save.click();
    save.click();
    finish({ status: 'completed', occurrence_id: 'o1', participation_id: 'p' });
    await vi.waitFor(() => expect(context.navigate).toHaveBeenCalledWith('/training/o1'));
    expect(training.recordAloneTraining).toHaveBeenCalledTimes(1);
    expect(training.recordAloneTraining).toHaveBeenCalledWith(expect.objectContaining({
      localDate: '2026-10-10', durationMinutes: 45, idempotencyKey: 'key-1', timezone: 'Europe/Lisbon',
      occurredAt: '2026-10-10T11:15:00.000Z',
      rounds: [expect.objectContaining({ source_text: 'ginga 10 min' }), expect.anything(), expect.anything()],
    }));
    expect(localStorage.getItem('roda.logDraft:p1')).toBeNull();
  });

  it('restores a draft after reload with the same request key', async () => {
    const training = { createIdempotencyKey: vi.fn(() => 'key-1'), recordAloneTraining: vi.fn().mockRejectedValue(new Error('offline')) };
    let view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    send('ginga 10 min');
    await vi.waitFor(() => expect(localStorage.getItem('roda.logDraft:p1')).not.toBeNull());
    training.createIdempotencyKey.mockReturnValue('key-2');
    view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    expect(document.querySelector('textarea[data-round-text]').value).toBe('ginga 10 min');
    document.querySelector('button[data-action="save"]').click();
    await vi.waitFor(() => expect(document.querySelector('.log-status').textContent).toBe('offline'));
    expect(training.recordAloneTraining).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'key-1' }));
    expect(document.querySelector('textarea[data-round-text]').value).toBe('ginga 10 min');
  });

  it('refuses to save without rounds', async () => {
    const training = { createIdempotencyKey: vi.fn(() => 'k'), recordAloneTraining: vi.fn() };
    const view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    document.querySelector('button[data-action="save"]').click();
    expect(document.querySelector('.log-status').textContent).toBe('Write what you trained in at least one round.');
    expect(training.recordAloneTraining).not.toHaveBeenCalled();
  });

  it('adds resources and queues the ones that fail after saving', async () => {
    const training = {
      createIdempotencyKey: vi.fn(() => 'k'),
      recordAloneTraining: vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o7' }),
      addResource: vi.fn().mockResolvedValueOnce({ status: 'saved' }).mockRejectedValueOnce(new Error('offline')),
    };
    const context = ctx(training);
    const view = await renderLog(context);
    document.body.replaceChildren(view);
    send('ginga');
    document.querySelector('button[data-chip="link"]').click();
    let sheet = document.querySelector('[role="dialog"]');
    sheet.querySelector('input[name="url"]').value = 'https://youtu.be/VAI3JUKTwz0';
    sheet.querySelector('form').requestSubmit();
    document.querySelector('button[data-chip="summary"]').click();
    sheet = document.querySelector('[role="dialog"]');
    sheet.querySelector('textarea[name="body"]').value = '# Notes';
    sheet.querySelector('form').requestSubmit();
    expect([...document.querySelectorAll('.log-resource')].map((chip) => chip.textContent)).toEqual(['🎥 Video ×', '📄 Summary ×']);
    document.querySelector('button[data-action="save"]').click();
    await vi.waitFor(() => expect(context.navigate).toHaveBeenCalledWith('/training/o7'));
    expect(JSON.parse(localStorage.getItem('roda.pendingResources:o7'))).toEqual([
      { occurrenceId: 'o7', kind: 'summary', title: '', url: null, body: '# Notes' },
    ]);
  });

  it('inserts a saved sequence as a round', async () => {
    const view = await renderLog(ctx({ createIdempotencyKey: () => 'k' }));
    document.body.replaceChildren(view);
    document.querySelector('button[data-chip="saved"]').click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] button[data-sequence="s1"]')).not.toBeNull());
    document.querySelector('[role="dialog"] button[data-sequence="s1"]').click();
    expect(document.querySelector('textarea[data-round-text]').value).toBe('10x (armada, au)');
  });

  it('sends the start-time chip, which follows the duration until edited', async () => {
    const training = {
      createIdempotencyKey: vi.fn(() => 'k'),
      recordAloneTraining: vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o2' }),
      addResource: vi.fn(),
    };
    const view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    const start = document.querySelector('input[data-chip="start"]');
    expect(start.getAttribute('aria-label')).toBe('Start time');
    expect(start.value).toBe('12:15');
    const duration = document.querySelector('select[aria-label="Duration"]');
    duration.value = '90';
    duration.dispatchEvent(new Event('change', { bubbles: true }));
    expect(start.value).toBe('11:30');
    start.value = '07:30';
    start.dispatchEvent(new Event('change', { bubbles: true }));
    duration.value = '60';
    duration.dispatchEvent(new Event('change', { bubbles: true }));
    expect(start.value).toBe('07:30');
    const date = document.querySelector('input[aria-label="Training date"]');
    date.value = '2026-10-09';
    date.dispatchEvent(new Event('change', { bubbles: true }));
    send('ginga 10 min');
    document.querySelector('button[data-action="save"]').click();
    await vi.waitFor(() => expect(training.recordAloneTraining).toHaveBeenCalledWith(expect.objectContaining({
      localDate: '2026-10-09', durationMinutes: 60, occurredAt: '2026-10-09T06:30:00.000Z',
    })));
  });

  it('refuses a start time later than now and keeps the draft', async () => {
    const training = { createIdempotencyKey: vi.fn(() => 'k'), recordAloneTraining: vi.fn() };
    const view = await renderLog(ctx(training));
    document.body.replaceChildren(view);
    const start = document.querySelector('input[data-chip="start"]');
    start.value = '23:30';
    start.dispatchEvent(new Event('change', { bubbles: true }));
    send('ginga 10 min');
    document.querySelector('button[data-action="save"]').click();
    expect(document.querySelector('.log-status').textContent).toBe('That start time is still ahead. Choose a time that has passed.');
    expect(training.recordAloneTraining).not.toHaveBeenCalled();
    expect(document.querySelector('textarea[data-round-text]').value).toBe('ginga 10 min');
  });
});

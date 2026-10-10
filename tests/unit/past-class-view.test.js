// tests/unit/past-class-view.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createPastClassView } from '../../src/app/ui/past-class-view.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function setup(overrides = {}) {
  const trainingService = {
    createIdempotencyKey: vi.fn(() => 'past-key'),
    recordPastClass: vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o1' }),
    addResource: vi.fn().mockResolvedValue({ status: 'saved' }),
    ...overrides,
  };
  const onRecorded = vi.fn();
  const view = createPastClassView({
    document, i18n, trainingService, timezone: 'Europe/Lisbon',
    getContext: () => ({ groupId: 'g1' }),
    getStudents: () => [{ profileId: 's-direct', name: 'Direct Ana', connectionId: 'c1', groupId: null }],
    getRoster: () => [
      { profile_id: 's1', display_name: 'Bia', access_level: 'member' },
      { profile_id: 's2', display_name: 'Caio', access_level: 'member' },
      { profile_id: 'coach', display_name: 'Coach', access_level: 'coach' },
    ],
    getTermMappings: () => [],
    onRecorded,
  });
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = function showModal() { this.open = true; };
    dialog.close = function close() { this.open = false; };
  }
  return { view, trainingService, onRecorded };
}

function fill(label, value) {
  const input = [...document.querySelectorAll('label')].find((node) => node.firstChild?.textContent === label).querySelector('input, select, textarea');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('past class view', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('records a group class with attendees, rounds, and resources', async () => {
    const { view, trainingService, onRecorded } = setup();
    view.open();
    fill('Class date', '2026-09-11');
    fill('Start time', '14:14');
    fill('Duration in minutes', '77');
    document.querySelector('input[name="attendee"][value="s2"]').click();
    const round = document.querySelector('textarea[aria-label="Round 1 text"]');
    round.value = 'ginga, armada';
    round.dispatchEvent(new Event('input', { bubbles: true }));
    fill('Video link', 'https://www.youtube.com/watch?v=oMmctHNRyBg');
    fill('Summary', '# Class 1');
    document.querySelector('form[data-past-class-form]').requestSubmit();
    await vi.waitFor(() => expect(onRecorded).toHaveBeenCalled());
    expect(trainingService.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'group', groupId: 'g1', localDate: '2026-09-11', occurredAt: '2026-09-11T13:14:00.000Z',
      timezone: 'Europe/Lisbon', durationMinutes: 77, idempotencyKey: 'past-key',
      attendees: [{ profileId: 's1', durationMinutes: 77 }],
      rounds: [expect.objectContaining({ source_text: 'ginga, armada' })],
    }));
    expect(trainingService.addResource.mock.calls.map(([input]) => input.kind)).toEqual(['video', 'summary']);
  });

  it('records a personal class through the student connection', async () => {
    const { view, trainingService } = setup();
    view.open();
    fill('Class type', 'personal_class');
    fill('Class date', '2026-09-15');
    fill('Start time', '13:46');
    fill('Duration in minutes', '85');
    document.querySelector('form[data-past-class-form]').requestSubmit();
    await vi.waitFor(() => expect(trainingService.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'personal_class', studentProfileId: 's-direct', connectionId: 'c1', groupId: null,
    })));
  });

  it('keeps entries and reuses the request key after a failure', async () => {
    const { view, trainingService } = setup({
      recordPastClass: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'completed', occurrence_id: 'o1' }),
    });
    view.open();
    fill('Class date', '2026-09-11');
    fill('Start time', '14:14');
    fill('Duration in minutes', '60');
    const form = document.querySelector('form[data-past-class-form]');
    form.requestSubmit();
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent).toBe('offline'));
    form.requestSubmit();
    await vi.waitFor(() => expect(trainingService.recordPastClass).toHaveBeenCalledTimes(2));
    expect(trainingService.recordPastClass.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['past-key', 'past-key']);
  });

  it('does not re-add resources that already saved when retrying', async () => {
    const { view, trainingService } = setup({
      addResource: vi.fn()
        .mockResolvedValueOnce({ status: 'saved' })
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ status: 'saved' }),
    });
    view.open();
    fill('Class date', '2026-09-11');
    fill('Start time', '14:14');
    fill('Duration in minutes', '60');
    fill('Video link', 'https://youtu.be/x');
    fill('Summary', '# Notes');
    const form = document.querySelector('form[data-past-class-form]');
    form.requestSubmit();
    await vi.waitFor(() => expect(trainingService.addResource).toHaveBeenCalledTimes(2));
    form.requestSubmit();
    await vi.waitFor(() => expect(trainingService.addResource).toHaveBeenCalledTimes(3));
    expect(trainingService.addResource.mock.calls.map(([input]) => input.kind)).toEqual(['video', 'summary', 'summary']);
  });

  it('checks resource links before recording the class', async () => {
    const { view, trainingService } = setup();
    view.open();
    fill('Class date', '2026-09-11');
    fill('Start time', '14:14');
    fill('Duration in minutes', '60');
    fill('Video link', 'http://not-secure');
    const form = document.querySelector('form[data-past-class-form]');
    form.requestSubmit();
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent)
      .toBe('Paste a link that starts with https://.'));
    expect(trainingService.recordPastClass).not.toHaveBeenCalled();
  });
});

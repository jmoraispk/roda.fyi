// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createTrainingCalendarView } from '../../src/app/ui/training-calendar-view.js';

function fixture() {
  document.body.innerHTML = `
    <section id="trainingCalendarPanel">
      <button id="calendarPreviousMonth" type="button"></button>
      <h2 id="calendarMonthLabel"></h2>
      <button id="calendarNextMonth" type="button"></button>
      <div id="trainingCalendar"></div>
      <p id="calendarStatus"></p>
      <section id="calendarMonthSummary"></section>
      <div id="calendarLegend"></div>
      <section id="trainingDayDetail"></section>
      <button id="recordAloneTraining" type="button"></button>
    </section>
    <dialog id="aloneTrainingDialog">
      <form id="aloneTrainingForm">
        <button type="button" data-close-alone></button>
        <h1 id="aloneTrainingTitle"></h1>
        <label for="aloneDate" id="aloneDateLabel"></label>
        <input id="aloneDate" type="date" required>
        <label for="aloneDuration" id="aloneDurationLabel"></label>
        <input id="aloneDuration" type="number" required>
        <label for="aloneNotes" id="aloneNotesLabel"></label>
        <textarea id="aloneNotes"></textarea>
        <div id="aloneRounds"></div>
        <button id="addAloneRound" type="button"></button>
        <p id="aloneTrainingStatus"></p>
        <button id="saveAloneTraining" type="submit"></button>
      </form>
    </dialog>`;
  const dialog = document.querySelector('#aloneTrainingDialog');
  dialog.showModal = vi.fn(() => { dialog.open = true; });
  dialog.close = vi.fn(() => { dialog.open = false; });
}

function i18n(locale = 'en') {
  const storage = { getItem: () => locale, setItem: vi.fn() };
  return createDashboardI18n({
    document, storage, navigator: { languages: [locale] },
  });
}

function service(overrides = {}) {
  return {
    listCalendar: vi.fn().mockResolvedValue([
      { item_id: 'a', local_date: '2026-09-22', kind: 'alone', status: 'completed', duration_minutes: 45 },
      { item_id: 'g', local_date: '2026-09-22', kind: 'group', status: 'scheduled', duration_minutes: 60 },
      { item_id: 'p', local_date: '2026-09-23', kind: 'personal_class', status: 'completed', duration_minutes: 30 },
    ]),
    getDay: vi.fn().mockResolvedValue([{ id: 'a', kind: 'alone', duration_minutes: 45 }]),
    recordAloneTraining: vi.fn().mockResolvedValue({ status: 'completed' }),
    saveNotes: vi.fn().mockResolvedValue({ status: 'saved' }),
    saveAssessment: vi.fn().mockResolvedValue({ status: 'saved' }),
    addFeedback: vi.fn().mockResolvedValue({ status: 'saved' }),
    saveRoundAssessments: vi.fn().mockResolvedValue({ status: 'saved' }),
    listResourceKinds: vi.fn().mockResolvedValue([{ occurrence_id: 'a', kinds: ['summary', 'video'] }]),
    createIdempotencyKey: vi.fn(() => 'request-1'),
    ...overrides,
  };
}

describe('training calendar view', () => {
  beforeEach(fixture);

  it('renders a semantic month grid with completed and upcoming markers', async () => {
    const view = createTrainingCalendarView({
      document, service: service(), i18n: i18n(),
      profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');

    expect(document.querySelector('#trainingCalendar').getAttribute('role')).toBe('grid');
    expect(document.querySelectorAll('[role="gridcell"]')).toHaveLength(35);
    expect(document.querySelector('[data-date="2026-09-22"] [data-kind="alone"]'))
      .not.toBeNull();
    expect(document.querySelector('[data-date="2026-09-22"] [data-kind="group"]')
      .getAttribute('data-status')).toBe('scheduled');
    expect(document.querySelector('[data-date="2026-09-23"] [data-kind="personal_class"]'))
      .not.toBeNull();
    expect(document.querySelector('#calendarMonthSummary').textContent)
      .toContain('2 trainings');
    expect(document.querySelector('#calendarMonthSummary').textContent)
      .toContain('1h 15m');
    expect(document.querySelector('#calendarLegend').textContent)
      .toContain('Alone');
  });

  it('loads selected-day detail and supports arrow-key navigation', async () => {
    const api = service();
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(),
      profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    const day = document.querySelector('[data-date="2026-09-22"]');
    day.focus();
    day.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement.dataset.date).toBe('2026-09-23');
    await view.selectDay('2026-09-22');
    expect(api.getDay).toHaveBeenCalledWith({
      localDate: '2026-09-22', profileId: null,
    });
    expect(document.querySelector('#trainingDayDetail').textContent).toContain('45m');
  });

  it('keeps the Alone form intact after failure and reuses its request key', async () => {
    const api = service({
      recordAloneTraining: vi.fn()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockResolvedValueOnce({ status: 'completed' }),
    });
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(),
      profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    view.openAlone('2026-09-22');
    document.querySelector('#aloneDuration').value = '45';
    document.querySelector('#aloneNotes').value = 'Armada practice';
    const roundText = document.querySelector('textarea[aria-label="Round 1 text"]');
    roundText.value = '10x armada, au';
    roundText.dispatchEvent(new Event('input', { bubbles: true }));

    document.querySelector('#aloneTrainingForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(api.recordAloneTraining).toHaveBeenCalledTimes(1));
    expect(api.recordAloneTraining.mock.calls[0][0].rounds).toEqual([expect.objectContaining({
      source_text: '10x armada, au',
      movements: [
        expect.objectContaining({ movement_key: 'armada', repetitions: 10 }),
        expect.objectContaining({ movement_key: 'au' }),
      ],
    })]);
    expect(document.querySelector('textarea[aria-label="Round 1 text"]').value).toBe('10x armada, au');
    expect(document.querySelector('#aloneNotes').value).toBe('Armada practice');
    expect(document.querySelector('#aloneTrainingDialog').open).toBe(true);

    document.querySelector('#aloneTrainingForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(api.recordAloneTraining).toHaveBeenCalledTimes(2));
    expect(api.recordAloneTraining.mock.calls[0][0].idempotencyKey).toBe('request-1');
    expect(api.recordAloneTraining.mock.calls[1][0].idempotencyKey).toBe('request-1');
    await vi.waitFor(() => expect(api.getDay).toHaveBeenCalledTimes(1));
    expect(document.querySelector('#aloneTrainingDialog').open).toBe(false);
    expect(api.listCalendar).toHaveBeenCalledTimes(2);
    expect(api.getDay).toHaveBeenCalledWith({ localDate: '2026-09-22', profileId: null });
  });

  it('renders Portuguese copy and a useful empty-day state', async () => {
    const view = createTrainingCalendarView({
      document, service: service({ getDay: vi.fn().mockResolvedValue([]) }),
      i18n: i18n('pt'), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    await view.selectDay('2026-09-20');
    expect(document.querySelector('#recordAloneTraining').textContent).toBe('Registar treino sozinho');
    expect(document.querySelector('#trainingDayDetail').textContent)
      .toContain('Nenhum treino neste dia');
  });

  it('clears private details without discarding the visible month', async () => {
    const api = service();
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(),
      profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    await view.selectDay('2026-09-22');
    view.clear();
    expect(document.querySelector('#trainingDayDetail').textContent).toBe('');
    await view.refresh();
    expect(api.listCalendar.mock.lastCall[0]).toMatchObject({
      start: '2026-09-01', endExclusive: '2026-10-01',
    });
  });

  it('saves personal notes and round ratings before refreshing the day', async () => {
    const day = [{
      id: 'a', kind: 'alone', duration_minutes: 45, participation_id: 'participation-1',
      personal_notes: '', rounds: [{
        id: 'round-1', source_text: 'armada, au', sequence: [], ratings: [], planned: [], movements: [],
      }],
    }];
    const api = service({ getDay: vi.fn().mockResolvedValue(day) });
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    await view.selectDay('2026-09-22');
    const notes = document.querySelector('[data-notes-form="participation-1"]');
    notes.elements.notes.value = 'Balance needs work';
    notes.requestSubmit();
    await vi.waitFor(() => expect(api.saveNotes).toHaveBeenCalledWith({
      participationId: 'participation-1', notes: 'Balance needs work',
    }));
    await vi.waitFor(() => expect(document.querySelector('[data-round-rating-form="round-1"]')).not.toBeNull());
    const ratingForm = document.querySelector('[data-round-rating-form="round-1"]');
    ratingForm.querySelector('input[value="hard"]').click();
    ratingForm.requestSubmit();
    await vi.waitFor(() => expect(api.saveRoundAssessments).toHaveBeenCalledWith({
      participationId: 'participation-1', roundId: 'round-1',
      ratings: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard', note: null, from_movement_key: null, to_movement_key: null }],
    }));
    expect(document.querySelector('.round-source').textContent).toBe('armada, au');
  });

  it('refuses to save Alone training without any round text', async () => {
    const api = service();
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    view.openAlone('2026-09-22');
    document.querySelector('#aloneTrainingForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(document.querySelector('#aloneTrainingStatus').textContent)
      .toBe('Write what you trained in at least one round.');
    expect(api.recordAloneTraining).not.toHaveBeenCalled();
  });

  it('pre-fills round cards when logging a saved sequence', async () => {
    const view = createTrainingCalendarView({
      document, service: service(), i18n: i18n(), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    view.openAlone('2026-09-22', { rounds: [{ sourceText: 'armada, au' }] });
    expect(document.querySelector('textarea[aria-label="Round 1 text"]').value).toBe('armada, au');
  });

  it('shows scoped coach feedback and only renders authoring for server-returned contexts', async () => {
    const api = service({ getDay: vi.fn().mockResolvedValue([{
      id: 'occurrence-1', kind: 'personal_class', duration_minutes: 45,
      participation_id: 'participation-1', rounds: [], personal_notes: null,
      feedback: [{
        id: 'feedback-1', coach_name: 'Mestre Lua', group_id: 'group-1',
        body: 'Keep the base lower.', created_at: '2026-09-22T18:10:00Z',
      }],
      feedback_contexts: [{ kind: 'group', id: 'group-1', label: 'Grupo Lua' }],
    }]) });
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(),
      profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
      targetProfileId: 'student-1', canCoach: true,
    });
    await view.selectDay('2026-09-22');

    expect(document.querySelector('#trainingDayDetail').textContent)
      .toContain('Mestre Lua');
    expect(document.querySelector('#trainingDayDetail').textContent)
      .toContain('Grupo Lua');
    const form = document.querySelector('[data-feedback-form]');
    expect([...form.querySelector('select').options].map(({ textContent }) => textContent))
      .toEqual(['Grupo Lua']);
    form.querySelector('textarea').value = 'Better timing today.';
    form.requestSubmit();
    await vi.waitFor(() => expect(api.addFeedback).toHaveBeenCalledWith({
      participationId: 'participation-1', groupId: 'group-1', connectionId: null,
      body: 'Better timing today.',
    }));
  });

  it('does not render coach feedback controls in personal training mode', async () => {
    const api = service({ getDay: vi.fn().mockResolvedValue([{
      id: 'occurrence-1', kind: 'group', duration_minutes: 45,
      participation_id: 'participation-1', rounds: [], feedback: [],
      feedback_contexts: [{ kind: 'group', id: 'group-1', label: 'Grupo Lua' }],
    }]) });
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(),
      profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon', canCoach: false,
    });
    await view.selectDay('2026-09-22');
    expect(document.querySelector('[data-feedback-form]')).toBeNull();
  });

  it('marks days that have class resources', async () => {
    const view = createTrainingCalendarView({
      document, service: service(), i18n: i18n(), profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.loadMonth('2026-09');
    await vi.waitFor(() => expect(document.querySelector('[data-date="2026-09-22"] .resource-icons').textContent).toBe('🎥📄'));
    expect(document.querySelector('[data-date="2026-09-22"]').getAttribute('aria-label')).toContain('Video, Summary');
  });
});

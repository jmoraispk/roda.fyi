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
    document.querySelector('#addAloneRound').click();
    document.querySelector('[data-action="add-movement"]').click();
    document.querySelector('[data-movement-key]').value = 'armada';

    document.querySelector('#aloneTrainingForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(api.recordAloneTraining).toHaveBeenCalledTimes(1));
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

  it('saves personal notes separately and assesses each movement before refreshing the day', async () => {
    const day = [{
      id: 'occurrence-1', kind: 'group', duration_minutes: 60,
      participation_id: 'participation-1', personal_notes: 'Initial note',
      rounds: [{ id: 'round-1', label: 'Flow', movements: [{
        id: 'movement-1', movement_name: 'Armada', assessment: null,
      }] }], feedback: [], feedback_contexts: [],
    }];
    const api = service({ getDay: vi.fn().mockResolvedValue(day) });
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(),
      profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.selectDay('2026-09-22');

    const notes = document.querySelector('[data-notes-form]');
    notes.querySelector('textarea').value = 'My own observation';
    notes.requestSubmit();
    await vi.waitFor(() => expect(api.saveNotes).toHaveBeenCalledWith({
      participationId: 'participation-1', notes: 'My own observation',
    }));

    await vi.waitFor(() => expect(api.getDay).toHaveBeenCalledTimes(2));
    const assessment = document.querySelector('[data-assessment-form="movement-1"]');
    assessment.querySelector('[value="hard"]').checked = true;
    assessment.querySelector('textarea').value = 'Balance needs work';
    assessment.requestSubmit();
    await vi.waitFor(() => expect(api.saveAssessment).toHaveBeenCalledWith({
      participationId: 'participation-1', movementId: 'movement-1',
      difficulty: 'hard', note: 'Balance needs work',
    }));
    expect(api.getDay).toHaveBeenCalledTimes(3);
  });

  it('keeps the selected day visible after a failed assessment', async () => {
    const api = service({
      getDay: vi.fn().mockResolvedValue([{
        id: 'occurrence-1', kind: 'alone', duration_minutes: 30,
        participation_id: 'participation-1', rounds: [{ movements: [{
          id: 'movement-1', movement_name: 'Ginga', assessment: null,
        }] }], feedback: [], feedback_contexts: [],
      }]),
      saveAssessment: vi.fn().mockRejectedValue(new TypeError('offline')),
    });
    const view = createTrainingCalendarView({
      document, service: api, i18n: i18n(),
      profile: { id: 'practitioner-1' }, timezone: 'Europe/Lisbon',
    });
    await view.selectDay('2026-09-22');
    const assessment = document.querySelector('[data-assessment-form="movement-1"]');
    assessment.querySelector('[value="okay"]').checked = true;
    assessment.requestSubmit();
    await vi.waitFor(() => expect(assessment.querySelector('[role="status"]').textContent)
      .toContain('offline'));
    expect(document.querySelector('#trainingDayDetail').textContent).toContain('Ginga');
    expect(api.getDay).toHaveBeenCalledTimes(1);
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
});

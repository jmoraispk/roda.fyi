// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/app/errors.js';
import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import {
  createCoachingTrainingView,
  scheduledInstant,
} from '../../src/app/ui/coaching-training-view.js';

function fixture() {
  document.body.innerHTML = `
    <section id="coachingTrainingWorkspace"></section>
    <section id="coachingStudentsPanel"></section>
    <p id="coachingTrainingStatus"></p>
    <dialog id="workoutPlanDialog"><form id="workoutPlanForm"></form></dialog>
    <dialog id="scheduleTrainingDialog"><form id="scheduleTrainingForm"></form></dialog>`;
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''));
    dialog.close = vi.fn(() => dialog.removeAttribute('open'));
  }
}

function services(overrides = {}) {
  const trainingService = {
    listPlans: vi.fn().mockResolvedValue([{
      plan_id: 'plan-1', version_id: 'version-1', state: 'published', title: 'Kick flow',
      expected_duration_minutes: 45, rounds: [{
        label: 'Flow', repetitions: 2, rest_seconds: 30,
        movements: [{ movement_key: 'armada', movement_name: 'Armada', side: 'both' }],
      }],
    }]),
    createPlan: vi.fn().mockResolvedValue({
      status: 'created', plan_id: 'plan-2', version_id: 'version-2', updated_at: 'now',
    }),
    savePlanDraft: vi.fn().mockResolvedValue({ status: 'saved' }),
    publishPlan: vi.fn().mockResolvedValue({ status: 'published', version_id: 'version-2' }),
    scheduleGroupTraining: vi.fn().mockResolvedValue({ status: 'scheduled' }),
    schedulePersonalClass: vi.fn().mockResolvedValue({ status: 'scheduled' }),
    listCalendar: vi.fn().mockResolvedValue([{
      item_id: 'schedule-1', item_type: 'scheduled', kind: 'group', status: 'scheduled',
      local_date: '2026-09-25', starts_at: '2026-09-25T17:30:00Z',
      duration_minutes: 60, group_id: 'group-1', plan_title: 'Kick flow',
    }]),
    completeGroupTraining: vi.fn().mockResolvedValue({ status: 'completed' }),
    completePersonalClass: vi.fn().mockResolvedValue({ status: 'completed' }),
    createIdempotencyKey: vi.fn(() => 'completion-request-1'),
    ...overrides.trainingService,
  };
  const connectionService = {
    listMine: vi.fn().mockResolvedValue([{
      connection_id: 'connection-1', connection_kind: 'direct', state: 'active',
      coach_profile_id: 'coach-1', student_profile_id: 'student-direct',
      student_display_name: 'Direct Ana',
    }, {
      connection_id: null, connection_kind: 'group', state: 'active',
      coach_profile_id: 'coach-1', student_profile_id: 'student-group',
      student_display_name: 'Group Bia', group_id: 'group-1', group_name: 'Grupo Lua',
    }]),
    ...overrides.connectionService,
  };
  const groupService = {
    listRoster: vi.fn().mockResolvedValue([
      { profile_id: 'student-group', display_name: 'Group Bia', access_level: 'member' },
    ]),
    ...overrides.groupService,
  };
  return { trainingService, connectionService, groupService };
}

function createView(overrideServices = {}, options = {}) {
  const api = services(overrideServices);
  const onAccessRevoked = vi.fn();
  const view = createCoachingTrainingView({
    document,
    ...api,
    timezone: 'Europe/Lisbon',
    profileId: 'coach-1',
    i18n: createDashboardI18n({
      document,
      storage: { getItem: () => options.locale ?? 'en', setItem: vi.fn() },
      navigator: { languages: [options.locale ?? 'en'] },
    }),
    onAccessRevoked,
    ...options,
  });
  return { view, api, onAccessRevoked };
}

beforeEach(fixture);

describe('coaching training view', () => {
  it('converts scheduled local time to UTC and rejects a daylight-saving gap', () => {
    expect(scheduledInstant('2026-09-25', '18:30', 'Europe/Lisbon'))
      .toBe('2026-09-25T17:30:00.000Z');
    expect(() => scheduledInstant('2026-03-29', '01:30', 'Europe/Lisbon'))
      .toThrow('does not exist');
  });

  it('shows scheduling controls only for an active coach context and clears them on mode change', async () => {
    const { view } = createView();
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();

    expect(document.querySelector('[data-action="new-plan"]')).not.toBeNull();
    expect(document.querySelector('[data-action="schedule-group"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Direct Ana');
    expect(document.body.textContent).toContain('Group Bia');

    view.setContext({ mode: 'training', groupId: null, isCoach: true });
    expect(document.querySelector('#coachingTrainingWorkspace').textContent).toBe('');
    expect(document.querySelector('#workoutPlanDialog').open).toBe(false);
  });

  it('composes text rounds with planned difficulty, publishes, and makes the version read-only', async () => {
    const { view, api } = createView();
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();
    view.openPlanEditor();

    document.querySelector('[name="planTitle"]').value = '  Armada ladder  ';
    document.querySelector('[name="planDuration"]').value = '50';
    document.querySelector('[data-action="add-round"]').click();
    const roundText = document.querySelector('textarea[aria-label="Round 1 text"]');
    roundText.value = '8x armada, godeme';
    roundText.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-round-difficulty] input[value="hard"]').click();

    document.querySelector('#workoutPlanForm').requestSubmit(
      document.querySelector('[data-action="save-plan"]'),
    );
    await vi.waitFor(() => expect(api.trainingService.createPlan).toHaveBeenCalledTimes(1));
    expect(api.trainingService.createPlan).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Armada ladder', durationMinutes: 50, groupId: 'group-1',
      rounds: [expect.objectContaining({
        source_text: '8x armada, godeme',
        movements: [
          expect.objectContaining({ movement_key: 'armada', repetitions: 8 }),
          expect.objectContaining({ movement_key: 'godeme', catalogued: true }),
        ],
        ratings: [expect.objectContaining({ segment_key: 'r', difficulty: 'hard' })],
      })],
    }));

    document.querySelector('[data-action="publish-plan"]').click();
    await vi.waitFor(() => expect(api.trainingService.publishPlan).toHaveBeenCalledWith('plan-2'));
    expect(document.querySelector('[name="planTitle"]').disabled).toBe(true);
    expect(document.querySelector('#workoutPlanForm [data-action="add-round"]')).toBeNull();
    expect(document.querySelector('#workoutPlanForm .round-source').textContent).toBe('8x armada, godeme');
  });

  it('shows legacy plan movements as round text', async () => {
    const { view } = createView({
      trainingService: {
        listPlans: vi.fn().mockResolvedValue([{
          plan_id: 'legacy', version_id: 'v1', title: 'Old plan', state: 'draft',
          expected_duration_minutes: 30, rounds: [{ id: 'r1', movements: [
            { movement_key: 'armada', movement_name: 'Armada', repetitions: 10 },
            { movement_key: 'au', movement_name: 'Aú' },
          ] }],
        }]),
      },
    });
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();
    document.querySelector('[data-action="edit-plan"][data-value="legacy"]').click();
    expect(document.querySelector('textarea[aria-label="Round 1 text"]').value).toBe('10x Armada, Aú');
  });

  it('schedules hidden group training and direct or group-derived personal classes', async () => {
    const { view, api } = createView();
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();

    view.openGroupSchedule('version-1');
    document.querySelector('[name="scheduleDate"]').value = '2026-09-25';
    document.querySelector('[name="scheduleTime"]').value = '18:30';
    document.querySelector('[name="scheduleVisible"]').checked = false;
    document.querySelector('#scheduleTrainingForm').requestSubmit();
    await vi.waitFor(() => expect(api.trainingService.scheduleGroupTraining).toHaveBeenCalledWith(
      expect.objectContaining({
        planVersionId: 'version-1', groupId: 'group-1', localDate: '2026-09-25',
        timezone: 'Europe/Lisbon', visibleInAdvance: false,
        startsAt: '2026-09-25T17:30:00.000Z',
      }),
    ));

    view.openPersonalSchedule('version-1', 'student-direct');
    document.querySelector('[name="scheduleDate"]').value = '2026-09-26';
    document.querySelector('[name="scheduleTime"]').value = '10:00';
    document.querySelector('#scheduleTrainingForm').requestSubmit();
    await vi.waitFor(() => expect(api.trainingService.schedulePersonalClass).toHaveBeenCalledWith(
      expect.objectContaining({
        studentProfileId: 'student-direct', connectionId: 'connection-1', groupId: null,
      }),
    ));

    view.openPersonalSchedule('version-1', 'student-group');
    document.querySelector('[name="scheduleDate"]').value = '2026-09-27';
    document.querySelector('[name="scheduleTime"]').value = '11:00';
    document.querySelector('#scheduleTrainingForm').requestSubmit();
    await vi.waitFor(() => expect(api.trainingService.schedulePersonalClass).toHaveBeenCalledWith(
      expect.objectContaining({
        studentProfileId: 'student-group', connectionId: null, groupId: 'group-1',
      }),
    ));
  });

  it('keeps plan form values after a retryable failure', async () => {
    const { view } = createView({
      trainingService: { createPlan: vi.fn().mockRejectedValue(new TypeError('offline')) },
    });
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();
    view.openPlanEditor();
    document.querySelector('[name="planTitle"]').value = 'Do not lose me';
    document.querySelector('[data-action="add-round"]').click();
    const roundText = document.querySelector('textarea[aria-label="Round 1 text"]');
    roundText.value = '8x armada, godeme';
    roundText.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#workoutPlanForm').requestSubmit();

    await vi.waitFor(() => expect(document.querySelector('#workoutPlanForm .profile-status').textContent).not.toBe(''));
    expect(document.querySelector('#workoutPlanDialog').open).toBe(true);
    expect(document.querySelector('[name="planTitle"]').value).toBe('Do not lose me');
    expect(document.querySelector('textarea[aria-label="Round 1 text"]').value).toBe('8x armada, godeme');
  });

  it('suppresses stale loads and clears private data when access is revoked', async () => {
    let finishOld;
    const oldPlans = new Promise((resolve) => { finishOld = resolve; });
    const { view, onAccessRevoked } = createView({
      trainingService: {
        listPlans: vi.fn((groupId) => groupId === 'group-1'
          ? oldPlans
          : Promise.reject(new AppError('authorization', 'not_authorized'))),
      },
    });
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    const oldLoad = view.load();
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-2', isCoach: true });
    await view.load();
    finishOld([{ plan_id: 'old-plan', title: 'Old private plan' }]);
    await oldLoad;

    expect(document.body.textContent).not.toContain('Old private plan');
    expect(document.querySelector('#coachingTrainingWorkspace').textContent).toBe('');
    expect(onAccessRevoked).toHaveBeenCalledWith('group-2');
  });

  it('renders scheduled work without counting it and confirms selected attendance with overrides', async () => {
    const { view, api } = createView();
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();

    const schedule = document.querySelector('[data-schedule-id="schedule-1"]');
    expect(schedule.textContent).toContain('Awaiting confirmation');
    expect(schedule.textContent).not.toContain('Completed');
    schedule.querySelector('[data-action="confirm-training"]').click();

    const form = document.querySelector('[data-completion-form]');
    expect(form.querySelectorAll('[name="attendee"]:checked')).toHaveLength(1);
    form.querySelector('[name="completionDuration"]').value = '60';
    form.querySelector('[data-attendee-duration="student-group"]').value = '45';
    form.requestSubmit();

    await vi.waitFor(() => expect(api.trainingService.completeGroupTraining).toHaveBeenCalledWith({
      scheduleId: 'schedule-1', durationMinutes: 60,
      attendees: [{ profileId: 'student-group', durationMinutes: 45 }],
      idempotencyKey: 'completion-request-1',
    }));
  });

  it('reuses a completion request key on retry and preserves attendance after membership changes', async () => {
    const completion = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new AppError('validation', 'invalid_attendee'))
      .mockResolvedValueOnce({ status: 'completed' });
    const { view, api } = createView({
      trainingService: { completeGroupTraining: completion },
    });
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();
    document.querySelector('[data-action="confirm-training"]').click();
    const form = document.querySelector('[data-completion-form]');
    form.querySelector('[data-attendee-duration="student-group"]').value = '35';

    form.requestSubmit();
    await vi.waitFor(() => expect(completion).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent)
      .toContain('offline'));
    form.requestSubmit();
    await vi.waitFor(() => expect(completion).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent)
      .toContain('membership changed'));

    expect(completion.mock.calls[0][0].idempotencyKey).toBe('completion-request-1');
    expect(completion.mock.calls[1][0].idempotencyKey).toBe('completion-request-1');
    expect(form.querySelector('[name="attendee"]').checked).toBe(true);
    expect(form.querySelector('[data-attendee-duration="student-group"]').value).toBe('35');
    expect(api.trainingService.createIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('clears an open completion when authorization is revoked', async () => {
    const { view, onAccessRevoked } = createView({
      trainingService: {
        completeGroupTraining: vi.fn().mockRejectedValue(
          new AppError('authorization', 'not_authorized'),
        ),
      },
    });
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();
    document.querySelector('[data-action="confirm-training"]').click();
    document.querySelector('[data-completion-form]').requestSubmit();

    await vi.waitFor(() => expect(onAccessRevoked).toHaveBeenCalledWith('group-1'));
    expect(document.querySelector('#coachingTrainingWorkspace').textContent).toBe('');
    expect(document.querySelector('[data-completion-form]').textContent).toBe('');
    expect(document.querySelector('[aria-label="Confirm training"]').open).toBe(false);
  });

  it('renders planning, scheduling, and confirmation controls in Portuguese', async () => {
    const { view } = createView({}, { locale: 'pt' });
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();

    expect(document.body.textContent).toContain('Planeamento do treinador');
    expect(document.querySelector('[data-action="new-plan"]').textContent)
      .toBe('Criar plano de treino');
    document.querySelector('[data-action="schedule-group"]').click();
    expect(document.querySelector('#scheduleTrainingDialog').textContent)
      .toContain('Agendar treino de grupo');
    document.querySelector('[data-action="close-schedule"]').click();
    document.querySelector('[data-action="confirm-training"]').click();
    expect(document.querySelector('[data-completion-form]').textContent)
      .toContain('Confirmar treino concluído');
  });
});

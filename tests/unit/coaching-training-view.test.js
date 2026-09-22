// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/app/errors.js';
import {
  createCoachingTrainingView,
  scheduledInstant,
} from '../../src/app/ui/coaching-training-view.js';

function fixture() {
  document.body.innerHTML = `
    <section id="coachingTrainingWorkspace"></section>
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

  it('edits ordered rounds, saves a draft, publishes it, and makes the published version read-only', async () => {
    const { view, api } = createView();
    view.setContext({ mode: 'coaching', activeTab: 'schedule', groupId: 'group-1', isCoach: true });
    await view.load();
    view.openPlanEditor();

    document.querySelector('[name="planTitle"]').value = '  Armada ladder  ';
    document.querySelector('[name="planDuration"]').value = '50';
    document.querySelector('[data-action="add-round"]').click();
    document.querySelector('[data-action="add-round"]').click();
    const rounds = document.querySelectorAll('[data-plan-round]');
    rounds[0].querySelector('[name="roundLabel"]').value = 'First';
    rounds[1].querySelector('[name="roundLabel"]').value = 'Second';
    rounds[1].querySelector('[data-action="move-round-up"]').click();
    document.querySelector('[data-plan-round] [data-action="add-plan-movement"]').click();
    document.querySelector('[data-plan-movement] [name="movementName"]').value = 'Armada';
    document.querySelector('[data-plan-movement] [name="movementRepetitions"]').value = '8';
    document.querySelector('[data-plan-round] [data-action="add-plan-movement"]').click();
    const movements = document.querySelectorAll('[data-plan-movement]');
    movements[1].querySelector('[name="movementName"]').value = 'Godeme';
    movements[1].querySelector('[data-action="move-movement-up"]').click();

    document.querySelector('#workoutPlanForm').requestSubmit(
      document.querySelector('[data-action="save-plan"]'),
    );
    await vi.waitFor(() => expect(api.trainingService.createPlan).toHaveBeenCalledTimes(1));
    expect(api.trainingService.createPlan.mock.calls[0][0]).toMatchObject({
      title: 'Armada ladder', durationMinutes: 50, groupId: 'group-1',
      rounds: [{
        label: 'Second',
        movements: [{ movement_name: 'Godeme' }, { movement_name: 'Armada' }],
      }, { label: 'First' }],
    });

    document.querySelector('[data-action="publish-plan"]').click();
    await vi.waitFor(() => expect(api.trainingService.publishPlan).toHaveBeenCalledWith('plan-2'));
    expect(document.querySelector('[name="planTitle"]').disabled).toBe(true);
    expect(document.querySelector('[data-action="add-round"]')).toBeNull();
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
    document.querySelector('[data-plan-round] [data-action="add-plan-movement"]').click();
    document.querySelector('[data-plan-movement] [name="movementName"]').value = 'Godeme';
    document.querySelector('#workoutPlanForm').requestSubmit();

    await vi.waitFor(() => expect(document.querySelector('#workoutPlanDialog').open).toBe(true));
    expect(document.querySelector('[name="planTitle"]').value).toBe('Do not lose me');
    expect(document.querySelector('[name="movementName"]').value).toBe('Godeme');
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
});

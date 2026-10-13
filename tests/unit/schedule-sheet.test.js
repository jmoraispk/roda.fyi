// tests/unit/schedule-sheet.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openScheduleSheet } from '../../src/app/screens/schedule-sheet.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

const teaching = {
  plans: [
    { plan_id: 'p1', version_id: 'v1', title: 'Armada ladder', state: 'published' },
    { plan_id: 'p2', version_id: 'v2', title: 'Still a draft', state: 'draft' },
  ],
  groups: [{ id: 'g1', name: 'Grupo Lua' }],
  students: [{ profileId: 'bia', name: 'Bia Santos', connectionId: 'c1', groupId: 'g1' }],
};

async function sheetForm() {
  await vi.waitFor(() => expect(document.querySelector('form.sheet-form')).not.toBeNull());
  return document.querySelector('form.sheet-form');
}

describe('schedule sheet', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('schedules a group class in the local timezone and opens it', async () => {
    const training = { scheduleGroupTraining: vi.fn().mockResolvedValue({ status: 'scheduled', schedule_id: 's9' }), createIdempotencyKey: vi.fn(() => 'sk1') };
    const ctx = appCtx({ services: { training } });
    openScheduleSheet(ctx, { teaching });
    const form = await sheetForm();
    expect([...form.querySelector('select[name="plan"]').options].map((option) => option.textContent)).toEqual(['Armada ladder']);
    expect([...form.querySelector('select[name="who"]').options].map((option) => option.textContent))
      .toEqual(['Group class · Grupo Lua', 'Personal class · Bia Santos']);
    form.querySelector('input[name="date"]').value = '2026-10-14';
    form.querySelector('input[name="time"]').value = '19:00';
    form.requestSubmit();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/class/s9'));
    expect(training.scheduleGroupTraining).toHaveBeenCalledWith({
      planVersionId: 'v1', groupId: 'g1', localDate: '2026-10-14', startsAt: '2026-10-14T18:00:00.000Z',
      timezone: 'Europe/Lisbon', visibleInAdvance: true, idempotencyKey: 'sk1',
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('schedules a personal class through the direct connection', async () => {
    const training = { schedulePersonalClass: vi.fn().mockResolvedValue({ schedule_id: 's10' }), createIdempotencyKey: vi.fn(() => 'sk2') };
    const ctx = appCtx({ services: { training } });
    const onScheduled = vi.fn();
    openScheduleSheet(ctx, { teaching, target: 'student:bia', onScheduled });
    const form = await sheetForm();
    expect(form.querySelector('select[name="who"]').value).toBe('student:bia');
    form.querySelector('input[name="date"]').value = '2026-10-15';
    form.querySelector('input[name="time"]').value = '08:00';
    form.querySelector('input[name="visible"]').checked = false;
    form.requestSubmit();
    await vi.waitFor(() => expect(onScheduled).toHaveBeenCalledWith({ schedule_id: 's10' }));
    expect(training.schedulePersonalClass).toHaveBeenCalledWith({
      planVersionId: 'v1', localDate: '2026-10-15', startsAt: '2026-10-15T07:00:00.000Z', timezone: 'Europe/Lisbon',
      visibleInAdvance: false, studentProfileId: 'bia', groupId: null, connectionId: 'c1', idempotencyKey: 'sk2',
    });
  });

  it('refuses a start in the past', async () => {
    const training = { scheduleGroupTraining: vi.fn() };
    const ctx = appCtx({ services: { training } });
    openScheduleSheet(ctx, { teaching });
    const form = await sheetForm();
    form.querySelector('input[name="date"]').value = '2026-10-11';
    form.querySelector('input[name="time"]').value = '09:00';
    form.requestSubmit();
    expect(form.querySelector('[role="status"]').textContent).toBe('Choose a start time that is still ahead.');
    expect(training.scheduleGroupTraining).not.toHaveBeenCalled();
  });

  it('explains a missing plan and loads the teaching data itself when none is given', async () => {
    const services = {
      training: { listPlans: vi.fn().mockResolvedValue([]) },
      connection: { listMine: vi.fn().mockResolvedValue([]) },
      group: { listMyMemberships: vi.fn().mockResolvedValue([]), listRoster: vi.fn() },
    };
    const ctx = appCtx({ services });
    openScheduleSheet(ctx);
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]').textContent).toContain('Publish a plan first, then schedule it.'));
    document.querySelector('[role="dialog"] [data-action="schedule-help"]').click();
    expect(ctx.navigate).toHaveBeenCalledWith('/me/teaching/plans/new');
  });

  it('retries a timed-out class with the same key and a changed class with a new one', async () => {
    const training = {
      createIdempotencyKey: vi.fn().mockReturnValueOnce('sk1').mockReturnValueOnce('sk2'),
      scheduleGroupTraining: vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue({ status: 'scheduled', schedule_id: 's9' }),
    };
    const ctx = appCtx({ services: { training } });
    openScheduleSheet(ctx, { teaching });
    const form = await sheetForm();
    form.querySelector('input[name="date"]').value = '2026-10-14';
    form.requestSubmit();
    await vi.waitFor(() => expect(training.scheduleGroupTraining).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(form.querySelector('button[type="submit"]').disabled).toBe(false));
    form.requestSubmit();
    await vi.waitFor(() => expect(training.scheduleGroupTraining).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(form.querySelector('button[type="submit"]').disabled).toBe(false));
    form.querySelector('input[name="time"]').value = '20:00';
    form.querySelector('input[name="time"]').dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    await vi.waitFor(() => expect(training.scheduleGroupTraining).toHaveBeenCalledTimes(3));
    expect(training.scheduleGroupTraining.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['sk1', 'sk1', 'sk2']);
  });
});

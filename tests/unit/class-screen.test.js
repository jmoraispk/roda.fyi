// tests/unit/class-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/app/errors.js';
import { renderClass } from '../../src/app/screens/class.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

const base = {
  schedule_id: 's1', kind: 'group', state: 'scheduled', local_date: '2026-10-11', timezone: 'Europe/Lisbon',
  starts_at: '2026-10-11T10:00:00Z', duration_minutes: 60, group_name: 'Grupo Lua', student_name: null,
  plan_id: 'p1', plan_title: 'Armada ladder', instructions: 'Stay loose', occurrence_id: null,
  rounds: [{ source_text: 'ginga 10 min' }, { source_text: '10x (armada, au)' }],
  people: [
    { profile_id: 'bia', display_name: 'Bia Santos' },
    { profile_id: 'caio', display_name: 'Caio Lima' },
    { profile_id: 'duda', display_name: 'Duda Reis' },
  ],
};

async function open(training, data = base) {
  training.getScheduledClass ??= vi.fn().mockResolvedValue(data);
  training.createIdempotencyKey ??= vi.fn(() => 'k1');
  const ctx = appCtx({ services: { training } });
  const view = await renderClass(ctx, { name: 'class', params: { id: data.schedule_id }, query: {} });
  document.body.replaceChildren(view);
  return { ctx, view };
}

describe('class page', () => {
  beforeEach(() => { closeSheet(); });

  it('shows the plan and finishes once for the people marked here', async () => {
    let resolve;
    const training = { completeGroupTraining: vi.fn(() => new Promise((done) => { resolve = done; })) };
    const { ctx, view } = await open(training);
    expect(view.querySelector('h1').textContent).toBe('Group · Grupo Lua');
    expect(view.querySelector('.training-meta').textContent).toContain('You teach · plan: Armada ladder');
    expect([...view.querySelectorAll('.chapter-text')].map((node) => node.textContent)).toEqual(['ginga 10 min', '10x (armada, au)']);
    expect(view.querySelector('a[href="#/me/teaching/plans/p1"]').textContent).toBe('View plan');
    expect(view.textContent).toContain('👥 3 coming');
    view.querySelector('[data-person="duda"]').click();
    expect(view.querySelector('[data-person="duda"]').getAttribute('aria-checked')).toBe('false');
    expect(view.textContent).toContain('👥 2 coming');
    view.querySelector('[data-action="finish"]').click();
    view.querySelector('[data-action="finish"]').click();
    resolve({ status: 'completed', occurrence_id: 'o9' });
    await vi.waitFor(() => expect(ctx.replace).toHaveBeenCalledWith('/training/o9?add=1'));
    expect(training.completeGroupTraining).toHaveBeenCalledTimes(1);
    expect(training.completeGroupTraining).toHaveBeenCalledWith({
      scheduleId: 's1', durationMinutes: 60, idempotencyKey: 'k1',
      attendees: [{ profileId: 'bia', durationMinutes: 60 }, { profileId: 'caio', durationMinutes: 60 }],
    });
  });

  it('refuses to finish a group class with nobody marked', async () => {
    const training = { completeGroupTraining: vi.fn() };
    const { view } = await open(training);
    for (const row of view.querySelectorAll('[data-person]')) row.click();
    view.querySelector('[data-action="finish"]').click();
    expect(view.querySelector('.log-status').textContent).toBe('Mark at least one person who came.');
    expect(training.completeGroupTraining).not.toHaveBeenCalled();
  });

  it('waits for the start, and a personal class needs its student', async () => {
    const later = await open({}, { ...base, starts_at: '2026-10-11T19:00:00Z' });
    expect(later.view.querySelector('[data-action="finish"]').disabled).toBe(true);
    expect(later.view.textContent).toContain('You can finish the class once it starts.');
    const personal = { ...base, kind: 'personal_class', group_name: null, student_name: 'Bia Santos', people: [{ profile_id: 'bia', display_name: 'Bia Santos' }] };
    const training = { completePersonalClass: vi.fn().mockResolvedValue({ occurrence_id: 'o2' }) };
    const { ctx, view } = await open(training, personal);
    expect(view.querySelector('h1').textContent).toBe('Personal class · with Bia Santos');
    view.querySelector('[data-person="bia"]').click();
    expect(view.querySelector('[data-action="finish"]').disabled).toBe(true);
    expect(view.textContent).toContain("Cancel the class if Bia Santos didn't come.");
    view.querySelector('[data-person="bia"]').click();
    view.querySelector('[data-action="finish"]').click();
    await vi.waitFor(() => expect(ctx.replace).toHaveBeenCalledWith('/training/o2?add=1'));
    expect(training.completePersonalClass).toHaveBeenCalledWith({ scheduleId: 's1', durationMinutes: 60, idempotencyKey: 'k1' });
  });

  it('shows a finished class with a link, and refuses classes that are not mine', async () => {
    const { view } = await open({}, { ...base, state: 'completed', occurrence_id: 'o3' });
    expect(view.textContent).toContain('This class was already finished.');
    expect(view.querySelector('a[href="#/training/o3"]')).not.toBeNull();
    expect(view.querySelector('[data-action="finish"]')).toBeNull();
    const denied = await open({ getScheduledClass: vi.fn().mockRejectedValue(new AppError('authorization', 'not_authorized')) });
    expect(denied.view.textContent).toContain("This class isn't available.");
  });

  it('switches to the finished state when another device finished first', async () => {
    const getScheduledClass = vi.fn()
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce({ ...base, state: 'completed', occurrence_id: 'o4' });
    const training = {
      getScheduledClass,
      completeGroupTraining: vi.fn().mockRejectedValue(new AppError('validation', 'duplicate_completion')),
    };
    const { view } = await open(training);
    view.querySelector('[data-action="finish"]').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('This class was already finished.'));
    expect(document.querySelector('a[href="#/training/o4"]')).not.toBeNull();
  });

  it('cancels with a reason', async () => {
    const training = { cancelScheduledTraining: vi.fn().mockResolvedValue({ status: 'cancelled' }) };
    const { ctx, view } = await open(training);
    view.querySelector('[data-action="cancel"]').click();
    const sheet = document.querySelector('[role="dialog"]');
    sheet.querySelector('textarea[name="reason"]').value = 'Rain';
    sheet.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/'));
    expect(training.cancelScheduledTraining).toHaveBeenCalledWith('s1', 'Rain');
  });

  it('enables Finish when the start time arrives while the page is open', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-11T18:58:00Z'), toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const data = { ...base, starts_at: '2026-10-11T19:00:00Z' };
      const training = { getScheduledClass: vi.fn().mockResolvedValue(data), createIdempotencyKey: vi.fn(() => 'k1') };
      const ctx = appCtx({ services: { training }, now: () => new Date() });
      const view = await renderClass(ctx, { name: 'class', params: { id: 's1' }, query: {} });
      document.body.replaceChildren(view);
      expect(view.querySelector('[data-action="finish"]').disabled).toBe(true);
      vi.advanceTimersByTime(3 * 60 * 1000);
      expect(view.querySelector('[data-action="finish"]').disabled).toBe(false);
      expect(view.textContent).not.toContain('You can finish the class once it starts.');
    } finally {
      vi.useRealTimers();
    }
  });
});

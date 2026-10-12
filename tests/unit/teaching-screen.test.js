// tests/unit/teaching-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderTeaching } from '../../src/app/screens/teaching.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function teachingServices(extra = {}) {
  return {
    training: {
      listPlans: vi.fn().mockResolvedValue([
        { plan_id: 'p1', version_id: 'v1', title: 'Armada ladder', state: 'published', expected_duration_minutes: 60 },
        { plan_id: 'p2', version_id: 'v2', title: 'Ginga drills', state: 'draft', expected_duration_minutes: 45 },
      ]),
      listMyCalendar: vi.fn().mockResolvedValue([
        { item_id: 's1', item_type: 'scheduled', role: 'coach', kind: 'group', group_name: 'Grupo Lua', starts_at: '2026-10-14T18:00:00Z', local_date: '2026-10-14', plan_title: 'Armada ladder' },
        { item_id: 's2', item_type: 'scheduled', role: 'participant', kind: 'group', group_name: 'Other', starts_at: '2026-10-15T18:00:00Z', local_date: '2026-10-15' },
        { item_id: 's3', item_type: 'scheduled', role: 'coach', kind: 'personal_class', group_name: null, student_name: 'Bia Santos', starts_at: '2026-10-17T09:00:00Z', local_date: '2026-10-17' },
        { item_id: 'o1', item_type: 'completed', role: 'coach', kind: 'group', starts_at: '2026-10-11T08:00:00Z', local_date: '2026-10-11' },
      ]),
    },
    connection: {
      listMine: vi.fn().mockResolvedValue([{
        connection_id: 'c1', connection_kind: 'direct', state: 'active', coach_profile_id: 'me', student_profile_id: 'bia', student_display_name: 'Bia Santos',
      }]),
    },
    group: { listMyMemberships: vi.fn().mockResolvedValue([]), listRoster: vi.fn() },
    ...extra,
  };
}

describe('teaching screen', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('lists the classes I teach next, my plans, and my students', async () => {
    const services = teachingServices();
    const view = await renderTeaching(appCtx({ services }));
    document.body.replaceChildren(view);
    expect(services.training.listMyCalendar).toHaveBeenCalledWith({ start: '2026-10-11', endExclusive: '2026-12-10' });
    expect([...view.querySelectorAll('a[href^="#/class/"]')].map((link) => link.getAttribute('href'))).toEqual(['#/class/s1', '#/class/s3']);
    expect(view.querySelector('a[href="#/class/s3"]').textContent).toContain('Personal class · with Bia Santos');
    expect([...view.querySelectorAll('a[href^="#/me/teaching/plans/"]')].map((link) => link.getAttribute('href')))
      .toEqual(['#/me/teaching/plans/new', '#/me/teaching/plans/p1', '#/me/teaching/plans/p2']);
    expect(view.querySelector('a[href="#/me/teaching/plans/p2"]').textContent).toContain('Draft');
    expect(view.querySelector('a[href="#/me/teaching/students/bia"]').textContent).toContain('Bia Santos');
    expect(view.querySelector('a[href="#/me/teaching/record"]')).not.toBeNull();
    view.querySelector('[data-action="schedule"]').click();
    await vi.waitFor(() => expect(document.querySelector('form.sheet-form')).not.toBeNull());
  });

  it('shows the reason when Teaching cannot load', async () => {
    const services = teachingServices();
    services.training.listPlans.mockRejectedValue(new Error('offline'));
    const view = await renderTeaching(appCtx({ services }));
    expect(view.textContent).toContain('offline');
  });

  it('accepts a student request and finds a student to coach', async () => {
    const connections = [{
      connection_id: 'c2', connection_kind: 'direct', state: 'pending', coach_profile_id: 'me',
      student_profile_id: 'eva', student_display_name: 'Eva Costa', initiated_by: 'eva',
    }];
    const services = teachingServices({
      connection: {
        listMine: vi.fn().mockResolvedValue(connections),
        decide: vi.fn().mockResolvedValue({ status: 'active' }),
        searchCandidates: vi.fn().mockResolvedValue([{ profile_id: 'gil', display_name: 'Gil Mota' }]),
        request: vi.fn().mockResolvedValue({ status: 'pending' }),
      },
    });
    const view = await renderTeaching(appCtx({ services }));
    document.body.replaceChildren(view);
    expect(view.querySelector('[data-request="c2"]').textContent).toContain('Eva Costa asked you to coach them');
    view.querySelector('[data-request="c2"] [data-decision="accepted"]').click();
    await vi.waitFor(() => expect(services.connection.decide).toHaveBeenCalledWith('c2', 'accepted'));
    await vi.waitFor(() => expect(services.connection.listMine).toHaveBeenCalledTimes(2));
    document.querySelector('[data-action="find-student"]').click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] [data-candidate="gil"]')).not.toBeNull());
    expect(services.connection.searchCandidates).toHaveBeenCalledWith('', 'student');
    document.querySelector('[data-candidate="gil"]').click();
    await vi.waitFor(() => expect(services.connection.request).toHaveBeenCalledWith('me', 'gil'));
  });
});

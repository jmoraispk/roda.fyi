// tests/unit/student-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderStudent } from '../../src/app/screens/student.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function services(connections) {
  return {
    training: {
      listPlans: vi.fn().mockResolvedValue([{ plan_id: 'p1', version_id: 'v1', title: 'Armada ladder', state: 'published' }]),
      listCalendar: vi.fn().mockResolvedValue([
        { item_id: 'o1', item_type: 'completed', kind: 'alone', local_date: '2026-10-09', starts_at: '2026-10-09T07:00:00Z', duration_minutes: 45 },
        { item_id: 's9', item_type: 'scheduled', kind: 'personal_class', local_date: '2026-10-20', starts_at: '2026-10-20T18:00:00Z', duration_minutes: 60 },
      ]),
      getDay: vi.fn().mockResolvedValue([{
        id: 'o1', occurrence_id: 'o1', kind: 'alone', duration_minutes: 45, participation_id: 'pp1',
        rounds: [{ source_text: 'ginga 10 min' }], feedback: [],
        feedback_contexts: [{ kind: 'connection', id: 'c1', label: 'Direct coaching' }],
      }]),
      addFeedback: vi.fn().mockResolvedValue({ status: 'saved' }),
    },
    connection: {
      listMine: vi.fn().mockResolvedValue(connections ?? [{
        connection_id: 'c1', connection_kind: 'direct', state: 'active', coach_profile_id: 'me', student_profile_id: 'bia', student_display_name: 'Bia Santos',
      }]),
      end: vi.fn().mockResolvedValue({ status: 'ended' }),
    },
    group: { listMyMemberships: vi.fn().mockResolvedValue([]), listRoster: vi.fn() },
  };
}

const route = { name: 'teaching-student', params: { id: 'bia' }, query: {} };

describe('student page', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('shows the last year of training and saves feedback on a day', async () => {
    const s = services();
    const view = await renderStudent(appCtx({ services: s }), route);
    document.body.replaceChildren(view);
    expect(view.querySelector('h1').textContent).toBe('Bia Santos');
    expect(s.training.listCalendar).toHaveBeenCalledWith({ start: '2025-10-11', endExclusive: '2026-10-12', profileId: 'bia' });
    const items = view.querySelectorAll('[data-occurrence]');
    expect(items).toHaveLength(1);
    items[0].click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] form[data-feedback]')).not.toBeNull());
    const sheet = document.querySelector('[role="dialog"]');
    expect(s.training.getDay).toHaveBeenCalledWith({ localDate: '2026-10-09', profileId: 'bia' });
    expect(sheet.textContent).toContain('ginga 10 min');
    sheet.querySelector('textarea[name="body"]').value = 'Loose shoulders.';
    sheet.querySelector('form[data-feedback]').requestSubmit();
    await vi.waitFor(() => expect(sheet.querySelector('[role="status"]').textContent).toBe('Feedback saved.'));
    expect(s.training.addFeedback).toHaveBeenCalledWith({ participationId: 'pp1', groupId: null, connectionId: 'c1', body: 'Loose shoulders.' });
    expect(sheet.querySelector('.feedback').textContent).toContain('Loose shoulders.');
  });

  it('schedules for this student and ends coaching after a second tap', async () => {
    const s = services();
    const ctx = appCtx({ services: s });
    const view = await renderStudent(ctx, route);
    document.body.replaceChildren(view);
    view.querySelector('[data-action="schedule"]').click();
    await vi.waitFor(() => expect(document.querySelector('select[name="who"]')?.value).toBe('student:bia'));
    closeSheet();
    const end = view.querySelector('[data-action="end-coaching"]');
    end.click();
    expect(s.connection.end).not.toHaveBeenCalled();
    expect(end.textContent).toBe('Tap again to end coaching');
    end.click();
    await vi.waitFor(() => expect(s.connection.end).toHaveBeenCalledWith('c1'));
    expect(ctx.navigate).toHaveBeenCalledWith('/me/teaching');
  });

  it('explains a person who is not my student', async () => {
    const view = await renderStudent(appCtx({ services: services([]) }), route);
    expect(view.textContent).toContain("This student isn't available.");
  });
});

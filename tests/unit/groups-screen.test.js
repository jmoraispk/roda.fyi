// tests/unit/groups-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderGroups } from '../../src/app/screens/groups.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function services() {
  return {
    group: {
      listMyMemberships: vi.fn().mockResolvedValue([
        { group_id: 'g1', state: 'active', access_level: 'coach', group: { id: 'g1', name: 'Grupo Lua', owner_id: 'me', location: 'Lisbon', archived_at: null } },
        { group_id: 'g2', state: 'active', access_level: 'member', group: { id: 'g2', name: 'Roda Sul', owner_id: 'x', location: null, archived_at: null } },
        { group_id: 'g3', state: 'left', access_level: 'member', group: { id: 'g3', name: 'Old', owner_id: 'x', archived_at: null } },
      ]),
      createGroup: vi.fn().mockResolvedValue({ status: 'created', group_id: 'g9' }),
    },
    connection: {
      listMine: vi.fn().mockResolvedValue([
        { connection_id: 'c1', connection_kind: 'direct', state: 'pending', coach_profile_id: 'lua', coach_display_name: 'Professora Lua', student_profile_id: 'me', initiated_by: 'lua' },
        { connection_id: 'c2', connection_kind: 'direct', state: 'active', coach_profile_id: 'sol', coach_display_name: 'Mestre Sol', student_profile_id: 'me', initiated_by: 'me' },
        { connection_id: null, connection_kind: 'group', state: 'active', coach_profile_id: 'rio', coach_display_name: 'Contramestre Rio', student_profile_id: 'me', group_name: 'Roda Sul' },
        { connection_id: 'c4', connection_kind: 'direct', state: 'active', coach_profile_id: 'me', coach_display_name: 'Ana Silva', student_profile_id: 'bia' },
      ]),
      decide: vi.fn().mockResolvedValue({ status: 'active' }),
      end: vi.fn().mockResolvedValue({ status: 'ended' }),
    },
  };
}

describe('groups screen', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('lists my groups with my role and my coaches', async () => {
    const s = services();
    document.body.replaceChildren(await renderGroups(appCtx({ services: s, coach: true })));
    expect([...document.querySelectorAll('a[href^="#/group/"]')].map((link) => link.getAttribute('href'))).toEqual(['#/group/g1', '#/group/g2']);
    expect(document.querySelector('a[href="#/group/g1"]').textContent).toContain('Owner · Lisbon');
    expect(document.querySelector('a[href="#/group/g2"]').textContent).toContain('Member');
    expect([...document.querySelectorAll('[data-coach]')].map((row) => row.dataset.coach)).toEqual(['lua', 'sol', 'rio']);
    expect(document.querySelector('[data-coach="rio"]').textContent).toContain('Through Roda Sul');
    expect(document.querySelector('[data-coach="rio"] button')).toBeNull();
    document.querySelector('[data-coach="lua"] [data-decision="accepted"]').click();
    await vi.waitFor(() => expect(s.connection.decide).toHaveBeenCalledWith('c1', 'accepted'));
    await vi.waitFor(() => expect(s.connection.listMine).toHaveBeenCalledTimes(2));
  });

  it('ends coaching with a coach after a second tap', async () => {
    const s = services();
    document.body.replaceChildren(await renderGroups(appCtx({ services: s, coach: true })));
    const end = document.querySelector('[data-coach="sol"] [data-action="end-coach"]');
    end.click();
    expect(s.connection.end).not.toHaveBeenCalled();
    end.click();
    await vi.waitFor(() => expect(s.connection.end).toHaveBeenCalledWith('c2'));
  });

  it('lets coaches create a group and tells others how', async () => {
    const s = services();
    const ctx = appCtx({ services: s, coach: true });
    document.body.replaceChildren(await renderGroups(ctx));
    document.querySelector('[data-action="create-group"]').click();
    const form = document.querySelector('[role="dialog"] form');
    form.requestSubmit();
    expect(form.querySelector('[role="status"]').textContent).toBe('Give the group a name.');
    form.querySelector('input[name="name"]').value = 'Roda Norte';
    form.querySelector('input[name="timezone"]').value = 'Europe/Lisbon';
    form.requestSubmit();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/group/g9'));
    expect(s.group.createGroup).toHaveBeenCalledWith({ name: 'Roda Norte', description: '', location: '', timezone: 'Europe/Lisbon', discoverable: false });
    const other = await renderGroups(appCtx({ services: services(), coach: false }));
    expect(other.querySelector('[data-action="create-group"]')).toBeNull();
    expect(other.textContent).toContain('To create a group, choose Both or Teach in Me.');
  });
});

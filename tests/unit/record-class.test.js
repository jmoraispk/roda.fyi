// tests/unit/record-class.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderRecordClass } from '../../src/app/screens/record-class.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

function services({ recordPastClass = vi.fn().mockResolvedValue({ status: 'completed', occurrence_id: 'o5' }), connections, memberships } = {}) {
  return {
    training: {
      createIdempotencyKey: vi.fn(() => 'key-r'), recordPastClass,
      addResource: vi.fn().mockResolvedValue({ status: 'saved' }), listPlans: vi.fn().mockResolvedValue([]),
    },
    connection: { listMine: vi.fn().mockResolvedValue(connections ?? [{
      connection_id: 'c1', connection_kind: 'direct', state: 'active', coach_profile_id: 'me',
      student_profile_id: 'bia', student_display_name: 'Bia Santos',
    }]) },
    group: {
      listMyMemberships: vi.fn().mockResolvedValue(memberships ?? [{ group_id: 'g1', state: 'active', access_level: 'coach', group: { name: 'Grupo Lua' } }]),
      listRoster: vi.fn().mockResolvedValue([
        { profile_id: 'me', display_name: 'Ana Silva', access_level: 'coach', membership_state: 'active' },
        { profile_id: 'caio', display_name: 'Caio Lima', access_level: 'member', membership_state: 'active' },
        { profile_id: 'duda', display_name: 'Duda Reis', access_level: 'member', membership_state: 'active' },
      ]),
    },
  };
}

function send(text) {
  const input = document.querySelector('textarea[aria-label="Write a round"]');
  input.value = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

const save = () => document.querySelector('button[data-action="save"]').click();
const status = () => document.querySelector('.log-status').textContent;

describe('record a past class', () => {
  beforeEach(() => { localStorage.clear(); closeSheet(); });

  it('records a group class for the checked people with its rounds and resources', async () => {
    const s = services();
    const ctx = appCtx({ services: s });
    document.body.replaceChildren(await renderRecordClass(ctx));
    const boxes = document.querySelectorAll('input[name="attendee"]');
    expect([...boxes].map((box) => box.value)).toEqual(['caio', 'duda']);
    boxes[1].checked = false;
    document.querySelector('input[name="date"]').value = '2026-10-09';
    document.querySelector('input[name="time"]').value = '19:00';
    document.querySelector('input[name="duration"]').value = '90';
    send('ginga 10 min');
    document.querySelector('input[name="videoLink"]').value = 'https://youtu.be/VAI3JUKTwz0';
    save();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/training/o5'));
    expect(s.training.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'group', groupId: 'g1', connectionId: null, studentProfileId: null, localDate: '2026-10-09',
      occurredAt: '2026-10-09T18:00:00.000Z', timezone: 'Europe/Lisbon', durationMinutes: 90, idempotencyKey: 'key-r',
      attendees: [{ profileId: 'caio', durationMinutes: 90 }],
      rounds: [expect.objectContaining({ source_text: 'ginga 10 min' })],
    }), expect.any(Date));
    expect(s.training.addResource).toHaveBeenCalledWith({
      occurrenceId: 'o5', kind: 'video', title: '', url: 'https://youtu.be/VAI3JUKTwz0', body: null, clientKey: 'key-r',
    });
  });

  it('records a personal class through the direct connection', async () => {
    const s = services();
    const ctx = appCtx({ services: s });
    document.body.replaceChildren(await renderRecordClass(ctx));
    document.querySelector('[data-kind="personal_class"]').click();
    expect(document.querySelector('select[name="student"]').closest('label').hidden).toBe(false);
    send('10x (armada, au)');
    save();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/training/o5'));
    expect(s.training.recordPastClass).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'personal_class', studentProfileId: 'bia', connectionId: 'c1', groupId: null, attendees: [],
    }), expect.any(Date));
  });

  it('refuses a future start and an empty class, and keeps one request key across retries', async () => {
    const recordPastClass = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ occurrence_id: 'o6' });
    const ctx = appCtx({ services: services({ recordPastClass }) });
    document.body.replaceChildren(await renderRecordClass(ctx));
    send('ginga');
    document.querySelector('input[name="time"]').value = '23:00';
    save();
    expect(status()).toBe('That start time is still ahead. Choose a time that has passed.');
    document.querySelector('input[name="time"]').value = '10:00';
    document.querySelectorAll('input[name="attendee"]').forEach((box) => { box.checked = false; });
    save();
    expect(status()).toBe('Mark at least one person who came.');
    document.querySelector('input[name="attendee"]').checked = true;
    save();
    await vi.waitFor(() => expect(status()).toBe('offline'));
    save();
    await vi.waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('/training/o6'));
    expect(recordPastClass.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['key-r', 'key-r']);
  });

  it('explains when there is nobody to record a class for', async () => {
    const ctx = appCtx({ services: services({ connections: [], memberships: [] }) });
    const view = await renderRecordClass(ctx);
    expect(view.textContent).toContain('Create a group or connect with a student first.');
    expect(view.querySelector('a[href="#/me/groups"]')).not.toBeNull();
  });
});

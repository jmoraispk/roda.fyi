// tests/unit/send-notifications.test.js
import { describe, expect, it, vi } from 'vitest';

import {
  handleRequest, isPushEndpoint, runSender, sameSecret, ttlFor,
} from '../../supabase/functions/send-notifications/run.js';

const NOW = new Date('2030-01-15T18:00:30Z');
const device = (id, endpoint, locale = 'en') => ({ subscription_id: id, endpoint, p256dh: 'P'.repeat(87), auth: 'A'.repeat(22), locale });

function fakeRpc(deliveries) {
  const calls = [];
  const rpc = vi.fn(async (name, params) => {
    calls.push([name, params]);
    return name === 'claim_due_notifications' ? { data: deliveries, error: null } : { data: { status: 'reported' }, error: null };
  });
  return { rpc, calls };
}

describe('sender', () => {
  it('sends each delivery to every device in its language and reports what happened', async () => {
    const { rpc, calls } = fakeRpc([
      {
        delivery_id: 'd1', profile_id: 'p1', kind: 'before_class', subject_key: 'class:s1:1',
        payload: { url: '/app#/class/s1', role: 'coach', class_kind: 'group', group_name: 'Grupo Lua', starts_at: '2030-01-15T19:00:00Z', lead_minutes: 60, zone: 'Europe/Lisbon' },
        devices: [device('phone', 'https://fcm.googleapis.com/fcm/send/a', 'pt'), device('laptop', 'https://updates.push.services.mozilla.com/wpush/v2/b')],
      },
      {
        delivery_id: 'd2', profile_id: 'p2', kind: 'coach', subject_key: 'join:r1',
        payload: { url: '/app#/group/g1', reason: 'join', person_name: 'Bia', group_name: 'Grupo Lua' },
        devices: [device('odd', 'https://attacker.example/push'), device('busy', 'https://web.push.apple.com/c')],
      },
    ]);
    const push = vi.fn(async (target) => {
      if (target.subscription_id === 'laptop') throw Object.assign(new Error('gone'), { status: 410 });
      if (target.subscription_id === 'busy') throw Object.assign(new Error('busy'), { status: 503 });
    });
    const totals = await runSender({ rpc, push, now: () => NOW });
    expect(calls[0]).toEqual(['claim_due_notifications', { batch_limit: 50 }]);
    // Never to an address outside the known push services.
    expect(push.mock.calls.map(([target]) => target.subscription_id)).toEqual(['phone', 'laptop', 'busy']);
    const [, text, options] = push.mock.calls[0];
    expect(JSON.parse(text)).toEqual({ url: '/app#/class/s1', title: 'Aula daqui a 1 hora', body: 'Aula de grupo · Grupo Lua às 19:00', tag: 'd1' });
    expect(options).toEqual({ ttl: 3570 });
    expect(calls[1]).toEqual(['report_notification_results', { results: [
      { delivery_id: 'd1', outcomes: [{ subscription_id: 'phone', status: 'sent' }, { subscription_id: 'laptop', status: 'gone' }] },
      { delivery_id: 'd2', outcomes: [{ subscription_id: 'odd', status: 'gone' }, { subscription_id: 'busy', status: 'failed' }] },
    ] }]);
    expect(totals).toEqual({ deliveries: 2, sent: 1, gone: 2, failed: 1 });
  });

  it('reports a delivery with no device left, so it is given up', async () => {
    const { rpc, calls } = fakeRpc([{ delivery_id: 'd3', profile_id: 'p3', kind: 'setup', subject_key: 'setup:1', payload: {}, devices: [] }]);
    await runSender({ rpc, push: vi.fn(), now: () => NOW });
    expect(calls[1]).toEqual(['report_notification_results', { results: [{ delivery_id: 'd3', outcomes: [] }] }]);
  });

  it('counts a notification it cannot word as a passing failure', async () => {
    const { rpc, calls } = fakeRpc([{
      delivery_id: 'd4', profile_id: 'p4', kind: 'weather', subject_key: 'x', payload: {},
      devices: [device('phone', 'https://fcm.googleapis.com/fcm/send/a')],
    }]);
    const push = vi.fn();
    await runSender({ rpc, push, now: () => NOW });
    expect(push).not.toHaveBeenCalled();
    expect(calls[1][1].results[0].outcomes).toEqual([{ subscription_id: 'phone', status: 'failed' }]);
  });

  it('stops after claiming when nothing is due', async () => {
    const { rpc, calls } = fakeRpc([]);
    expect(await runSender({ rpc, push: vi.fn(), now: () => NOW })).toEqual({ deliveries: 0, sent: 0, gone: 0, failed: 0 });
    expect(calls).toHaveLength(1);
  });

  it('fails loudly when the database refuses', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }));
    await expect(runSender({ rpc, push: vi.fn(), now: () => NOW })).rejects.toThrow('claim failed: permission denied');
  });

  it('keeps a class reminder only until the class starts', () => {
    expect(ttlFor('before_class', { starts_at: '2030-01-15T18:00:40Z' }, NOW)).toBe(60);
    expect(ttlFor('before_class', { starts_at: '2030-01-15T19:00:30Z' }, NOW)).toBe(3600);
    expect(ttlFor('setup', {}, NOW)).toBe(43200);
  });

  it('knows the push services', () => {
    for (const url of ['https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/wpush/v2/a',
      'https://web.push.apple.com/a', 'https://wns2-par02p.notify.windows.com/w/?token=a']) {
      expect(isPushEndpoint(url)).toBe(true);
    }
    for (const url of ['http://fcm.googleapis.com/fcm/send/a', 'https://fcm.googleapis.com.attacker.example/a', 'https://localhost/a', null]) {
      expect(isPushEndpoint(url)).toBe(false);
    }
  });
});

describe('sender request', () => {
  const run = vi.fn(async () => ({ deliveries: 0 }));
  const call = (init, cronSecret = 's3cret-value') => handleRequest(
    new Request('https://project.supabase.co/functions/v1/send-notifications', init), { cronSecret, run, log: () => {} },
  );

  it('accepts only POST with the cron secret', async () => {
    expect((await call({ method: 'GET' })).status).toBe(405);
    expect((await call({ method: 'POST' })).status).toBe(401);
    expect((await call({ method: 'POST', headers: { 'x-roda-cron-secret': 's3cret-valuf' } })).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    const ok = await call({ method: 'POST', headers: { 'x-roda-cron-secret': 's3cret-value' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ deliveries: 0 });
  });

  it('refuses everything when no secret is configured', async () => {
    expect((await call({ method: 'POST', headers: { 'x-roda-cron-secret': '' } }, '')).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 500 without details when a run fails', async () => {
    const log = vi.fn();
    const response = await handleRequest(
      new Request('https://project.supabase.co/functions/v1/send-notifications', { method: 'POST', headers: { 'x-roda-cron-secret': 'k' } }),
      { cronSecret: 'k', run: async () => { throw new Error('claim failed: boom'); }, log },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'send_failed' });
    expect(log).toHaveBeenCalledWith('send-notifications failed: claim failed: boom');
  });

  it('compares secrets in full', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('ab', 'abc')).toBe(false);
    expect(sameSecret('abcd', 'abc')).toBe(false);
    expect(sameSecret(null, 'abc')).toBe(false);
    expect(sameSecret('', '')).toBe(false);
  });
});

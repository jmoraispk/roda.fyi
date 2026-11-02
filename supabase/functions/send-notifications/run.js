// supabase/functions/send-notifications/run.js
// The sender's logic, free of Deno and of any library (Ruling 19): check the
// cron secret, claim what is due, send it to each device, report back.
import { formatNotification } from './copy.js';

export const BATCH_LIMIT = 50;
const PUSH_SERVICES = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/\S+$/;

// Ruling 12: the sender only ever talks to known push services.
export function isPushEndpoint(endpoint) {
  return typeof endpoint === 'string' && endpoint.length <= 2048 && PUSH_SERVICES.test(endpoint);
}

// Ruling 3: compared in full, whatever the lengths, so timing reveals nothing.
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index += 1) difference |= (a[index] ?? 0) ^ b[index];
  return difference === 0;
}

// A reminder for a class is useless once the class has started.
export function ttlFor(kind, payload, now) {
  if (kind === 'before_class' && payload?.starts_at) {
    return Math.max(60, Math.floor((new Date(payload.starts_at).getTime() - now.getTime()) / 1000));
  }
  return 12 * 60 * 60;
}

async function sendToDevice({ push, delivery, device, now }) {
  if (!isPushEndpoint(device.endpoint)) return 'gone';
  let message;
  try {
    message = { ...formatNotification(delivery.kind, delivery.payload, { locale: device.locale, now }), tag: delivery.delivery_id };
  } catch {
    return 'failed';
  }
  try {
    await push(device, JSON.stringify(message), { ttl: ttlFor(delivery.kind, delivery.payload, now) });
    return 'sent';
  } catch (error) {
    return error?.status === 404 || error?.status === 410 ? 'gone' : 'failed';
  }
}

export async function runSender({ rpc, push, now = () => new Date(), batchLimit = BATCH_LIMIT }) {
  const claimed = await rpc('claim_due_notifications', { batch_limit: batchLimit });
  if (claimed.error) throw new Error(`claim failed: ${claimed.error.message}`);
  const deliveries = claimed.data ?? [];
  const totals = { deliveries: deliveries.length, sent: 0, gone: 0, failed: 0 };
  const results = [];
  for (const delivery of deliveries) {
    const outcomes = await Promise.all((delivery.devices ?? []).map(async (device) => {
      const status = await sendToDevice({ push, delivery, device, now: now() });
      totals[status] += 1;
      return { subscription_id: device.subscription_id, status };
    }));
    results.push({ delivery_id: delivery.delivery_id, outcomes });
  }
  if (results.length) {
    const reported = await rpc('report_notification_results', { results });
    if (reported.error) throw new Error(`report failed: ${reported.error.message}`);
  }
  return totals;
}

export async function handleRequest(request, { cronSecret, run, log = console.error }) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!sameSecret(request.headers.get('x-roda-cron-secret'), cronSecret)) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    return Response.json(await run());
  } catch (error) {
    // Messages come from this file only; they never include keys, endpoints, or secrets.
    log(`send-notifications failed: ${error?.message ?? error}`);
    return Response.json({ error: 'send_failed' }, { status: 500 });
  }
}

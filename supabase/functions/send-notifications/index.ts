// supabase/functions/send-notifications/index.ts
// Wiring only (Ruling 19): read secrets, connect the database and the push
// library, and hand them to run.js, which holds the tested logic.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import webpush from 'npm:web-push@3.6.7';

import { handleRequest, runSender } from './run.js';

function env(name: string): string {
  return Deno.env.get(name) ?? '';
}

// Ruling 4: the key Supabase injects; nothing is copied anywhere.
function secretKey(): string {
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    if (typeof keys.default === 'string' && keys.default) return keys.default;
  } catch {
    // Fall back to the legacy key below.
  }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(env('SUPABASE_URL'), secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});
// The keys are the standard base64url pair (Ruling 2); web-push validates them.
webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:support@roda.fyi', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

async function push(device: { endpoint: string; p256dh: string; auth: string }, text: string, options: { ttl: number }) {
  try {
    await webpush.sendNotification(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      text,
      { TTL: options.ttl, timeout: 10000 },
    );
  } catch (error) {
    // A push service's answer carries its status; the message may echo the endpoint, so it is dropped.
    const status = (error as { statusCode?: number })?.statusCode;
    throw Object.assign(new Error('push rejected'), { status });
  }
}

Deno.serve((request: Request) => handleRequest(request, {
  cronSecret: env('NOTIFICATIONS_CRON_SECRET'),
  run: () => runSender({ rpc: (name: string, params: Record<string, unknown>) => supabase.rpc(name, params), push }),
}));

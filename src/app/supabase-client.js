import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createRodaClient(config, createClient = createSupabaseClient) {
  return createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'roda.auth.session',
      },
    },
  );
}

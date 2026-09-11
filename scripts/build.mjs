import { pathToFileURL } from 'node:url';
import { rm } from 'node:fs/promises';

import { config as loadDotEnv } from 'dotenv';
import { build } from 'esbuild';

const TEST_CONFIG = Object.freeze({
  RODA_SUPABASE_URL: 'http://127.0.0.1:54321',
  RODA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_test',
});

export function readPublicConfig(env) {
  const supabaseUrl = env.RODA_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new Error('RODA_SUPABASE_URL is required');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error('RODA_SUPABASE_URL must be a valid http(s) URL');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('RODA_SUPABASE_URL must be a valid http(s) URL');
  }

  const supabasePublishableKey = env.RODA_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabasePublishableKey) {
    throw new Error('RODA_SUPABASE_PUBLISHABLE_KEY is required');
  }
  if (!supabasePublishableKey.startsWith('sb_publishable_')) {
    throw new Error('RODA_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_');
  }

  return { supabaseUrl, supabasePublishableKey };
}

export async function buildBrowserBundles({ test = false } = {}) {
  loadDotEnv({ path: '.env.local', quiet: true });
  const publicConfig = readPublicConfig(test ? TEST_CONFIG : process.env);
  const entryPoints = {
    'public-auth': 'src/app/entries/public-auth.js',
    'auth-callback': 'src/app/entries/auth-callback.js',
    dashboard: 'src/app/entries/dashboard.js',
  };

  if (!test) {
    await Promise.all(Object.keys(entryPoints).map((name) => (
      rm(`assets/generated/${name}.js.map`, { force: true })
    )));
  }

  await build({
    entryPoints,
    outdir: 'assets/generated',
    entryNames: '[name]',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2020'],
    minify: !test,
    sourcemap: test ? 'linked' : false,
    legalComments: 'none',
    define: {
      __RODA_E2E__: JSON.stringify(test),
      __RODA_SUPABASE_URL__: JSON.stringify(publicConfig.supabaseUrl),
      __RODA_SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publicConfig.supabasePublishableKey),
    },
  });
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await buildBrowserBundles({ test: process.argv.includes('--test') });
}

import { pathToFileURL } from 'node:url';
import { rm } from 'node:fs/promises';

import { config as loadDotEnv } from 'dotenv';
import { build } from 'esbuild';

// Phone notifications: the browser subscribes with this VAPID public key. It is
// public by design; its private half lives only in Supabase function secrets.
export const PRODUCTION_VAPID_PUBLIC_KEY = 'BEy75wUCQVWuxyPczKsS-GpTeo7DNkuhcyQpuQ0G3UN2zbdNY7xlBwVmJfluz98PdJ7ypjPxeIfNqW0tItyFmL0';
// A well-known example key: browser tests never reach a push service.
export const TEST_VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

const TEST_CONFIG = Object.freeze({
  RODA_SUPABASE_URL: 'http://127.0.0.1:54321',
  RODA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_test',
  RODA_VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
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

  const vapidPublicKey = env.RODA_VAPID_PUBLIC_KEY?.trim() || PRODUCTION_VAPID_PUBLIC_KEY;
  const point = /^[A-Za-z0-9_-]+$/.test(vapidPublicKey) ? Buffer.from(vapidPublicKey, 'base64url') : Buffer.alloc(0);
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error('RODA_VAPID_PUBLIC_KEY must be a base64url P-256 public key');
  }

  return { supabaseUrl, supabasePublishableKey, vapidPublicKey };
}

export const ENTRY_POINTS = Object.freeze({
  'public-auth': 'src/app/entries/public-auth.js',
  'auth-callback': 'src/app/entries/auth-callback.js',
  app: 'src/app/entries/app.js',
  'public-sequences': 'src/app/entries/public-sequences.js',
});

// Service workers are built to the site root so their scope can cover pages.
export const WORKER_ENTRY_POINTS = Object.freeze({
  'app-sw': 'src/app/sw/service-worker.js',
});

export async function buildBrowserBundles({
  test = false,
  outputDirectory = 'assets/generated',
} = {}) {
  loadDotEnv({ path: '.env.local', quiet: true });
  const publicConfig = readPublicConfig(test ? TEST_CONFIG : process.env);
  const entryPoints = ENTRY_POINTS;

  if (!test) {
    await Promise.all(Object.keys(entryPoints).map((name) => (
      rm(`${outputDirectory}/${name}.js.map`, { force: true })
    )));
  }

  await build({
    entryPoints,
    outdir: outputDirectory,
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
      __RODA_VAPID_PUBLIC_KEY__: JSON.stringify(publicConfig.vapidPublicKey),
    },
  });

  await build({
    entryPoints: { leaflet: 'node_modules/leaflet/dist/leaflet.css' },
    outdir: outputDirectory,
    entryNames: '[name]',
    bundle: true,
    minify: !test,
    legalComments: 'none',
    loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  });

  const version = JSON.stringify(String(Date.now()));
  await Promise.all(Object.entries(WORKER_ENTRY_POINTS).map(([name, entry]) => build({
    entryPoints: [entry],
    outfile: `${name}.js`,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    minify: !test,
    legalComments: 'none',
    define: { __RODA_SW_VERSION__: version },
  })));
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await buildBrowserBundles({ test: process.argv.includes('--test') });
}

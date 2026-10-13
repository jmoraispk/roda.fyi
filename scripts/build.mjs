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

export const ENTRY_POINTS = Object.freeze({
  'public-auth': 'src/app/entries/public-auth.js',
  'auth-callback': 'src/app/entries/auth-callback.js',
  dashboard: 'src/app/entries/dashboard.js',
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

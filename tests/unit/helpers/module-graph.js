// tests/unit/helpers/module-graph.js
// Answers "which source files does each page or worker actually load?" with
// esbuild's metafile, so dead-code and parity checks follow real imports.
import { readFile } from 'node:fs/promises';

import { build } from 'esbuild';

import { ENTRY_POINTS, WORKER_ENTRY_POINTS } from '../../../scripts/build.mjs';

const DEFINE = {
  __RODA_E2E__: 'false',
  __RODA_SUPABASE_URL__: '"http://127.0.0.1:54321"',
  __RODA_SUPABASE_PUBLISHABLE_KEY__: '"sb_publishable_graph"',
  __RODA_SW_VERSION__: '"graph"',
};

export async function reachableModules(entryPaths) {
  const result = await build({
    entryPoints: entryPaths,
    bundle: true,
    write: false,
    metafile: true,
    outdir: 'module-graph-out',
    platform: 'browser',
    format: 'esm',
    logLevel: 'silent',
    loader: { '.css': 'empty' },
    define: DEFINE,
  });
  return Object.keys(result.metafile.inputs).filter((path) => path.startsWith('src/')).sort();
}

export function appModules() {
  return reachableModules([ENTRY_POINTS.app]);
}

export function allModules() {
  return reachableModules([...Object.values(ENTRY_POINTS), ...Object.values(WORKER_ENTRY_POINTS)]);
}

export async function sourceOf(paths) {
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf8')])));
}

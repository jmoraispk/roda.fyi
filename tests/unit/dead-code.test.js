// tests/unit/dead-code.test.js
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { allModules } from './helpers/module-graph.js';

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (
    entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : [join(directory, entry.name)]
  )));
  return nested.flat().filter((path) => path.endsWith('.js'));
}

describe('source tree', () => {
  it('has no module that no page or worker loads', async () => {
    const loaded = new Set(await allModules());
    expect((await sourceFiles('src')).filter((path) => !loaded.has(path)).sort()).toEqual([]);
  });
});

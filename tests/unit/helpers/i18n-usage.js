// tests/unit/helpers/i18n-usage.js
import { readFile } from 'node:fs/promises';

import { DASHBOARD_STRINGS } from '../../../src/app/dashboard-i18n.js';
import { allModules } from './module-graph.js';

// Stopgap copy from Plan 1 that must not survive the switch-over.
export const RETIRED_KEYS = Object.freeze(['app.classic', 'app.comingSoon', 'app.completeProfile']);

export async function unusedKeys() {
  const files = (await allModules()).filter((path) => path !== 'src/app/dashboard-i18n.js');
  const text = (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');
  // Keys built at runtime, such as `training.${difficulty}` or `errors.${code}`.
  const prefixes = [...text.matchAll(/`([a-zA-Z]+(?:\.[a-zA-Z]+)*\.)\$\{/g)].map((match) => match[1]);
  // Plural keys whose base is passed around as a string, such as counted(i18n, 'discover.people', n)
  // reading 'discover.people.one' or 'discover.people.other'.
  for (const match of text.matchAll(/['"]([a-zA-Z]+(?:\.[a-zA-Z]+)+)['"]/g)) prefixes.push(`${match[1]}.`);
  return Object.keys(DASHBOARD_STRINGS.en).filter((key) => RETIRED_KEYS.includes(key) || (
    !text.includes(`'${key}'`) && !text.includes(`"${key}"`) && !text.includes(`\`${key}\``)
    && !prefixes.some((prefix) => key.startsWith(prefix))
  ));
}

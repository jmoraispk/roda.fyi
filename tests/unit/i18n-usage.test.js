// tests/unit/i18n-usage.test.js
import { describe, expect, it } from 'vitest';

import { unusedKeys } from './helpers/i18n-usage.js';

describe('copy', () => {
  it('ships only copy that some page or worker uses', async () => {
    expect(await unusedKeys()).toEqual([]);
  });

  it('keeps plural keys whose base is passed as a string', async () => {
    const unused = await unusedKeys();
    for (const key of ['discover.people.one', 'discover.people.other', 'discover.groups.one', 'discover.groups.other']) {
      expect(unused).not.toContain(key);
    }
  });
});

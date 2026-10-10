// tests/e2e/public-sequences.spec.js
import { expect, test } from '@playwright/test';

async function openBuilder(page) {
  await page.goto('/#sequences');
  // A hash-only navigation does not reload; reload so the bundles see the seeded storage.
  await page.reload();
  await page.getByRole('tab', { name: 'Build your own' }).click();
}

test('signed-out sequences stay in the browser', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await openBuilder(page);
  await page.locator('#seqPickerGrid .pick[title="Armada"]').click();
  await page.locator('#seqPickerGrid .pick[title="Aú"]').click();
  await page.getByRole('button', { name: 'Save to repertoire' }).click();
  await expect(page.locator('#seqSaved .seqtxt')).toHaveText(['Armada → Aú']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roda.seqs')).length)).toBe(1);
});

test('signed-in sequences import once and save to the account', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.seqs', JSON.stringify([[{ c: 'esquivas', n: 'Negativa' }]]));
  });
  await openBuilder(page);
  await expect(page.locator('#seqSaved .seqtxt')).toHaveText(['Negativa']);
  await page.locator('#seqPickerGrid .pick[title="Armada"]').click();
  await page.getByRole('button', { name: 'Save to repertoire' }).click();
  await expect(page.locator('#seqSaved .seqtxt')).toHaveText(['Armada', 'Negativa']);
  const accountTexts = await page.evaluate(() => JSON.parse(localStorage.getItem('roda.e2e.repertoireState'))
    .items.map(({ source_text: text }) => text).sort());
  expect(accountTexts).toEqual(['Armada', 'Negativa']);
  await page.locator('#seqSaved [data-load]').first().click();
  await expect(page.locator('#seqStrip .seq-step')).toHaveCount(1);
});

test('account sequence text is rendered as text', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.repertoireState', JSON.stringify({ counter: 1, items: [{
      id: 'sequence-1', profile_id: 'practitioner-1', import_ref: null, title: 'x',
      source_text: '<img src=x onerror="window.__xss=1">', sequence: null, updated_at: '2026-10-10T12:00:00Z',
    }] }));
  });
  await openBuilder(page);
  await expect(page.locator('#seqSaved .seqtxt')).toHaveText(['<img src=x onerror="window.__xss=1">']);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

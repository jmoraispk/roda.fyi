// tests/e2e/app-helpers.js
export const ANA = {
  id: 'practitioner-1', display_name: 'Ana Silva', avatar_path: null,
  timezone_override: 'Europe/Lisbon', leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
};

// Seeds a signed-in local account; `extra` maps localStorage keys to JSON values.
export async function seedAccount(page, { profile = {}, coachProfile = null, extra = {} } = {}) {
  await page.goto('/');
  await page.evaluate(({ values, coach, more }) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({ user: { id: 'practitioner-1', email: 'ana@example.com' } }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify(values));
    if (coach) localStorage.setItem('roda.e2e.coachProfile', JSON.stringify(coach));
    for (const [key, value] of Object.entries(more)) localStorage.setItem(key, JSON.stringify(value));
  }, { values: { ...ANA, ...profile }, coach: coachProfile, more: extra });
}

// The phone + sits in the tab bar; desktop has a sidebar button.
export async function openCreate(page, testInfo) {
  if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: 'Create', exact: true }).click();
  else await page.locator('.app-plus-side').click();
}

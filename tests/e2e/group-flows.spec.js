import { expect, test } from '@playwright/test';

const practitioner = {
  id: 'practitioner-1',
  display_name: 'Ana Silva',
  avatar_path: null,
  timezone_override: null,
  leaderboard_visible: true,
  completed_at: '2026-09-11T20:00:00Z',
};

const lua = {
  id: 'group-lua',
  slug: 'grupo-lua',
  owner_id: 'owner-1',
  name: 'Grupo Lua',
  description: 'Tuesday training',
  location: 'Lisbon',
  picture_path: null,
  is_discoverable: true,
  archived_at: null,
};

const mata = {
  id: 'group-mata',
  slug: 'grupo-mata',
  owner_id: 'practitioner-1',
  name: 'Grupo Mata',
  description: 'Saturday roda',
  location: 'Porto',
  picture_path: null,
  is_discoverable: false,
  archived_at: null,
};

async function seed(page, { coach = false, groupState = {} } = {}) {
  await page.goto('/');
  await page.evaluate(({ nextCoach, nextGroupState, nextProfile }) => {
    localStorage.clear();
    localStorage.setItem('roda.e2e.session', JSON.stringify({
      user: { id: 'practitioner-1', email: 'ana@example.com', user_metadata: { full_name: 'Ana Silva' } },
    }));
    localStorage.setItem('roda.e2e.profile', JSON.stringify(nextProfile));
    if (nextCoach) {
      localStorage.setItem('roda.e2e.coachProfile', JSON.stringify({
        profile_id: 'practitioner-1', activated_at: '2026-09-11T20:00:00Z',
      }));
    }
    localStorage.setItem('roda.e2e.groupState', JSON.stringify(nextGroupState));
  }, { nextCoach: coach, nextGroupState: groupState, nextProfile: practitioner });
}

test('searches groups, requests member access, and resolves an unlisted link', async ({ page }) => {
  await seed(page, {
    groupState: {
      groups: [lua, mata],
      discoveryTokens: { 'unlisted-secret': 'group-mata' },
    },
  });
  await page.goto('/dashboard');

  await page.getByRole('button', { name: 'Find a group' }).click();
  await page.getByRole('searchbox', { name: 'Search groups' }).fill('Lua');
  const card = page.getByRole('article', { name: 'Grupo Lua' });
  await expect(card).toContainText('Lisbon');
  await card.getByRole('button', { name: 'Request member access' }).click();
  await expect(page.getByRole('status', { name: 'Group status' })).toContainText('pending');

  await page.goto('/dashboard?group_link=unlisted-secret');
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('article', { name: 'Grupo Mata' })).toBeVisible();
});

test('registers coaching, requests coach access, and creates a group', async ({ page }) => {
  await seed(page, { groupState: { groups: [lua] } });
  await page.goto('/dashboard');

  await page.getByRole('button', { name: 'Coaching' }).click();
  await page.getByRole('button', { name: 'Register as a coach' }).click();
  await page.getByRole('button', { name: 'Find a group' }).click();
  await page.getByRole('article', { name: 'Grupo Lua' })
    .getByRole('button', { name: 'Request coach access' }).click();
  await expect(page.getByRole('status', { name: 'Group status' })).toContainText('coach access request is pending');

  await page.getByRole('button', { name: 'Create a group' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a group' });
  await dialog.getByLabel('Group name').fill('Roda do Sol');
  await dialog.getByLabel('Location').fill('Faro');
  await expect(dialog.getByLabel('Group timezone')).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Create group' }).click();

  await expect(page.getByLabel('Group context')).toContainText('Roda do Sol');
  await page.getByRole('tab', { name: 'Groups' }).click();
  await expect(page.getByRole('heading', { name: 'Roda do Sol' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.groupState'));
    return state.groups.find(({ name }) => name === 'Roda do Sol')?.timezone;
  })).toMatch(/^[A-Za-z_]+\/[A-Za-z_]+/);
});

test('lets a direct coach approve members, remove members, and create shareable invitations', async ({ page }) => {
  await seed(page, {
    coach: true,
    groupState: {
      groups: [lua],
      memberships: [{
        group_id: 'group-lua', profile_id: 'practitioner-1', access_level: 'coach', state: 'active',
        joined_at: '2026-09-01T20:00:00Z', group: lua,
      }],
      rosters: { 'group-lua': [
        { profile_id: 'student-1', display_name: 'Bia', access_level: 'member', membership_state: 'active' },
      ] },
      joinRequests: { 'group-lua': [
        { id: 'request-1', display_name: 'Caio', requested_access: 'member', state: 'pending' },
        { id: 'request-2', display_name: 'Professor Davi', requested_access: 'coach', state: 'pending' },
      ] },
    },
  });
  await page.evaluate(() => localStorage.setItem('roda.dashboard.mode', 'coaching'));
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Groups' }).click();

  await page.getByRole('button', { name: 'Approve Caio' }).click();
  await expect(page.getByRole('status', { name: 'Group status' })).toContainText('approved');
  await expect(page.getByRole('button', { name: 'Approve Professor Davi' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Remove Bia' }).click();
  await expect(page.getByText(/Bia · member/)).toHaveCount(0);

  await page.getByLabel('Student email (optional)').fill('newstudent@example.com');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByLabel('Invitation link')).toHaveValue(/member_invite=invite-1/);
  await expect(page.getByRole('link', { name: 'Share by email' })).toHaveAttribute('href', /^mailto:/);
  await expect(page.getByText('Expires in 7 days')).toBeVisible();
});

test('lets an owner manage coach access and immediate-parent sharing', async ({ page }) => {
  await seed(page, {
    coach: true,
    groupState: {
      groups: [mata, lua],
      memberships: [{
        group_id: 'group-mata', profile_id: 'practitioner-1', access_level: 'coach', state: 'active',
        joined_at: '2026-09-01T20:00:00Z', group: mata,
      }],
      rosters: { 'group-mata': [
        { profile_id: 'coach-2', display_name: 'Professor Davi', access_level: 'coach', membership_state: 'active' },
      ] },
      joinRequests: { 'group-mata': [
        { id: 'coach-request', display_name: 'Instrutora Céu', requested_access: 'coach', state: 'pending' },
      ] },
      relationships: { 'group-mata': [{
        id: 'relationship-1', parent_group_id: 'group-lua', child_group_id: 'group-mata',
        state: 'active', sharing_level: 'named_progress', parent_name: 'Grupo Lua', child_name: 'Grupo Mata',
      }] },
    },
  });
  await page.evaluate(() => localStorage.setItem('roda.dashboard.mode', 'coaching'));
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Groups' }).click();

  await page.getByRole('button', { name: 'Approve Instrutora Céu' }).click();
  await page.getByRole('button', { name: 'Relationship settings' }).click();
  const sharing = page.getByRole('dialog', { name: 'Group relationship' });
  await expect(sharing.getByText('Immediate parent only')).toBeVisible();
  await sharing.getByRole('radio', { name: 'Full coaching access' }).check();
  await sharing.getByRole('button', { name: 'Save sharing' }).click();
  await expect(page.getByRole('status', { name: 'Group status' })).toContainText('Full coaching access');

  await page.getByRole('button', { name: 'Invite child group' }).click();
  const hierarchy = page.getByRole('dialog', { name: 'Invite a child group' });
  await hierarchy.getByLabel('Child group').selectOption('group-lua');
  await hierarchy.getByRole('button', { name: 'Send group invitation' }).click();
  await expect(page.getByRole('status', { name: 'Group status' })).toContainText('Group invitation sent');

  await expect(page.getByRole('button', { name: 'Transfer ownership' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive group' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave group' })).toHaveCount(0);
});

test('retains a member invitation through sign-in and explains terminal invitation states', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/dashboard?member_invite=member-valid');
  await expect(page).toHaveURL(/\/\?next=%2Fdashboard%3Fmember_invite%3Dmember-valid/);

  await seed(page, {
    groupState: {
      groups: [lua],
      invitationTokens: {
        'member-valid': { state: 'pending', group: lua },
        'member-expired': { state: 'expired', group: lua },
        'member-revoked': { state: 'revoked', group: lua },
        'member-used': { state: 'accepted', group: lua },
      },
    },
  });
  await page.goto('/dashboard?member_invite=member-valid');
  const invitation = page.getByRole('dialog', { name: 'Group invitation' });
  await expect(invitation).toContainText('You were invited to join a group');
  await invitation.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByLabel('Group context')).toContainText('Grupo Lua');

  for (const [token, message] of [
    ['member-expired', 'expired'],
    ['member-revoked', 'revoked'],
    ['member-used', 'already been used'],
  ]) {
    await page.goto(`/dashboard?member_invite=${token}`);
    await expect(page).toHaveURL('/dashboard');
    await page.getByRole('dialog', { name: 'Group invitation' })
      .getByRole('button', { name: 'Accept invitation' }).click();
    await expect(page.getByRole('status', { name: 'Group status' })).toContainText(message);
  }
});

test('switches between coached groups and clears a group after access is revoked', async ({ page }) => {
  await seed(page, {
    coach: true,
    groupState: {
      groups: [lua, mata],
      memberships: [lua, mata].map((group) => ({
        group_id: group.id,
        profile_id: 'practitioner-1',
        access_level: 'coach',
        state: 'active',
        joined_at: '2026-09-01T20:00:00Z',
        group,
      })),
      rosters: { 'group-lua': [], 'group-mata': [] },
    },
  });
  await page.evaluate(() => localStorage.setItem('roda.dashboard.mode', 'coaching'));
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Groups' }).click();

  await expect(page.getByRole('heading', { name: 'Grupo Lua' })).toBeVisible();
  await page.getByLabel('Group context').selectOption('group-mata');
  await expect(page.getByRole('heading', { name: 'Grupo Mata' })).toBeVisible();

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.groupState'));
    state.revokedGroupIds = ['group-lua'];
    localStorage.setItem('roda.e2e.groupState', JSON.stringify(state));
  });
  await page.getByLabel('Group context').selectOption('group-lua');
  await expect(page.getByRole('status', { name: 'Group status' })).toContainText('no longer have access');
  await expect(page.getByLabel('Group context').locator('option[value="group-lua"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Grupo Lua' })).toHaveCount(0);
});

test('lets a child owner decide a parent invitation and surfaces hierarchy conflicts', async ({ page }) => {
  await seed(page, {
    coach: true,
    groupState: {
      groups: [mata, lua],
      memberships: [{
        group_id: 'group-mata', profile_id: 'practitioner-1', access_level: 'coach', state: 'active',
        joined_at: '2026-09-01T20:00:00Z', group: mata,
      }],
      relationships: { 'group-mata': [{
        id: 'relationship-pending', parent_group_id: 'group-lua', child_group_id: 'group-mata',
        state: 'pending', sharing_level: 'named_progress', parent_name: 'Grupo Lua', child_name: 'Grupo Mata',
      }] },
    },
  });
  await page.evaluate(() => localStorage.setItem('roda.dashboard.mode', 'coaching'));
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Groups' }).click();

  await page.getByRole('button', { name: 'Accept Grupo Lua as parent' }).click();
  await expect(page.getByRole('status', { name: 'Group status' })).toContainText('Parent group accepted');
  await expect(page.getByText(/Grupo Lua → Grupo Mata · active/)).toBeVisible();

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('roda.e2e.groupState'));
    state.relationshipInviteError = 'This group already has an active parent or would create a cycle.';
    localStorage.setItem('roda.e2e.groupState', JSON.stringify(state));
  });
  await page.getByRole('button', { name: 'Invite child group' }).click();
  await page.getByRole('dialog', { name: 'Invite a child group' })
    .getByRole('button', { name: 'Send group invitation' }).click();
  await expect(page.getByRole('dialog', { name: 'Invite a child group' })
    .getByRole('status')).toContainText('active parent or would create a cycle');
});

test('lets an owner rotate discovery links and transfer ownership to an active coach', async ({ page }) => {
  await seed(page, {
    coach: true,
    groupState: {
      groups: [mata],
      memberships: [{
        group_id: 'group-mata', profile_id: 'practitioner-1', access_level: 'coach', state: 'active',
        joined_at: '2026-09-01T20:00:00Z', group: mata,
      }],
      rosters: { 'group-mata': [
        { profile_id: 'practitioner-1', display_name: 'Ana Silva', access_level: 'coach', membership_state: 'active' },
        { profile_id: 'coach-2', display_name: 'Professor Davi', access_level: 'coach', membership_state: 'active' },
      ] },
    },
  });
  await page.evaluate(() => localStorage.setItem('roda.dashboard.mode', 'coaching'));
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Groups' }).click();

  await page.getByRole('button', { name: 'Create discovery link' }).click();
  await expect(page.getByLabel('Discovery link')).toHaveValue(/group_link=discovery-1/);
  await expect(page.getByText('reveals this group but never grants membership')).toBeVisible();
  await page.getByRole('button', { name: 'Rotate discovery link' }).click();
  await expect(page.getByLabel('Discovery link')).toHaveValue(/group_link=discovery-2/);
  await page.getByRole('button', { name: 'Revoke discovery link' }).click();
  await expect(page.getByLabel('Discovery link')).toHaveCount(0);

  await page.getByRole('button', { name: 'Transfer ownership' }).click();
  const transfer = page.getByRole('dialog', { name: 'Transfer ownership' });
  await transfer.getByLabel('New owner').selectOption('coach-2');
  await transfer.getByRole('button', { name: 'Transfer ownership' }).click();
  await expect(page.getByRole('status', { name: 'Group status' })).toContainText('Ownership transferred');
  await expect(page.getByRole('button', { name: 'Transfer ownership' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leave group' })).toBeVisible();
});

test('lets an owner edit and archive a group', async ({ page }) => {
  await seed(page, {
    coach: true,
    groupState: {
      groups: [mata],
      memberships: [{
        group_id: 'group-mata', profile_id: 'practitioner-1', access_level: 'coach', state: 'active',
        joined_at: '2026-09-01T20:00:00Z', group: mata,
      }],
      rosters: { 'group-mata': [] },
    },
  });
  await page.evaluate(() => localStorage.setItem('roda.dashboard.mode', 'coaching'));
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Groups' }).click();

  await page.getByRole('button', { name: 'Edit group' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit group' });
  await edit.getByLabel('Group name').fill('Grupo Mata Renovado');
  await edit.getByRole('button', { name: 'Save group' }).click();
  await expect(page.getByRole('heading', { name: 'Grupo Mata Renovado' })).toBeVisible();

  await page.getByRole('button', { name: 'Archive group' }).click();
  await page.getByRole('dialog', { name: 'Archive group' })
    .getByRole('button', { name: 'Confirm archive' }).click();
  await expect(page.getByLabel('Group context')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Grupo Mata Renovado' })).toHaveCount(0);
});

// tests/unit/welcome-screen.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { renderWelcome, welcomeSteps } from '../../src/app/screens/welcome.js';
import { appCtx } from './app-test-context.js';

function profileService(overrides = {}) {
  return {
    setUsageMode: vi.fn().mockResolvedValue({ status: 'updated' }),
    uploadProfilePicture: vi.fn().mockResolvedValue({ status: 'updated' }),
    completeProfile: vi.fn().mockResolvedValue({ status: 'updated' }),
    loadProfile: vi.fn().mockResolvedValue({ id: 'me', display_name: 'Ana Silva', usage_mode: 'teach', completed_at: '2026-10-12T10:00:00Z' }),
    ...overrides,
  };
}

function setup(services, options = {}) {
  const ctx = appCtx({
    profile: { id: 'me', display_name: 'Capoeirista', usage_mode: 'train', completed_at: null, timezone_override: null, leaderboard_visible: true },
    user: { id: 'me', email: 'ana@example.com', user_metadata: { full_name: 'Ana Silva' } },
    services: { profile: services },
  });
  const onDone = vi.fn();
  return { onDone, render: () => renderWelcome(ctx, { name: 'welcome', params: {}, query: {} }, { onDone, ...options }) };
}

const press = (view, action) => view.querySelector(`[data-action="${action}"]`).click();

describe('welcome', () => {
  it('walks through name and mode, then finishes', async () => {
    const services = profileService();
    const { onDone, render } = setup(services);
    const view = await render();
    document.body.replaceChildren(view);
    expect(view.querySelector('.welcome-progress').textContent).toBe('Step 1 of 2');
    const name = view.querySelector('input[name="displayName"]');
    expect(name.value).toBe('Ana Silva');
    name.value = '   ';
    press(view, 'welcome-next');
    expect(view.querySelector('[role="status"]').textContent).toBe('Enter a name of up to 80 characters.');
    name.value = 'Ana Silva';
    press(view, 'welcome-next');
    expect(view.querySelector('.welcome-progress').textContent).toBe('Step 2 of 2');
    expect(view.querySelector('.mode-means').textContent).toBe('The + button opens Log training. Teaching stays out of Me.');
    view.querySelector('[data-mode="teach"]').click();
    expect(view.querySelector('.mode-means').textContent).toBe('The + button schedules or records classes, and Today puts your classes first.');
    press(view, 'welcome-next');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ usage_mode: 'teach' }), 'teach'));
    expect(services.setUsageMode).toHaveBeenCalledWith('teach');
    expect(services.completeProfile).toHaveBeenCalledWith({ displayName: 'Ana Silva', timezoneChoice: 'Automatic', leaderboardVisible: true });
    expect(services.uploadProfilePicture).not.toHaveBeenCalled();
  });

  it('keeps the answers and never uploads the same photo twice after a failure', async () => {
    const services = profileService({
      completeProfile: vi.fn().mockRejectedValueOnce(new Error('Timed out')).mockResolvedValue({ status: 'updated' }),
    });
    const { onDone, render } = setup(services);
    const view = await render();
    document.body.replaceChildren(view);
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    Object.defineProperty(view.querySelector('input[name="photo"]'), 'files', { value: [file] });
    press(view, 'welcome-next');
    press(view, 'welcome-next');
    await vi.waitFor(() => expect(view.querySelector('[role="status"]').textContent).toBe('Timed out'));
    expect(onDone).not.toHaveBeenCalled();
    expect(view.querySelector('[data-action="welcome-next"]').textContent).toBe('Finish');
    press(view, 'welcome-next');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(services.uploadProfilePicture).toHaveBeenCalledTimes(1);
    expect(services.uploadProfilePicture).toHaveBeenCalledWith('me', file);
  });

  it('runs extra steps and their save hooks before completing the profile', async () => {
    const services = profileService();
    const order = [];
    services.completeProfile.mockImplementation(async () => { order.push('complete'); return {}; });
    const extra = {
      id: 'extra', title: 'welcome.modeTitle',
      render: (_state, ctx) => ctx.document.createElement('div'),
      save: async () => { order.push('extra'); },
    };
    const { onDone, render } = setup(services, { steps: [...welcomeSteps(), extra] });
    const view = await render();
    document.body.replaceChildren(view);
    press(view, 'welcome-next');
    press(view, 'welcome-next');
    expect(view.querySelector('.welcome-progress').textContent).toBe('Step 3 of 3');
    press(view, 'welcome-next');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(order).toEqual(['extra', 'complete']);
  });
});

// tests/unit/app-test-context.js
// A screen context for jsdom tests; pass overrides for services and profile.
import { vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { openSheet } from '../../src/app/shell/sheet.js';

export function appCtx(overrides = {}) {
  const values = new Map([['roda.dashboard.locale', 'en']]);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let coach = overrides.coach ?? false;
  return {
    document,
    window,
    i18n: createDashboardI18n({ document, storage, navigator: { languages: ['en'] } }),
    profile: {
      id: 'me', display_name: 'Ana Silva', usage_mode: 'both', avatar_path: null,
      timezone_override: null, leaderboard_visible: true, completed_at: '2026-09-11T20:00:00Z',
    },
    user: { id: 'me', email: 'ana@example.com', user_metadata: {} },
    timezone: 'Europe/Lisbon',
    services: {},
    navigate: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    today: () => '2026-10-11',
    now: () => new Date('2026-10-11T12:00:00Z'),
    getTermMappings: () => [],
    refreshTermMappings: vi.fn(),
    isCoach: () => coach,
    markCoach: () => { coach = true; },
    openSheet: (options) => openSheet({ document, ...options }),
    ...overrides,
  };
}

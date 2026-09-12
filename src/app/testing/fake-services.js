import { consumeReturnRoute } from '../return-route.js';
import { resolveTimezoneOverride } from '../profile-service.js';

const SESSION_KEY = 'roda.e2e.session';

function readSession(storage) {
  try {
    return JSON.parse(storage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function createE2EAuthService({ window }) {
  const { localStorage: storage } = window;
  window.__RODA_E2E_EVENTS__ = [];

  const record = (event) => window.__RODA_E2E_EVENTS__.push(event);

  return {
    async signInWithGoogle(next) {
      record({ type: 'google', next });
    },

    async sendEmailLink(email, next) {
      record({ type: 'email', email, next });
    },

    async finishCallback(search) {
      const params = new URLSearchParams(search);
      if (params.get('error') === 'e2e' || params.get('code') !== 'e2e-success') {
        throw new Error('We could not complete your sign-in. Please try again.');
      }

      const session = {
        user: { id: 'practitioner-1', email: 'student@example.com' },
      };
      storage.setItem(SESSION_KEY, JSON.stringify(session));
      return {
        session,
        returnRoute: consumeReturnRoute({ search, storage }),
      };
    },

    async getSession() {
      return readSession(storage);
    },

    onAuthStateChange(listener) {
      window.__RODA_E2E_EXPIRE__ = () => {
        storage.removeItem(SESSION_KEY);
        listener('SIGNED_OUT', null);
      };
      return { unsubscribe() {} };
    },

    async signOut() {
      record({ type: 'sign-out' });
      storage.removeItem(SESSION_KEY);
      storage.removeItem('roda.dashboard.mode');
      storage.removeItem('roda.dashboard.group');
    },
  };
}

export function createE2EProfileService({ window }) {
  const { localStorage: storage } = window;
  const record = (event) => window.__RODA_E2E_EVENTS__.push(event);

  return {
    async loadProfile() {
      const saved = JSON.parse(storage.getItem('roda.e2e.profile'));
      if (saved) return saved;
      const profile = {
        id: 'practitioner-1',
        display_name: 'Capoeirista',
        avatar_path: null,
        timezone_override: null,
        leaderboard_visible: true,
        completed_at: null,
      };
      storage.setItem('roda.e2e.profile', JSON.stringify(profile));
      return profile;
    },

    async loadCoachProfile() {
      return JSON.parse(storage.getItem('roda.e2e.coachProfile'));
    },

    async completeProfile({ displayName, timezoneChoice, leaderboardVisible }) {
      const timezone = resolveTimezoneOverride(timezoneChoice);
      const current = JSON.parse(storage.getItem('roda.e2e.profile'));
      const profile = {
        ...current,
        display_name: displayName.trim(),
        timezone_override: timezone,
        leaderboard_visible: Boolean(leaderboardVisible),
        completed_at: '2026-09-11T20:00:00Z',
      };
      record({
        type: 'complete-profile',
        displayName: displayName.trim(),
        timezoneChoice,
        leaderboardVisible: Boolean(leaderboardVisible),
      });
      storage.setItem('roda.e2e.profile', JSON.stringify(profile));
      return { status: 'updated', profile_id: profile.id };
    },

    async uploadProfilePicture(profileId, file) {
      record({ type: 'profile-picture', profileId, name: file.name, fileType: file.type });
      return { status: 'updated', path: `${profileId}/e2e.${file.type.split('/')[1]}` };
    },

    async registerAsCoach() {
      const coachProfile = {
        profile_id: 'practitioner-1',
        activated_at: '2026-09-11T20:00:00Z',
      };
      record({ type: 'register-coach' });
      storage.setItem('roda.e2e.coachProfile', JSON.stringify(coachProfile));
      return { status: 'active', profile_id: coachProfile.profile_id };
    },
  };
}

export function createE2EGroupService({ window }) {
  return {
    async listMyMemberships() {
      return JSON.parse(window.localStorage.getItem('roda.e2e.memberships') ?? '[]');
    },
  };
}

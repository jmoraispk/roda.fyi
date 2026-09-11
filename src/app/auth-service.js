import { AppError, toAppError } from './errors.js';
import {
  consumeReturnRoute,
  rememberReturnRoute,
  sanitizeReturnRoute,
} from './return-route.js';

const PRIVATE_STORAGE_KEYS = [
  'roda.auth.returnRoute',
  'roda.dashboard.mode',
  'roda.dashboard.group',
];

function callbackUrl(origin, next) {
  const safeOrigin = origin.replace(/\/$/, '');
  return `${safeOrigin}/auth/callback?next=${encodeURIComponent(sanitizeReturnRoute(next))}`;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function unwrap(result) {
  if (result.error) throw toAppError(result.error);
  return result.data;
}

export function createAuthService({ client, origin, storage }) {
  return {
    async signInWithGoogle(next = '/dashboard') {
      const route = sanitizeReturnRoute(next);
      rememberReturnRoute(storage, route);
      const result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackUrl(origin, route) },
      });
      return unwrap(result);
    },

    async sendEmailLink(email, next = '/dashboard') {
      const normalizedEmail = email?.trim() ?? '';
      if (!validEmail(normalizedEmail)) {
        throw new AppError('validation', 'invalid_email');
      }

      const route = sanitizeReturnRoute(next);
      rememberReturnRoute(storage, route);
      const result = await client.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: callbackUrl(origin, route),
          shouldCreateUser: true,
        },
      });
      return unwrap(result);
    },

    async finishCallback(search) {
      const code = new URLSearchParams(search).get('code');
      if (!code) throw new AppError('validation', 'missing_code');

      const data = unwrap(await client.auth.exchangeCodeForSession(code));
      if (!data.session) throw new AppError('authentication', 'missing_session');

      return {
        session: data.session,
        returnRoute: consumeReturnRoute({ search, storage }),
      };
    },

    async getSession() {
      return unwrap(await client.auth.getSession()).session;
    },

    onAuthStateChange(listener) {
      return client.auth.onAuthStateChange(listener).data.subscription;
    },

    async signOut() {
      const result = await client.auth.signOut();
      for (const key of PRIVATE_STORAGE_KEYS) storage.removeItem(key);
      if (result.error) throw toAppError(result.error);
    },
  };
}

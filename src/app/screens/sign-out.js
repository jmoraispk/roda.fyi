// src/app/screens/sign-out.js
import { sendWaitingResources } from '../local-data.js';
import { el } from '../shell/page.js';

function localStorageOf(window) {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Sign-out never drops a resource that has not reached the account. It sends
// anything waiting first; if that fails, the person stays signed in and is
// asked to connect and try again. There is deliberately no way to discard.
let inFlight = null;

export function signOutSafely(ctx, { signOut }) {
  // A double tap joins the sign-out already running instead of starting another.
  if (inFlight) return inFlight.then(() => false);
  inFlight = run(ctx, { signOut }).finally(() => { inFlight = null; });
  return inFlight;
}

async function run(ctx, { signOut }) {
  const { document, i18n } = ctx;
  const storage = localStorageOf(ctx.window);
  const remaining = await sendWaitingResources(storage, ctx.services.training, ctx.profile?.id ?? null);
  if (!remaining) {
    try {
      await signOut();
      return true;
    } catch (error) {
      ctx.openSheet({
        title: i18n.t('app.signOut'),
        content: el(document, 'p', { attrs: { role: 'status' }, text: error?.message || i18n.t('app.loadError') }),
      });
      return false;
    }
  }
  let sheet = null;
  const retry = el(document, 'button', {
    className: 'button-primary', text: i18n.t('app.retry'), attrs: { type: 'button' }, dataset: { action: 'retry-sign-out' },
    on: { click: async () => {
      retry.disabled = true;
      sheet.close();
      await signOutSafely(ctx, { signOut });
    } },
  });
  const message = remaining === 1 ? i18n.t('signOut.waitingOne') : i18n.t('signOut.waitingMany', { count: remaining });
  sheet = ctx.openSheet({
    title: i18n.t('signOut.waitingTitle'),
    content: el(document, 'div', { className: 'sign-out-waiting' }, [el(document, 'p', { text: message }), retry]),
  });
  return false;
}

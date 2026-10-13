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
export async function signOutSafely(ctx, { signOut }) {
  const { document, i18n } = ctx;
  const storage = localStorageOf(ctx.window);
  const remaining = await sendWaitingResources(storage, ctx.services.training);
  if (!remaining) {
    await signOut();
    return true;
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

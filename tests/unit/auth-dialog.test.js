// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthDialog } from '../../src/app/ui/auth-dialog.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  document.body.innerHTML = `
    <button id="authEntry" type="button" aria-haspopup="dialog">
      <span id="authEntrySignedOut">Sign in</span>
      <span id="authEntrySignedIn" hidden>Dashboard</span>
    </button>
    <dialog id="authDialog" aria-labelledby="authDialogTitle">
      <button id="authClose" type="button">Close</button>
      <h2 id="authDialogTitle">Sign in</h2>
      <div id="authActions">
        <button id="googleSignIn" class="auth-method" type="button">
          Continue with Google <span>Recommended</span>
        </button>
        <button id="tryDemo" class="auth-method" type="button">Try demo</button>
        <div role="separator">or</div>
        <form id="emailSignIn">
          <label>Email <input id="authEmail" type="email" required></label>
          <button id="emailSignInButton" class="auth-method" type="submit">Email me a sign-in link</button>
        </form>
      </div>
      <p id="authMessage" role="status"></p>
    </dialog>
  `;
  const dialog = document.querySelector('#authDialog');
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => {
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  };
}

function fakeAuth(overrides = {}) {
  const calls = [];
  return {
    calls,
    service: {
      signInWithGoogle: async (route) => {
        calls.push(['google', route]);
      },
      sendEmailLink: async (email, route) => {
        calls.push(['email', email, route]);
      },
      ...overrides,
    },
  };
}

beforeEach(fixture);

describe('createAuthDialog', () => {
  it('opens one sign-in dialog with Google first, recommended, and focused', () => {
    const { service } = fakeAuth();
    createAuthDialog({ document, authService: service });

    document.querySelector('#authEntry').click();

    const dialog = document.querySelector('#authDialog');
    const google = document.querySelector('#googleSignIn');
    const email = document.querySelector('#emailSignInButton');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(google.textContent).toContain('Recommended');
    expect(google.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(document.activeElement).toBe(google);
    expect(document.body.textContent).not.toMatch(/\bRegister\b|\bLogin\b/);
  });

  it('can open from a retained protected destination without another click', () => {
    const { service } = fakeAuth();
    const controller = createAuthDialog({ document, authService: service });

    controller.open();

    expect(document.querySelector('#authDialog').hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#googleSignIn'));
  });

  it('starts Google sign-in for the current safe destination', async () => {
    const { service, calls } = fakeAuth();
    createAuthDialog({
      document,
      authService: service,
      returnRoute: () => '/dashboard?group_link=group-token',
    });

    document.querySelector('#googleSignIn').click();
    await Promise.resolve();

    expect(calls).toEqual([['google', '/dashboard?group_link=group-token']]);
  });

  it('opens a browser-only demo without calling an authentication provider', () => {
    const { service, calls } = fakeAuth();
    const navigate = vi.fn();
    createAuthDialog({ document, authService: service, navigate });

    document.querySelector('#tryDemo').click();

    expect(navigate).toHaveBeenCalledWith('/app?demo=1');
    expect(calls).toEqual([]);
  });

  it('keeps both sign-in methods disabled while Google redirect starts', async () => {
    const pending = deferred();
    const { service } = fakeAuth({ signInWithGoogle: () => pending.promise });
    createAuthDialog({ document, authService: service });

    document.querySelector('#googleSignIn').click();
    await Promise.resolve();

    expect(document.querySelector('#googleSignIn').disabled).toBe(true);
    expect(document.querySelector('#emailSignInButton').disabled).toBe(true);
    pending.resolve();
  });

  it('does not submit an invalid email address', async () => {
    const { service, calls } = fakeAuth();
    createAuthDialog({ document, authService: service });
    document.querySelector('#authEmail').value = 'not-an-email';

    document.querySelector('#emailSignIn').dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();

    expect(calls).toEqual([]);
  });

  it('shows a check-email state after a passwordless link is requested', async () => {
    const { service, calls } = fakeAuth();
    createAuthDialog({
      document,
      authService: service,
      returnRoute: () => '/dashboard',
    });
    document.querySelector('#authEmail').value = 'learner@example.com';

    document.querySelector('#emailSignIn').dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual([['email', 'learner@example.com', '/dashboard']]);
    expect(document.querySelector('#authMessage').textContent).toContain('Check your email');
    expect(document.querySelector('#authActions').hidden).toBe(true);
  });

  it('renders a safe application error and enables retry', async () => {
    const { service } = fakeAuth({
      sendEmailLink: async () => {
        throw { message: 'This sign-in link has expired.', code: 'otp_expired' };
      },
    });
    createAuthDialog({ document, authService: service });
    document.querySelector('#authEmail').value = 'learner@example.com';

    document.querySelector('#emailSignIn').dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('#authMessage').textContent)
      .toBe('This sign-in link has expired.');
    expect(document.querySelector('#googleSignIn').disabled).toBe(false);
    expect(document.querySelector('#emailSignInButton').disabled).toBe(false);
  });

  it('turns the same entry into a dashboard action for a signed-in session', () => {
    const navigations = [];
    const { service } = fakeAuth();
    const controller = createAuthDialog({
      document,
      authService: service,
      navigate: (route) => navigations.push(route),
    });
    controller.setSession({ user: { id: 'user-1' } });

    document.querySelector('#authEntry').click();

    expect(document.querySelector('#authEntrySignedOut')).not.toBeNull();
    expect(document.querySelector('#authEntrySignedIn')).not.toBeNull();
    expect(document.querySelector('#authEntrySignedOut').hidden).toBe(true);
    expect(document.querySelector('#authEntrySignedIn').hidden).toBe(false);
    expect(navigations).toEqual(['/app']);
    expect(document.querySelector('#authDialog').hasAttribute('open')).toBe(false);
  });

  it('restores the localized entry when a session ends', () => {
    const { service } = fakeAuth();
    const controller = createAuthDialog({ document, authService: service });
    controller.setSession({ user: { id: 'user-1' } });

    controller.setSession(null);

    expect(document.querySelector('#authEntrySignedOut')).not.toBeNull();
    expect(document.querySelector('#authEntrySignedIn')).not.toBeNull();
    expect(document.querySelector('#authEntrySignedOut').hidden).toBe(false);
    expect(document.querySelector('#authEntrySignedIn').hidden).toBe(true);
    expect(document.querySelector('#authEntry').getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('returns focus to the entry when the dialog closes', () => {
    const { service } = fakeAuth();
    createAuthDialog({ document, authService: service });
    const entry = document.querySelector('#authEntry');
    entry.click();

    document.querySelector('#authClose').click();

    expect(document.activeElement).toBe(entry);
  });
});

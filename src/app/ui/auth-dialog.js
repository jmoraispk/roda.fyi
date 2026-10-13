export function createAuthDialog({
  document,
  authService,
  returnRoute = () => '/app',
  navigate = (route) => globalThis.location.assign(route),
}) {
  const entry = document.querySelector('#authEntry');
  const signedOutLabel = document.querySelector('#authEntrySignedOut');
  const signedInLabel = document.querySelector('#authEntrySignedIn');
  const dialog = document.querySelector('#authDialog');
  const close = document.querySelector('#authClose');
  const actions = document.querySelector('#authActions');
  const google = document.querySelector('#googleSignIn');
  const demo = document.querySelector('#tryDemo');
  const emailForm = document.querySelector('#emailSignIn');
  const emailInput = document.querySelector('#authEmail');
  const emailButton = document.querySelector('#emailSignInButton');
  const message = document.querySelector('#authMessage');
  let session = null;
  let busy = false;

  function setBusy(value) {
    busy = value;
    google.disabled = value;
    demo.disabled = value;
    emailButton.disabled = value;
    emailInput.disabled = value;
  }

  function showError(error) {
    message.textContent = error?.message || 'Something went wrong. Please try again.';
    setBusy(false);
  }

  function open() {
    if (session) {
      navigate('/app');
      return;
    }
    actions.hidden = false;
    message.textContent = '';
    dialog.showModal();
    google.focus();
  }

  entry.addEventListener('click', open);

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => entry.focus());

  google.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    message.textContent = 'Opening Google…';
    try {
      await authService.signInWithGoogle(returnRoute());
    } catch (error) {
      showError(error);
    }
  });

  demo.addEventListener('click', () => {
    if (busy) return;
    navigate('/app?demo=1');
  });

  emailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!emailForm.checkValidity()) {
      emailForm.reportValidity();
      return;
    }

    setBusy(true);
    message.textContent = 'Sending your sign-in link…';
    try {
      await authService.sendEmailLink(emailInput.value, returnRoute());
      actions.hidden = true;
      message.textContent = 'Check your email for a sign-in link.';
      setBusy(false);
    } catch (error) {
      showError(error);
    }
  });

  return {
    open,
    setSession(nextSession) {
      session = nextSession;
      signedOutLabel.hidden = Boolean(session);
      signedInLabel.hidden = !session;
      if (session) {
        entry.removeAttribute('aria-haspopup');
      } else {
        entry.setAttribute('aria-haspopup', 'dialog');
      }
    },
  };
}

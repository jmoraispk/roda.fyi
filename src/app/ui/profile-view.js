import { detectBrowserTimezone, profilePrefill } from '../profile-service.js';

export function createProfileView({ document, profileService, intl = Intl, onSaved }) {
  const dialog = document.querySelector('#profileDialog');
  const form = document.querySelector('#profileForm');
  const title = document.querySelector('#profileDialogTitle');
  const cancel = document.querySelector('#profileCancel');
  const displayName = document.querySelector('#profileDisplayName');
  const picture = document.querySelector('#profilePicture');
  const automatic = document.querySelector('#automaticTimezone');
  const automaticLabel = document.querySelector('#automaticTimezoneLabel');
  const timezoneOverride = document.querySelector('#timezoneOverride');
  const leaderboardVisible = document.querySelector('#leaderboardVisible');
  const status = document.querySelector('#profileStatus');
  const save = document.querySelector('#saveProfile');
  const detectedTimezone = detectBrowserTimezone(intl);
  let profile = null;
  let required = false;
  let busy = false;

  automaticLabel.textContent = detectedTimezone
    ? `Automatic (${detectedTimezone})`
    : 'Automatic';

  function syncTimezone() {
    timezoneOverride.disabled = automatic.checked;
  }

  function close() {
    if (!required && dialog.open) dialog.close();
  }

  function show({ user, nextProfile, requiredCompletion = false }) {
    profile = nextProfile;
    required = requiredCompletion;
    const values = profilePrefill(user, profile);
    title.textContent = required ? 'Complete your profile' : 'Profile settings';
    cancel.hidden = required;
    displayName.value = values.displayName;
    automatic.checked = values.timezoneChoice === 'Automatic';
    timezoneOverride.value = automatic.checked ? '' : values.timezoneChoice;
    leaderboardVisible.checked = values.leaderboardVisible;
    picture.value = '';
    status.textContent = '';
    syncTimezone();
    if (!dialog.open) dialog.showModal();
    displayName.focus();
  }

  automatic.addEventListener('change', syncTimezone);
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    if (required) event.preventDefault();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.checkValidity()) return;
    busy = true;
    save.disabled = true;
    status.textContent = 'Saving your profile…';
    try {
      await profileService.completeProfile({
        displayName: displayName.value,
        timezoneChoice: automatic.checked ? 'Automatic' : timezoneOverride.value,
        leaderboardVisible: leaderboardVisible.checked,
      });
      if (picture.files[0]) {
        await profileService.uploadProfilePicture(profile.id, picture.files[0]);
      }
      profile = await profileService.loadProfile();
      required = false;
      dialog.close();
      await onSaved(profile);
    } catch (error) {
      status.textContent = error?.message || 'Something went wrong. Please try again.';
    } finally {
      busy = false;
      save.disabled = false;
    }
  });

  return { show, close };
}

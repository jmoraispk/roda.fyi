// src/app/screens/profile-form.js
import { AppError } from '../errors.js';
import { profilePrefill } from '../profile-service.js';
import { el, initials } from '../shell/page.js';

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

export function nameProblem(value) {
  const name = String(value ?? '').trim();
  return name && name.length <= 80 ? null : 'profileForm.nameRequired';
}

export function createProfileForm({ document, i18n, user = null, profile, withSettings = false }) {
  const prefill = profilePrefill(user, profile);
  const name = el(document, 'input', { className: 'field-input', attrs: { name: 'displayName', maxlength: '80', autocomplete: 'name' } });
  name.value = prefill.displayName;
  const preview = el(document, 'div', { className: 'me-avatar profile-preview', text: initials(name.value), attrs: { 'aria-hidden': 'true' } });
  const photo = el(document, 'input', { className: 'field-input', attrs: { type: 'file', name: 'photo', accept: 'image/jpeg,image/png,image/webp' } });
  const url = document.defaultView?.URL;
  let previewUrl = null;
  name.addEventListener('input', () => { if (!previewUrl) preview.textContent = initials(name.value); });
  photo.addEventListener('change', () => {
    const file = photo.files?.[0];
    if (previewUrl) url?.revokeObjectURL?.(previewUrl);
    previewUrl = file ? url?.createObjectURL?.(file) ?? null : null;
    preview.style.backgroundImage = previewUrl ? `url("${previewUrl}")` : '';
    preview.textContent = previewUrl ? '' : initials(name.value);
  });
  const children = [
    el(document, 'div', { className: 'profile-photo-row' }, [preview, field(document, i18n.t('profileForm.photo'), photo)]),
    field(document, i18n.t('profileForm.name'), name),
  ];
  let timezone = null;
  let leaderboard = null;
  if (withSettings) {
    timezone = el(document, 'input', { className: 'field-input', attrs: { name: 'timezone', placeholder: i18n.t('profileForm.automatic'), autocomplete: 'off' } });
    timezone.value = prefill.timezoneChoice === 'Automatic' ? '' : prefill.timezoneChoice;
    leaderboard = el(document, 'input', { attrs: { type: 'checkbox', name: 'leaderboardVisible' } });
    leaderboard.checked = prefill.leaderboardVisible;
    children.push(
      field(document, i18n.t('profileForm.timezone'), timezone),
      el(document, 'label', { className: 'check-row' }, [leaderboard, ` ${i18n.t('profileForm.leaderboard')}`]),
    );
  }
  return {
    element: el(document, 'div', { className: 'profile-form' }, children),
    values() {
      return {
        displayName: name.value,
        file: photo.files?.[0] ?? null,
        timezoneChoice: timezone ? (timezone.value.trim() || 'Automatic') : prefill.timezoneChoice,
        leaderboardVisible: leaderboard ? leaderboard.checked : prefill.leaderboardVisible,
      };
    },
  };
}

// Uploads a newly chosen photo once (memo remembers it across retries), then
// completes the profile, which also sets completed_at the first time.
export async function saveProfile(ctx, values, memo = {}) {
  const problem = nameProblem(values.displayName);
  if (problem) throw new AppError('validation', 'invalid_display_name', ctx.i18n.t(problem));
  if (values.file && memo.uploaded !== values.file) {
    await ctx.services.profile.uploadProfilePicture(ctx.profile.id, values.file);
    memo.uploaded = values.file;
  }
  await ctx.services.profile.completeProfile({
    displayName: values.displayName.trim(),
    timezoneChoice: values.timezoneChoice,
    leaderboardVisible: values.leaderboardVisible,
  });
  return ctx.services.profile.loadProfile();
}

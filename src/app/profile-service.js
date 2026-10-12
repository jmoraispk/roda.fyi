import { AppError, toAppError } from './errors.js';

export function detectBrowserTimezone(intl = Intl) {
  try {
    return intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function resolveTimezoneOverride(choice, intl = Intl) {
  const value = typeof choice === 'string' ? choice.trim() : '';
  if (!value || value.toLowerCase() === 'automatic') return null;

  try {
    intl.DateTimeFormat('en-US', { timeZone: value }).format();
  } catch {
    throw new AppError('validation', 'invalid_timezone', 'Choose a valid timezone.');
  }
  return value;
}

export const USAGE_MODES = Object.freeze(['train', 'both', 'teach']);

export function requireUsageMode(mode) {
  if (!USAGE_MODES.includes(mode)) {
    throw new AppError('validation', 'invalid_usage_mode', 'Choose Train, Both, or Teach.');
  }
  return mode;
}

export function profilePrefill(user, profile) {
  const isComplete = Boolean(profile.completed_at);
  const metadata = user?.user_metadata ?? {};
  const emailName = user?.email?.split('@')[0] ?? '';
  const providerName = metadata.full_name?.trim() || metadata.name?.trim() || emailName;

  return {
    displayName: isComplete
      ? profile.display_name
      : providerName || profile.display_name || 'Capoeirista',
    providerAvatarUrl: !isComplete && !profile.avatar_path
      ? metadata.avatar_url ?? metadata.picture ?? null
      : null,
    timezoneChoice: profile.timezone_override ?? 'Automatic',
    leaderboardVisible: profile.leaderboard_visible ?? true,
  };
}

function unwrap(result) {
  if (result.error) throw toAppError(result.error);
  return result.data;
}

const PROFILE_COLUMNS = 'id, display_name, avatar_path, timezone_override, leaderboard_visible, usage_mode, completed_at, created_at, updated_at';
const COACH_COLUMNS = 'profile_id, activated_at, created_at, updated_at';
const PICTURE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

export function createProfileService(client, options = {}) {
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());

  return {
    async loadProfile() {
      return unwrap(await client
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .single());
    },

    async loadCoachProfile() {
      return unwrap(await client
        .from('coach_profiles')
        .select(COACH_COLUMNS)
        .maybeSingle());
    },

    async completeProfile({ displayName, timezoneChoice, leaderboardVisible }) {
      const normalizedName = displayName?.trim() ?? '';
      if (!normalizedName || normalizedName.length > 80) {
        throw new AppError(
          'validation',
          'invalid_display_name',
          'Display name must be between 1 and 80 characters.',
        );
      }

      return unwrap(await client.rpc('complete_my_profile', {
        display_name: normalizedName,
        timezone_override: resolveTimezoneOverride(timezoneChoice),
        leaderboard_visible: Boolean(leaderboardVisible),
      }));
    },

    async registerAsCoach() {
      return unwrap(await client.rpc('register_as_coach', {}));
    },

    async setUsageMode(mode) {
      return unwrap(await client.rpc('set_usage_mode', { mode: requireUsageMode(mode) }));
    },

    async uploadProfilePicture(profileId, file) {
      const extension = PICTURE_EXTENSIONS[file?.type];
      if (!extension) {
        throw new AppError(
          'validation',
          'invalid_picture_type',
          'Choose a JPEG, PNG, or WebP image.',
        );
      }
      if (file.size > MAX_PICTURE_BYTES) {
        throw new AppError(
          'validation',
          'picture_too_large',
          'Choose an image no larger than 5 MB.',
        );
      }

      const path = `${profileId}/${randomUUID()}.${extension}`;
      unwrap(await client.storage.from('profile-pictures').upload(path, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      }));
      const assignment = unwrap(await client.rpc('set_my_profile_picture', {
        avatar_path: path,
      }));
      return { ...assignment, path };
    },
  };
}

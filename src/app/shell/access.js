// src/app/shell/access.js
export const MODES = Object.freeze(['train', 'both', 'teach']);
const TEACHING_ROUTES = new Set(['teaching-plan', 'teaching-student', 'teaching-record']);

export function modeOf(profile) {
  return MODES.includes(profile?.usage_mode) ? profile.usage_mode : 'train';
}

export function listsTeaching(mode) {
  return mode === 'both' || mode === 'teach';
}

export function isTeachingRoute(route) {
  return TEACHING_ROUTES.has(route.name)
    || (route.name === 'me-section' && route.params.section === 'teaching');
}

// The path to replace the route with, or null to render the route.
export function redirectFor(route, { profile, isCoach }) {
  if (!profile.completed_at) return route.name === 'welcome' ? null : '/welcome';
  if (route.name === 'welcome') return '/';
  if (isTeachingRoute(route) && !listsTeaching(modeOf(profile)) && !isCoach) return '/me';
  return null;
}

export function plusActions(mode) {
  if (mode === 'teach') return ['schedule', 'record'];
  if (mode === 'both') return ['log', 'schedule', 'record'];
  return ['log'];
}

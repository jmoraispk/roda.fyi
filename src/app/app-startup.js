// src/app/app-startup.js
// Startup never hangs: a failing session counts as signed out, a failing
// profile load is reported so the app can show a retry, and a failing coach
// profile load only means "no coaching" until the next start.
export async function loadStartup({ auth, profile }) {
  let session;
  try {
    session = await auth.getSession();
  } catch {
    return { status: 'signed-out' };
  }
  if (!session) return { status: 'signed-out' };
  try {
    const [loaded, coachProfile] = await Promise.all([
      profile.loadProfile(),
      Promise.resolve().then(() => profile.loadCoachProfile?.() ?? null).catch(() => null),
    ]);
    return { status: 'ready', session, profile: loaded, coachProfile: coachProfile ?? null };
  } catch (error) {
    return { status: 'error', error };
  }
}

// Startup never hangs: a failing session counts as signed out, and a failing
// profile load is reported so the app can show a retry instead of a spinner.
export async function loadStartup({ auth, profile }) {
  let session;
  try {
    session = await auth.getSession();
  } catch {
    return { status: 'signed-out' };
  }
  if (!session) return { status: 'signed-out' };
  try {
    return { status: 'ready', session, profile: await profile.loadProfile() };
  } catch (error) {
    return { status: 'error', error };
  }
}

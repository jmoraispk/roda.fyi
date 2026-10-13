const RETURN_ROUTE_KEY = 'roda.auth.returnRoute';

function isSafeLocalRoute(candidate) {
  return typeof candidate === 'string'
    && candidate.startsWith('/')
    && !candidate.startsWith('//')
    && !candidate.startsWith('/\\')
    && !/[\u0000-\u001f\u007f]/.test(candidate);
}

export function sanitizeReturnRoute(candidate, fallback = '/app') {
  const route = typeof candidate === 'string' ? candidate.trim() : candidate;
  return isSafeLocalRoute(route) ? route : fallback;
}

export function rememberReturnRoute(storage, candidate) {
  storage.setItem(RETURN_ROUTE_KEY, sanitizeReturnRoute(candidate));
}

export function consumeReturnRoute({ search = '', storage }) {
  const remembered = sanitizeReturnRoute(
    storage.getItem(RETURN_ROUTE_KEY),
    '/app',
  );
  storage.removeItem(RETURN_ROUTE_KEY);

  const fromQuery = new URLSearchParams(search).get('next');
  return sanitizeReturnRoute(fromQuery, null) ?? remembered;
}

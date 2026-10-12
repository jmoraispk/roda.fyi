// src/app/shell/router.js
const ID = '([A-Za-z0-9-]+)';
const ROUTES = [
  ['today', /^\/?$/, []],
  ['calendar', /^\/calendar(?:\/(\d{4}-\d{2})(?:-(\d{2}))?)?$/, ['month', 'day']],
  ['log', /^\/log$/, []],
  ['training', new RegExp(`^/training/${ID}$`), ['id']],
  ['class', new RegExp(`^/class/${ID}$`), ['id']],
  ['discover', /^\/discover$/, []],
  ['person', new RegExp(`^/person/${ID}$`), ['id']],
  ['group', new RegExp(`^/group/${ID}$`), ['id']],
  ['me', /^\/me$/, []],
  ['me-section', /^\/me\/(progress|repertoire|groups|catalog|settings|teaching)$/, ['section']],
  ['teaching-plan', new RegExp(`^/me/teaching/plans/${ID}$`), ['id']],
  ['teaching-student', new RegExp(`^/me/teaching/students/${ID}$`), ['id']],
  ['welcome', /^\/welcome$/, []],
];

const TABS = {
  today: 'today', calendar: 'calendar', discover: 'discover', person: 'discover', group: 'discover',
  me: 'me', 'me-section': 'me', 'teaching-plan': 'me', 'teaching-student': 'me', welcome: 'me',
};
const DETAIL = new Set([
  'training', 'class', 'log', 'person', 'group', 'me-section', 'teaching-plan', 'teaching-student',
]);

export function parseRoute(hash) {
  const path = String(hash ?? '').replace(/^#/, '').split('?')[0] || '/';
  for (const [name, pattern, keys] of ROUTES) {
    const match = pattern.exec(path);
    if (match) {
      return { name, path, params: Object.fromEntries(keys.map((key, index) => [key, match[index + 1] ?? null])) };
    }
  }
  return { name: 'today', path: '/', params: {}, redirected: true };
}

export function tabFor(route) {
  return TABS[route.name] ?? null;
}

export function isDetail(route) {
  return DETAIL.has(route.name);
}

export function createRouter({ window, onRoute }) {
  // Counts history entries created inside the app, so Back never leaves it.
  let depth = 0;
  let skipNext = false;
  let pendingBack = false;

  function handle() {
    const route = parseRoute(window.location.hash);
    if (route.redirected && window.location.hash && window.location.hash !== '#/') {
      window.history.replaceState(null, '', '#/');
    }
    onRoute(route);
  }
  function onHashChange() {
    if (skipNext) skipNext = false;
    else if (pendingBack) {
      pendingBack = false;
      depth = Math.max(0, depth - 1);
    } else depth += 1;
    handle();
  }
  return {
    start() {
      window.addEventListener('hashchange', onHashChange);
      handle();
    },
    navigate(path) {
      if (window.location.hash === `#${path}`) {
        handle();
        return;
      }
      depth += 1;
      skipNext = true;
      window.location.hash = path;
    },
    back(fallbackPath = '/') {
      if (depth > 0) {
        depth -= 1;
        window.history.back();
        return;
      }
      window.history.replaceState(null, '', `#${fallbackPath}`);
      handle();
    },
    stop() {
      window.removeEventListener('hashchange', onHashChange);
    },
  };
}

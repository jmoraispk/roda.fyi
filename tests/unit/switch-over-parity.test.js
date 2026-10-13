// tests/unit/switch-over-parity.test.js
// Gate for the switch-over: every capability of the old dashboard must have a
// home in the app before the old code is deleted, and must keep it after.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { appModules, sourceOf } from './helpers/module-graph.js';

// Task 9 flips this once this plan's own ports exist.
const PORTS_DONE = true;
const active = (row) => PORTS_DONE || row.owner !== 'plan-4';

// Method names too common to match without their service's name.
const AMBIGUOUS = new Set(['list', 'save', 'remove', 'end', 'request', 'decide']);
const ALIASES = (service) => [`services\\.${service}`, service, `${service}s`, `${service}Service`];

const call = (owner, name, extra = {}) => ({ owner, call: name, ...extra });

// Every service method the old dashboard called. `replacedBy` accepts the
// app's spec-backed replacement instead of the call itself.
const SERVICE_CALLS = [
  call('plan-1', 'auth.getSession'), call('plan-1', 'auth.onAuthStateChange'), call('plan-1', 'auth.signOut'),
  call('plan-1', 'profile.loadProfile'), call('plan-2', 'profile.loadCoachProfile'),
  call('plan-2', 'profile.completeProfile'), call('plan-2', 'profile.uploadProfilePicture'),
  call('plan-2', 'profile.registerAsCoach', { replacedBy: /usage_?[mM]ode/, why: 'Spec: choosing Both or Teach creates the coach profile.' }),
  call('plan-2', 'group.listMyMemberships'), call('plan-4', 'group.resolveDiscoveryToken'),
  call('plan-4', 'group.acceptInvitation'), call('plan-3', 'group.requestAccess'),
  call('plan-3', 'group.searchGroups', { replacedBy: /discover_?[sS]earch|services\.discover\.search\(/, why: 'Spec: Discover search finds groups.' }),
  call('plan-2', 'group.createGroup'), call('plan-2', 'group.updateGroup'),
  call('plan-2', 'group.setGroupTimezone', { replacedBy: /\.updateGroup\(/, why: 'update_group takes the timezone since 202609220001.' }),
  call('plan-2', 'group.archiveGroup'), call('plan-2', 'group.transferOwnership'), call('plan-2', 'group.listRoster'),
  call('plan-2', 'group.removeMember'), call('plan-2', 'group.listJoinRequests'), call('plan-2', 'group.decideJoinRequest'),
  call('plan-2', 'group.createInvitation'), call('plan-2', 'group.rotateDiscoveryLink'), call('plan-2', 'group.revokeDiscoveryLink'),
  call('plan-2', 'group.listRelationships'), call('plan-2', 'group.inviteChildGroup'), call('plan-2', 'group.decideRelationship'),
  call('plan-2', 'group.setRelationshipSharing'), call('plan-2', 'group.revokeRelationship'),
  call('plan-2', 'connection.listMine'), call('plan-2', 'connection.searchCandidates'), call('plan-2', 'connection.request'),
  call('plan-2', 'connection.decide'), call('plan-2', 'connection.end'),
  call('plan-1', 'training.createIdempotencyKey'), call('plan-1', 'training.recordAloneTraining'),
  call('plan-1', 'training.listCalendar'),
  call('plan-1', 'training.listResourceKinds', { replacedBy: /resource_kinds/, why: 'list_my_calendar returns resource_kinds.' }),
  call('plan-1', 'training.saveNotes'), call('plan-1', 'training.saveRoundAssessments'), call('plan-1', 'training.addResource'),
  call('plan-1', 'training.getDay', { replacedBy: /\.getTraining\(/, why: 'Spec: a day sheet lists items that open the training page.' }),
  call('plan-2', 'training.addFeedback'), call('plan-2', 'training.listPlans'), call('plan-2', 'training.createPlan'),
  call('plan-2', 'training.savePlanDraft'), call('plan-2', 'training.publishPlan'), call('plan-2', 'training.scheduleGroupTraining'),
  call('plan-2', 'training.schedulePersonalClass'), call('plan-2', 'training.completeGroupTraining'),
  call('plan-2', 'training.completePersonalClass'), call('plan-2', 'training.recordPastClass'),
  call('plan-2', 'statistics.getPersonal'), call('plan-2', 'statistics.getGroup'), call('plan-2', 'statistics.searchMembers'),
  call('plan-1', 'repertoire.list'), call('plan-2', 'repertoire.save'), call('plan-2', 'repertoire.remove'),
  call('plan-2', 'repertoire.importItems'),
  call('plan-1', 'catalog.amICurator'), call('plan-1', 'catalog.listTermMappings'), call('plan-2', 'catalog.listUncataloguedTerms'),
  call('plan-2', 'catalog.mapTerm'), call('plan-2', 'catalog.mergeTerm'), call('plan-2', 'catalog.ignoreTerm'),
  call('plan-2', 'catalog.setNeedsVideo'),
];

// Query parameters the old dashboard accepted.
const URL_INPUTS = [
  { param: 'demo', owner: 'plan-1' },
  { param: 'member_invite', owner: 'plan-4' },
  { param: 'group_link', owner: 'plan-4' },
];

// Old views the app embeds as components with an injected root.
const REUSED_VIEWS = Object.freeze([
  'src/app/ui/catalog-view.js', 'src/app/ui/repertoire-view.js', 'src/app/ui/resource-view.js', 'src/app/ui/statistics-view.js',
]);

const OLD_SPECS = [
  'auth-dashboard.spec.js', 'training-calendar.spec.js', 'training-resources.spec.js', 'repertoire.spec.js',
  'catalog-curation.spec.js', 'coaching-training.spec.js', 'past-class.spec.js', 'training-statistics.spec.js',
  'coaching-connections.spec.js', 'group-flows.spec.js',
];

const covered = (owner) => (old, ...covers) => ({ old, owner, covers });
const plan1 = covered('plan-1');
const plan2 = covered('plan-2');
const plan3 = covered('plan-3');
const here = covered('plan-4');
const dropped = (old, why) => ({ old, owner: 'spec', dropped: why });

// Every old browser test and the test(s) that cover its behavior now.
const BROWSER_TESTS = [
  here('auth-dashboard.spec.js › keeps the movement library usable around one Google-first sign-in dialog',
    'auth.spec.js › keeps the movement library usable around one Google-first sign-in dialog'),
  here('auth-dashboard.spec.js › offers passwordless email as the secondary sign-in method',
    'auth.spec.js › offers passwordless email as the secondary sign-in method'),
  here('auth-dashboard.spec.js › opens a seeded browser-only demo without an account',
    'auth.spec.js › opens a seeded browser-only demo without an account'),
  here('auth-dashboard.spec.js › uses a compact calendar beside details on desktop and stacked on mobile',
    'app-switch-over.spec.js › Calendar fits a phone and sits beside the training on desktop'),
  here('auth-dashboard.spec.js › shows Entrar only while Portuguese is selected',
    'auth.spec.js › shows Entrar only while Portuguese is selected'),
  here('auth-dashboard.spec.js › uses the same entry as a dashboard action for a signed-in account',
    'auth.spec.js › uses the same entry as a dashboard action for a signed-in account'),
  here('auth-dashboard.spec.js › exchanges a callback once and returns to a safe local destination',
    'auth.spec.js › exchanges a callback once and returns to a safe local destination'),
  here('auth-dashboard.spec.js › scrubs callback data and exposes only safe retry routes on failure',
    'auth.spec.js › scrubs callback data and exposes only safe retry routes on failure'),
  here('auth-dashboard.spec.js › returns unauthenticated dashboard visits to the unified sign-in destination',
    'auth.spec.js › returns unauthenticated dashboard visits to the unified sign-in destination'),
  here('auth-dashboard.spec.js › retries one transient dashboard data failure automatically',
    'app-switch-over.spec.js › a failed startup offers Try again and then opens Today'),
  dropped('auth-dashboard.spec.js › keeps personal training available when group data remains unavailable',
    'Spec "Things that move": the group selector is removed, so startup no longer loads groups.'),
  here('auth-dashboard.spec.js › replaces a failed profile startup with a recoverable error',
    'app-switch-over.spec.js › a failed startup offers Try again and then opens Today'),
  plan2('auth-dashboard.spec.js › previews the profile picture in its circular crop before saving',
    'welcome-screen.test.js › keeps the answers and never uploads the same photo twice after a failure'),
  plan2('auth-dashboard.spec.js › completes the practitioner profile with an optional automatic timezone',
    'app-welcome.spec.js › a new person sets name and mode, then lands on Today',
    'me-screen.test.js › saves the profile from Settings'),
  plan2('auth-dashboard.spec.js › uses a binary mode switch and extends a practitioner through coach registration',
    'app-mode.spec.js › the mode changes + and Teaching in Me without removing coaching'),
  plan1('auth-dashboard.spec.js › keeps a coach in My Training by default and clears private UI on expiry',
    'app-navigation.spec.js › a session that ends while the app is open goes to sign-in'),
  here('auth-dashboard.spec.js › signs out from the dashboard and removes persisted private state',
    'app-hardening.spec.js › signing out sends waiting resources first',
    'app-hardening.spec.js › signing out offline keeps waiting resources and asks to try again'),
  plan2('auth-dashboard.spec.js › keeps private feature workspaces blocked behind required profile completion',
    'app-access.spec.js › finished profiles never see the welcome, unfinished ones always do'),
  plan2('auth-dashboard.spec.js › localizes dashboard modes, tabs, and coach planning in Portuguese',
    'app-shell.spec.js › shows the navigation and moves between destinations',
    'dashboard-i18n.test.js › keeps English and Portuguese translation catalogs structurally complete'),
  plan1('training-calendar.spec.js › records Alone training and opens its calendar details',
    'app-log.spec.js › logs a training from the chat box and opens it',
    'app-calendar.spec.js › Calendar shows the full month and opens a day'),
  here('training-calendar.spec.js › preserves a failed form and retries without duplicate participation',
    'app-switch-over.spec.js › a failed save keeps the composer and a retry records one training'),
  here('training-calendar.spec.js › localizes the calendar action in Portuguese',
    'app-switch-over.spec.js › Calendar speaks Portuguese'),
  here('training-calendar.spec.js › keeps the calendar inside a mobile viewport',
    'app-switch-over.spec.js › Calendar fits a phone and sits beside the training on desktop'),
  here('training-calendar.spec.js › rates a round and a transition from the day detail',
    'app-switch-over.spec.js › rates a round and a transition from the training page'),
  here('training-calendar.spec.js › records a round typed with an unknown move and shows it as new',
    'app-switch-over.spec.js › marks an unknown move as new and records it'),
  here('training-resources.spec.js › adds a video link and a summary file to Alone training',
    'app-log.spec.js › logs a training from the chat box and opens it',
    'app-switch-over.spec.js › adds a summary file from the training page'),
  here('repertoire.spec.js › imports browser sequences once and logs one as training',
    'app-switch-over.spec.js › imports browser sequences once and logs one from Repertoire'),
  here('repertoire.spec.js › saves a round as a sequence from Record training',
    'app-switch-over.spec.js › saves a round as a sequence from Log training'),
  plan2('catalog-curation.spec.js › hides the Catalog tab from non-curators',
    'app-me-pages.spec.js › Progress and Repertoire open from Me, and Catalog is for curators only'),
  plan2('catalog-curation.spec.js › a curator maps a term and the parser recognizes it next time',
    'app-me-pages.spec.js › curators open the Catalog from Me',
    'me-subpages.test.js › lets curators handle uncatalogued words and refreshes recognition'),
  plan2('coaching-training.spec.js › creates and publishes a plan, then schedules a hidden group training',
    'app-teaching.spec.js › a coach writes and publishes a plan, then schedules it'),
  plan2('coaching-training.spec.js › schedules direct and group-derived personal classes with the right authorization context',
    'app-coach-calendar.spec.js › Calendar shows a personal class the coach arranged and opens its class page',
    'student-screen.test.js › schedules for this student and ends coaching after a second tap'),
  plan2('coaching-training.spec.js › does not expose coach scheduling controls to an unregistered practitioner',
    'app-access.spec.js › Teaching sends Train people without coaching back to Me'),
  plan2('coaching-training.spec.js › confirms only attendees, preserves a late-arrival duration, and retries without duplicates',
    'app-class.spec.js › a coach finishes a class from Today with tap-to-mark attendance',
    'class-screen.test.js › shows the plan and finishes once for the people marked here'),
  plan2('coaching-training.spec.js › adds feedback in an authorized context and clears student detail after revocation',
    'app-teaching.spec.js › a coach opens a student and leaves feedback on a training',
    'student-screen.test.js › explains a person who is not my student'),
  plan2('past-class.spec.js › a coach records a past group class with a video link',
    'app-mode.spec.js › a coach records a past class from +'),
  plan2('training-statistics.spec.js › shows personal totals, all selectors, group ranking, pinning, and privacy',
    'statistics-view.test.js › renders a podium, complete ranking, pinned current member, and privacy note',
    'me-subpages.test.js › shows personal statistics and the ranking of the chosen group'),
  plan2('training-statistics.spec.js › localizes statistics in Portuguese',
    'statistics-view.test.js › clears group details when access is revoked and localizes Portuguese copy'),
  plan2('training-statistics.spec.js › stacks the podium within a mobile viewport',
    'app-layout.spec.js › Progress shows its stat cards two per row on a phone'),
  plan2('coaching-connections.spec.js › requests, accepts, and ends a direct coaching connection',
    'app-groups.spec.js › a student asks a coach to coach them',
    'teaching-screen.test.js › accepts a student request and finds a student to coach',
    'groups-screen.test.js › ends coaching with a coach after a second tap'),
  plan2('coaching-connections.spec.js › renders the connection experience in Portuguese',
    'dashboard-i18n.test.js › keeps English and Portuguese translation catalogs structurally complete'),
  plan3('group-flows.spec.js › searches groups, requests member access, and resolves an unlisted link',
    'app-discover.spec.js › opens a group card from search and asks to join'),
  here('group-flows.spec.js › searches groups, requests member access, and resolves an unlisted link',
    'app-switch-over.spec.js › opens an unlisted group link and requests access'),
  plan2('group-flows.spec.js › registers coaching, requests coach access, and creates a group',
    'app-groups.spec.js › a coach creates a group and opens it'),
  plan2('group-flows.spec.js › lets a direct coach approve members, remove members, and create shareable invitations',
    'app-groups.spec.js › a coach invites a student from the group page',
    'group-screen.test.js › lets a coach invite, answer requests, and remove members'),
  plan2('group-flows.spec.js › lets an owner manage coach access and immediate-parent sharing',
    'group-screen.test.js › invites a child group and saves what the parent sees'),
  here('group-flows.spec.js › retains a member invitation through sign-in and explains terminal invitation states',
    'app-switch-over.spec.js › keeps a member invitation through sign-in and explains used links'),
  plan2('group-flows.spec.js › switches between coached groups and clears a group after access is revoked',
    'group-screen.test.js › explains a group I am not in'),
  plan2('group-flows.spec.js › lets a child owner decide a parent invitation and surfaces hierarchy conflicts',
    'group-screen.test.js › gives owners a discovery link, transfer, hierarchy answers, and archive'),
  plan2('group-flows.spec.js › lets an owner rotate discovery links and transfer ownership to an active coach',
    'app-groups.spec.js › an owner creates a discovery link for the group',
    'group-screen.test.js › gives owners a discovery link, transfer, hierarchy answers, and archive'),
  plan2('group-flows.spec.js › lets an owner edit and archive a group',
    'group-screen.test.js › gives owners a discovery link, transfer, hierarchy answers, and archive'),
];

// Modules whose own job is the call (services, fakes, copy) do not count as a use.
const NOT_A_USE = [
  /^src\/app\/[a-z-]+-service\.js$/, /^src\/app\/testing\//, /^src\/app\/supabase-client\.js$/, /^src\/app\/dashboard-i18n\.js$/,
];

async function appCorpus() {
  const modules = (await appModules()).filter((path) => !NOT_A_USE.some((pattern) => pattern.test(path)));
  return Object.values(await sourceOf(modules)).join('\n');
}

function callPattern(name) {
  const [service, method] = name.split('.');
  return AMBIGUOUS.has(method)
    ? new RegExp(`\\b(?:${ALIASES(service).join('|')})\\.${method}(?:\\?\\.)?\\(`)
    : new RegExp(`\\.${method}(?:\\?\\.)?\\(`);
}

function testTitles(file) {
  const path = file.endsWith('.spec.js') ? `tests/e2e/${file}` : `tests/unit/${file}`;
  if (!existsSync(path)) return [];
  const pattern = /^\s*(?:test|it)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm;
  return [...readFileSync(path, 'utf8').matchAll(pattern)].map((match) => match[2].replace(/\\(.)/g, '$1'));
}

describe('switch-over parity audit', () => {
  it('keeps every old dashboard service call in use by the app', async () => {
    const text = await appCorpus();
    const missing = SERVICE_CALLS.filter(active)
      .filter((row) => !callPattern(row.call).test(text) && !(row.replacedBy && row.replacedBy.test(text)));
    expect(missing.map(({ call: name, owner }) => `${name} (${owner})`)).toEqual([]);
  });

  it('reads every query parameter the old dashboard accepted', async () => {
    const text = await appCorpus();
    const missing = URL_INPUTS.filter(active).filter(({ param }) => !text.includes(`'${param}'`));
    expect(missing.map(({ param, owner }) => `${param} (${owner})`)).toEqual([]);
  });

  it.runIf(PORTS_DONE)('has no stopgap screens or links to the classic dashboard', async () => {
    expect(await appModules()).not.toContain('src/app/screens/placeholder.js');
    const text = await appCorpus();
    for (const key of ['app.classic', 'app.comingSoon', 'app.completeProfile']) expect(text).not.toContain(`'${key}'`);
    expect(text).not.toMatch(/['"`]\/dashboard/);
  });

  it('loads no old page view except those reused as components', async () => {
    const views = (await appModules()).filter((path) => /^src\/app\/ui\/.+-view\.js$/.test(path));
    expect(views.filter((path) => !REUSED_VIEWS.includes(path))).toEqual([]);
  });

  it('lists every test of the old browser specs that still exist', () => {
    const listed = new Set(BROWSER_TESTS.map(({ old }) => old));
    const unlisted = OLD_SPECS.flatMap((file) => testTitles(file).map((title) => `${file} › ${title}`))
      .filter((old) => !listed.has(old));
    expect(unlisted).toEqual([]);
  });

  it('covers every old browser test with a new one or a spec-backed drop', () => {
    const problems = [];
    for (const row of BROWSER_TESTS.filter(active)) {
      if (row.dropped) continue;
      if (!row.covers.length) problems.push(`${row.old}: no covering test (${row.owner})`);
      for (const target of row.covers) {
        const [file, title] = target.split(' › ');
        if (!testTitles(file).includes(title)) problems.push(`${row.old}: missing ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.runIf(PORTS_DONE)('keeps only app, sign-in, and public browser specs', () => {
    const stray = readdirSync('tests/e2e').filter((file) => file.endsWith('.spec.js')
      && !/^(app-.+|auth|public-sequences)\.spec\.js$/.test(file));
    expect(stray).toEqual([]);
  });
});

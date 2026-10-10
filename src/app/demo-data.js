const DEMO_VERSION_KEY = 'roda.demo.version';
const DEMO_VERSION = '2';

function monthContext(now) {
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const month = String(monthIndex + 1).padStart(2, '0');
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const date = (day) => `${year}-${month}-${String(Math.min(day, days)).padStart(2, '0')}`;
  return { date };
}

function rounds(...movements) {
  return [{
    label: null,
    source_text: movements.map(([, name]) => `8x ${name}`).join(', '),
    sequence: [],
    movements: movements.map(([key, name], index) => ({
      id: `movement-${key}-${index + 1}`,
      movement_key: key,
      movement_name: name,
      movement_name_snapshot: name,
      catalogued: true,
      segment_key: `m:${index + 1}`,
      repetitions: 8,
    })),
  }];
}

function write(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function seedDemoData(storage, now = new Date()) {
  const session = {
    user: {
      id: 'practitioner-1',
      email: 'demo@roda.fyi',
      user_metadata: { full_name: 'Demo Capoeirista' },
    },
  };
  write(storage, 'roda.e2e.session', session);

  if (storage.getItem(DEMO_VERSION_KEY) === DEMO_VERSION) return;

  const { date } = monthContext(now);
  const profile = {
    id: 'practitioner-1',
    display_name: 'Demo Capoeirista',
    avatar_path: null,
    timezone_override: null,
    leaderboard_visible: true,
    graduation: 'Aluno',
    completed_at: `${date(1)}T12:00:00Z`,
  };
  const coachProfile = {
    profile_id: 'practitioner-1',
    activated_at: `${date(1)}T12:00:00Z`,
  };
  const group = {
    id: 'demo-group', slug: 'roda-da-lua', owner_id: 'practitioner-1',
    name: 'Roda da Lua', description: 'A sample group to explore the dashboard.',
    location: 'Lisbon', timezone: 'Europe/Lisbon', picture_path: null,
    is_discoverable: true, archived_at: null,
  };
  const membership = {
    group_id: group.id, profile_id: 'practitioner-1', access_level: 'coach',
    state: 'active', joined_at: `${date(1)}T12:00:00Z`, group,
  };
  const roster = [
    { profile_id: 'practitioner-1', display_name: 'Demo Capoeirista', access_level: 'member', membership_state: 'active', leaderboard_visible: true, graduation: 'Aluno' },
    { profile_id: 'student-bia', display_name: 'Bia Santos', access_level: 'member', membership_state: 'active', leaderboard_visible: true, graduation: 'Graduada' },
    { profile_id: 'student-caio', display_name: 'Caio Lima', access_level: 'member', membership_state: 'active', leaderboard_visible: true, graduation: 'Aluno' },
    { profile_id: 'student-duda', display_name: 'Duda Reis', access_level: 'member', membership_state: 'active', leaderboard_visible: true, graduation: 'Instrutora' },
  ];

  const definitions = [
    ['demo-alone-1', 'practitioner-1', date(3), 45, 'alone', null, rounds(['ginga', 'Ginga'], ['armada', 'Armada'])],
    ['demo-group-1', 'practitioner-1', date(8), 60, 'group', group.id, rounds(['ginga', 'Ginga'], ['au', 'Aú'])],
    ['demo-class-1', 'practitioner-1', date(14), 50, 'personal_class', group.id, rounds(['meia-lua-de-compasso', 'Meia Lua de Compasso'])],
    ['demo-alone-2', 'practitioner-1', date(20), 36, 'alone', null, rounds(['au', 'Aú'], ['armada', 'Armada'])],
    ['bia-1', 'student-bia', date(4), 70, 'group', group.id, rounds(['armada', 'Armada'])],
    ['bia-2', 'student-bia', date(16), 55, 'alone', null, rounds(['ginga', 'Ginga'])],
    ['caio-1', 'student-caio', date(11), 95, 'group', group.id, rounds(['au', 'Aú'])],
    ['duda-1', 'student-duda', date(17), 80, 'alone', null, rounds(['meia-lua-de-compasso', 'Meia Lua de Compasso'])],
  ];
  const occurrences = definitions.map(([id, , localDate, minutes, kind, groupId, sessionRounds]) => ({
    id, kind, group_id: groupId, recorded_by: 'practitioner-1',
    local_date: localDate, occurred_at: `${localDate}T18:00:00Z`,
    timezone: 'Europe/Lisbon', default_duration_minutes: minutes,
    idempotency_key: `demo-${id}`, rounds: sessionRounds,
  }));
  const participations = definitions.map(([id, profileId, localDate, minutes]) => ({
    id: `participation-${id}`, occurrence_id: id, profile_id: profileId,
    actual_duration_minutes: minutes,
    personal_notes: profileId === 'practitioner-1' ? 'Sample notes from this training.' : null,
    confirmed_at: `${localDate}T18:00:00Z`,
  }));
  const plan = {
    plan_id: 'demo-plan', version_id: 'demo-plan-v1', version_number: 1,
    title: 'Ginga and counter-flow', description: 'A sample plan for group practice.',
    source_group_id: group.id, state: 'published', expected_duration_minutes: 60,
    instructions: 'Stay relaxed and keep the movement continuous.',
    published_at: `${date(2)}T12:00:00Z`, updated_at: `${date(2)}T12:00:00Z`,
    rounds: rounds(['ginga', 'Ginga'], ['armada', 'Armada'], ['au', 'Aú']),
  };
  const schedule = {
    id: 'demo-schedule', kind: 'group', state: 'scheduled',
    plan_version_id: plan.version_id, group_id: group.id,
    student_profile_id: null, connection_id: null, arranged_by: 'practitioner-1',
    starts_at: `${date(26)}T18:00:00Z`, local_date: date(26),
    timezone: 'Europe/Lisbon', duration_minutes: 60, visible_in_advance: true,
  };

  write(storage, 'roda.e2e.profile', profile);
  write(storage, 'roda.e2e.coachProfile', coachProfile);
  write(storage, 'roda.e2e.memberships', [membership]);
  write(storage, 'roda.e2e.groupState', {
    groups: [group], memberships: [membership], rosters: { [group.id]: roster },
    joinRequests: {}, invitations: {}, relationships: {}, discoveryTokens: {},
    invitationTokens: {}, revokedGroupIds: [], discoveryCounter: 0,
  });
  write(storage, 'roda.e2e.connectionState', {
    people: { 'student-bia': 'Bia Santos', 'student-caio': 'Caio Lima' },
    connections: [{
      connection_id: 'demo-connection', connection_kind: 'direct', state: 'active',
      coach_profile_id: 'practitioner-1', coach_display_name: 'Demo Capoeirista',
      student_profile_id: 'student-bia', student_display_name: 'Bia Santos',
      initiated_by: 'student-bia',
    }],
  });
  write(storage, 'roda.e2e.trainingState', {
    plans: [plan], schedules: [schedule], occurrences, participations,
    assessments: [{
      id: 'demo-assessment', participation_id: 'participation-demo-alone-1',
      movement_id: 'movement-armada-2', difficulty: 'hard',
      note: 'Keep the supporting foot turning.',
    }],
    feedback: [{
      id: 'demo-feedback', participation_id: 'participation-demo-group-1',
      coach_profile_id: 'coach-sample', group_id: group.id, connection_id: null,
      coach_name: 'Professora Lua', body: 'Good rhythm. Let the shoulders stay loose.',
      created_at: `${date(8)}T20:00:00Z`,
    }],
    roundRatings: {
      'participation-demo-alone-1': {
        'demo-alone-1-round-1': [
          { segment_key: 'r', segment_kind: 'round', difficulty: 'okay', note: null, from_movement_key: null, to_movement_key: null },
          {
            segment_key: 't:1>2', segment_kind: 'transition', difficulty: 'hard',
            note: 'Turn the hips before the kick.', from_movement_key: 'ginga', to_movement_key: 'armada',
          },
        ],
      },
    },
    resources: [{
      id: 'demo-resource-1', occurrence_id: 'demo-group-1', kind: 'video', title: 'Class recording',
      url: 'https://www.youtube.com/', body: null, added_by: 'practitioner-1',
    }],
    counter: 50, failNext: null, revokeReadsFor: [],
  });
  write(storage, 'roda.e2e.repertoireState', {
    counter: 1,
    items: [{
      id: 'sequence-1', profile_id: 'practitioner-1', import_ref: null, title: 'Armada into aú',
      source_text: '10x (armada, aú)', sequence: null, updated_at: now.toISOString(),
    }],
  });
  storage.setItem(DEMO_VERSION_KEY, DEMO_VERSION);
}

import {
  addMovement,
  addRound,
  createPlanDraft,
  moveMovement,
  moveRound,
  removeMovement,
  serializePlanDraft,
} from '../training-plan-state.js';

const MOVEMENTS = ['Ginga', 'Armada', 'Au', 'Bencao', 'Meia Lua de Frente', 'Galopante', 'Godeme', 'Elbow strike', 'Escala'];

function safeMessage(error, fallback) {
  return error?.message || fallback;
}

function showDialog(dialog) {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (!dialog.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function element(document, tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.name) node.name = options.name;
  if (options.type) node.type = options.type;
  if (options.value !== undefined) node.value = options.value;
  if (options.required) node.required = true;
  if (options.disabled) node.disabled = true;
  if (options.action) node.dataset.action = options.action;
  if (options.label) node.setAttribute('aria-label', options.label);
  return node;
}

function field(document, labelText, input) {
  const label = element(document, 'label', { className: 'field-label', text: labelText });
  label.append(input);
  return label;
}

function zonedParts(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
}

export function scheduledInstant(date, time, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(`${date}T${time}`);
  if (!match) throw new RangeError('Enter a valid training date and time.');
  const desired = match.slice(1).map(Number);
  const desiredEpoch = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4]);
  let candidate = desiredEpoch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(candidate, timezone);
    const observedEpoch = Date.UTC(
      observed.year, observed.month - 1, observed.day,
      observed.hour, observed.minute, observed.second,
    );
    candidate -= observedEpoch - desiredEpoch;
  }
  const final = zonedParts(candidate, timezone);
  if ([final.year, final.month, final.day, final.hour, final.minute]
    .some((value, index) => value !== desired[index])) {
    throw new RangeError('That local time does not exist in the selected timezone.');
  }
  return new Date(candidate).toISOString();
}

function normalizePlan(plan) {
  return createPlanDraft({
    id: plan.plan_id ?? plan.id,
    versionId: plan.version_id ?? plan.versionId,
    expectedUpdatedAt: plan.updated_at ?? plan.expectedUpdatedAt,
    title: plan.title,
    description: plan.description,
    groupId: plan.source_group_id ?? plan.groupId,
    durationMinutes: plan.expected_duration_minutes ?? plan.durationMinutes,
    instructions: plan.instructions,
    published: (plan.state ?? '').toLowerCase() === 'published' || plan.published,
    rounds: (plan.rounds ?? []).map((round, roundIndex) => ({
      id: round.id ?? `round-${roundIndex}`,
      label: round.label ?? '',
      repetitions: round.repetitions ?? null,
      durationSeconds: round.duration_seconds ?? round.durationSeconds ?? null,
      restSeconds: round.rest_seconds ?? round.restSeconds ?? null,
      instructions: round.instructions ?? '',
      movements: (round.movements ?? []).map((movement, movementIndex) => ({
        id: movement.id ?? `movement-${roundIndex}-${movementIndex}`,
        movementKey: movement.movement_key ?? movement.movementKey ?? '',
        movementName: movement.movement_name ?? movement.movementName ?? '',
        side: movement.side ?? '',
        repetitions: movement.repetitions ?? null,
        durationSeconds: movement.duration_seconds ?? movement.durationSeconds ?? null,
        instructions: movement.instructions ?? '',
      })),
    })),
  });
}

export function createCoachingTrainingView({
  document,
  trainingService,
  connectionService,
  groupService,
  i18n,
  timezone = 'UTC',
  profileId,
  onAccessRevoked = async () => {},
}) {
  const workspace = document.querySelector('#coachingTrainingWorkspace');
  const studentWorkspace = document.querySelector('#coachingStudentsPanel');
  const status = document.querySelector('#coachingTrainingStatus');
  const planDialog = document.querySelector('#workoutPlanDialog');
  const planForm = document.querySelector('#workoutPlanForm');
  const scheduleDialog = document.querySelector('#scheduleTrainingDialog');
  const scheduleForm = document.querySelector('#scheduleTrainingForm');
  const completionDialog = element(document, 'dialog', { className: 'profile-dialog group-dialog' });
  completionDialog.setAttribute('aria-label', i18n.t('coach.confirmDialog'));
  const completionForm = element(document, 'form');
  completionForm.dataset.completionForm = '';
  completionDialog.append(completionForm);
  document.body.append(completionDialog);
  let context = { mode: 'training', activeTab: null, groupId: null, isCoach: false };
  let plans = [];
  let connections = [];
  let roster = [];
  let schedules = [];
  let editorState = null;
  let scheduleState = null;
  let loadToken = 0;
  let savingPlan = false;
  let scheduling = false;
  let completing = false;
  let completionState = null;
  let selectedStudentId = null;
  let localCounter = 0;

  function nextId() {
    localCounter += 1;
    return `editor-${localCounter}`;
  }

  function active() {
    return context.mode === 'coaching' && context.activeTab === 'schedule' && context.isCoach;
  }

  function studentsActive() {
    return context.mode === 'coaching' && context.activeTab === 'students' && context.isCoach;
  }

  function coachingActive() {
    return active() || studentsActive();
  }

  function coachStudents() {
    const byId = new Map();
    for (const connection of connections) {
      if (connection.state !== 'active' || connection.coach_profile_id !== profileId) continue;
      byId.set(connection.student_profile_id, {
        profileId: connection.student_profile_id,
        name: connection.student_display_name,
        kind: connection.connection_kind,
        connectionId: connection.connection_kind === 'direct' ? connection.connection_id : null,
        groupId: connection.connection_kind === 'group' ? connection.group_id : null,
      });
    }
    for (const member of roster) {
      if (member.access_level !== 'member') continue;
      const prior = byId.get(member.profile_id);
      if (!prior) {
        byId.set(member.profile_id, {
          profileId: member.profile_id, name: member.display_name,
          kind: 'group', connectionId: null, groupId: context.groupId,
        });
      }
    }
    return [...byId.values()];
  }

  function clearPrivate() {
    plans = [];
    connections = [];
    roster = [];
    schedules = [];
    editorState = null;
    scheduleState = null;
    workspace.replaceChildren();
    studentWorkspace.replaceChildren();
    status.textContent = '';
    closeDialog(planDialog);
    closeDialog(scheduleDialog);
    closeDialog(completionDialog);
    completionForm.replaceChildren();
    selectedStudentId = null;
  }

  async function revoke(groupId) {
    clearPrivate();
    await onAccessRevoked(groupId);
  }

  function actionButton(label, action, value = null) {
    const button = element(document, 'button', {
      type: 'button', className: 'secondary-button', text: label, action,
    });
    if (value !== null) button.dataset.value = value;
    return button;
  }

  function render() {
    workspace.replaceChildren();
    if (!active()) return;
    const header = element(document, 'div', { className: 'coaching-training-header' });
    header.append(
      element(document, 'div', { className: 'dashboard-eyebrow', text: i18n.t('coach.planning') }),
      element(document, 'h2', { text: i18n.t('coach.schedule') }),
      actionButton(i18n.t('coach.createPlan'), 'new-plan'),
    );
    workspace.append(header);

    const planList = element(document, 'div', { className: 'workout-plan-list' });
    for (const plan of plans) {
      const card = element(document, 'article', { className: 'workout-plan-card' });
      card.dataset.planId = plan.id;
      card.append(
        element(document, 'h3', { text: plan.title }),
        element(document, 'p', {
          text: `${i18n.t('coach.minutes', { count: plan.durationMinutes })} · ${i18n.t(plan.published ? 'coach.published' : 'coach.draft')}`,
        }),
        actionButton(i18n.t(plan.published ? 'coach.viewPlan' : 'coach.editPlan'), 'edit-plan', plan.id),
      );
      if (plan.published) {
        if (context.groupId) card.append(actionButton(i18n.t('coach.scheduleGroup'), 'schedule-group', plan.versionId));
        for (const student of coachStudents()) {
          const button = actionButton(i18n.t('coach.schedulePersonal', { name: student.name }), 'schedule-personal', plan.versionId);
          button.dataset.studentId = student.profileId;
          card.append(button);
        }
      }
      planList.append(card);
    }
    if (plans.length === 0) {
      planList.append(element(document, 'p', {
        className: 'calendar-empty', text: i18n.t('coach.noPlans'),
      }));
    }
    workspace.append(planList);

    const scheduledList = element(document, 'section', { className: 'scheduled-training-list' });
    scheduledList.append(element(document, 'h2', { text: i18n.t('coach.awaiting') }));
    for (const schedule of schedules) {
      const card = element(document, 'article', { className: 'scheduled-training-card' });
      card.dataset.scheduleId = schedule.item_id;
      card.append(
        element(document, 'h3', { text: schedule.plan_title || i18n.t(schedule.kind === 'group' ? 'coach.groupTraining' : 'coach.personalClass') }),
        element(document, 'p', { text: `${schedule.local_date} · ${i18n.t('coach.minutes', { count: schedule.duration_minutes ?? 0 })}` }),
        element(document, 'p', { text: i18n.t('coach.awaitingExcluded') }),
        actionButton(i18n.t('coach.confirm'), 'confirm-training', schedule.item_id),
      );
      scheduledList.append(card);
    }
    if (schedules.length === 0) {
      scheduledList.append(element(document, 'p', {
        className: 'calendar-empty', text: i18n.t('coach.noAwaiting'),
      }));
    }
    workspace.append(scheduledList);
  }

  function renderStudents() {
    studentWorkspace.replaceChildren();
    if (!studentsActive()) return;
    const heading = element(document, 'div', { className: 'coaching-training-header' });
    heading.append(
      element(document, 'div', { className: 'dashboard-eyebrow', text: i18n.t('coach.studentTraining') }),
      element(document, 'h2', { text: i18n.t('coach.students') }),
    );
    studentWorkspace.append(heading);
    const list = element(document, 'div', { className: 'coaching-student-list' });
    for (const student of coachStudents()) {
      const card = element(document, 'article', { className: 'workout-plan-card' });
      card.append(
        element(document, 'h3', { text: student.name }),
        actionButton(i18n.t('coach.viewStudent', { name: student.name }), 'view-student-training', student.profileId),
      );
      list.append(card);
    }
    if (coachStudents().length === 0) {
      list.append(element(document, 'p', { className: 'calendar-empty', text: i18n.t('coach.noStudents') }));
    }
    studentWorkspace.append(list, element(document, 'section', { className: 'coaching-student-detail' }));
  }

  async function loadStudentTraining(studentId) {
    const token = ++loadToken;
    selectedStudentId = studentId;
    const target = studentWorkspace.querySelector('.coaching-student-detail');
    if (!target) return;
    target.textContent = i18n.t('coach.loadingStudent');
    const year = new Date().getFullYear();
    try {
      const items = await trainingService.listCalendar({
        start: `${year}-01-01`, endExclusive: `${year + 1}-01-01`, profileId: studentId,
      });
      if (token !== loadToken || selectedStudentId !== studentId || !studentsActive()) return;
      target.replaceChildren();
      const student = coachStudents().find(({ profileId: id }) => id === studentId);
      target.append(element(document, 'h3', { text: i18n.t('coach.completedStudent', { name: student?.name ?? i18n.t('coach.students') }) }));
      for (const item of items.filter(({ item_type: type }) => type === 'completed')) {
        const card = element(document, 'article', { className: 'scheduled-training-card' });
        card.append(
          element(document, 'strong', { text: `${item.local_date} · ${i18n.t('coach.minutes', { count: item.duration_minutes })}` }),
          actionButton(i18n.t('coach.openDetails'), 'open-student-day', item.local_date),
        );
        card.querySelector('[data-action="open-student-day"]').dataset.studentId = studentId;
        target.append(card);
      }
      if (!items.some(({ item_type: type }) => type === 'completed')) {
        target.append(element(document, 'p', { className: 'calendar-empty', text: i18n.t('coach.noCompleted') }));
      }
    } catch (error) {
      if (error?.kind === 'authorization' || error?.kind === 'authentication') await revoke(context.groupId);
      else target.textContent = safeMessage(error, i18n.t('coach.studentLoadError'));
    }
  }

  async function openStudentDay(studentId, localDate) {
    const token = ++loadToken;
    selectedStudentId = studentId;
    const target = studentWorkspace.querySelector('.coaching-student-detail');
    if (!target) return;
    target.textContent = i18n.t('coach.loadingDetails');
    try {
      const items = await trainingService.getDay({ localDate, profileId: studentId });
      if (token !== loadToken || selectedStudentId !== studentId || !studentsActive()) return;
      target.replaceChildren();
      target.append(actionButton(i18n.t('coach.backHistory'), 'view-student-training', studentId));
      for (const item of items) {
        const card = element(document, 'article', { className: 'training-day-card' });
        card.dataset.localDate = localDate;
        card.append(
          element(document, 'h3', { text: `${i18n.t(item.kind === 'group' ? 'coach.groupTraining' : 'coach.personalClass')} · ${i18n.t('coach.minutes', { count: item.duration_minutes })}` }),
        );
        for (const feedback of item.feedback ?? []) {
          card.append(element(document, 'p', {
            text: `${feedback.coach_name ?? 'Coach'} · ${feedback.body}`,
          }));
        }
        if ((item.feedback_contexts ?? []).length) {
          const form = element(document, 'form');
          form.dataset.studentFeedback = item.participation_id;
          const contextSelect = element(document, 'select', { name: 'context', label: i18n.t('training.feedbackContext') });
          contextSelect.className = 'field-input';
          for (const feedbackContext of item.feedback_contexts) {
            contextSelect.append(element(document, 'option', {
              value: `${feedbackContext.kind}:${feedbackContext.id}`, text: feedbackContext.label,
            }));
          }
          const body = element(document, 'textarea', { name: 'body', required: true, label: i18n.t('training.feedbackBody') });
          body.className = 'field-input field-textarea';
          const submit = element(document, 'button', {
            type: 'submit', className: 'secondary-button', text: i18n.t('training.addFeedback'),
          });
          const feedbackStatus = element(document, 'p', { className: 'profile-status' });
          feedbackStatus.setAttribute('role', 'status');
          form.append(contextSelect, body, submit, feedbackStatus);
          card.append(form);
        }
        target.append(card);
      }
    } catch (error) {
      if (error?.kind === 'authorization' || error?.kind === 'authentication') await revoke(context.groupId);
      else target.textContent = safeMessage(error, i18n.t('coach.detailsLoadError'));
    }
  }

  function renderCompletionForm() {
    completionForm.replaceChildren();
    const schedule = completionState.schedule;
    const close = actionButton('×', 'close-completion');
    close.className = 'profile-close';
    close.setAttribute('aria-label', i18n.t('coach.closeConfirmation'));
    const duration = element(document, 'input', {
      type: 'number', name: 'completionDuration', value: schedule.duration_minutes ?? 60,
      required: true,
    });
    duration.className = 'field-input';
    duration.min = '1';
    duration.max = '1440';
    completionForm.append(
      close,
      element(document, 'div', { className: 'profile-kicker', text: i18n.t('coach.confirmation') }),
      element(document, 'h1', { text: i18n.t('coach.confirmCompleted') }),
      field(document, i18n.t('coach.actualDuration'), duration),
    );
    if (schedule.kind === 'group') {
      const fieldset = element(document, 'fieldset', { className: 'attendance-list' });
      fieldset.append(element(document, 'legend', { text: i18n.t('coach.attendance') }));
      for (const member of roster.filter(({ access_level: level }) => level === 'member')) {
        const row = element(document, 'div', { className: 'attendance-row' });
        const checkbox = element(document, 'input', { type: 'checkbox', name: 'attendee', value: member.profile_id });
        checkbox.checked = completionState.attendees.get(member.profile_id)?.selected ?? true;
        const override = element(document, 'input', {
          type: 'number', value: completionState.attendees.get(member.profile_id)?.duration ?? schedule.duration_minutes ?? 60,
          label: i18n.t('coach.memberDuration', { name: member.display_name }),
        });
        override.className = 'field-input';
        override.min = '1';
        override.max = '1440';
        override.dataset.attendeeDuration = member.profile_id;
        const name = element(document, 'label', { text: member.display_name });
        name.prepend(checkbox);
        row.append(name, override);
        fieldset.append(row);
      }
      completionForm.append(fieldset);
    }
    completionForm.append(
      element(document, 'p', { className: 'profile-status', action: null }),
      Object.assign(element(document, 'button', {
        type: 'submit', className: 'primary-button', text: i18n.t('coach.confirmCount'),
      }), { disabled: completing }),
    );
    completionForm.querySelector('.profile-status').setAttribute('role', 'status');
  }

  function openCompletion(scheduleId) {
    if (!active()) return;
    const schedule = schedules.find(({ item_id: id }) => id === scheduleId);
    if (!schedule) return;
    completionState = {
      schedule,
      idempotencyKey: trainingService.createIdempotencyKey(),
      attendees: new Map(roster
        .filter(({ access_level: level }) => level === 'member')
        .map((member) => [member.profile_id, {
          selected: true, duration: schedule.duration_minutes ?? 60,
        }])),
    };
    renderCompletionForm();
    showDialog(completionDialog);
  }

  async function completeGroup(input) {
    return trainingService.completeGroupTraining({
      ...input,
      idempotencyKey: input.idempotencyKey ?? completionState?.idempotencyKey
        ?? trainingService.createIdempotencyKey(),
    });
  }

  function syncEditor() {
    if (!editorState || !planForm.querySelector('[name="planTitle"]')) return;
    editorState = {
      ...editorState,
      title: planForm.elements.planTitle.value,
      description: planForm.elements.planDescription.value,
      durationMinutes: planForm.elements.planDuration.value,
      instructions: planForm.elements.planInstructions.value,
      rounds: [...planForm.querySelectorAll('[data-plan-round]')].map((round) => ({
        id: round.dataset.planRound,
        label: round.querySelector('[name="roundLabel"]').value,
        repetitions: round.querySelector('[name="roundRepetitions"]').value,
        durationSeconds: round.querySelector('[name="roundDuration"]').value,
        restSeconds: round.querySelector('[name="roundRest"]').value,
        instructions: round.querySelector('[name="roundInstructions"]').value,
        movements: [...round.querySelectorAll('[data-plan-movement]')].map((movement) => ({
          id: movement.dataset.planMovement,
          movementKey: movement.querySelector('[name="movementName"]').value,
          movementName: movement.querySelector('[name="movementName"]').value,
          side: movement.querySelector('[name="movementSide"]').value,
          repetitions: movement.querySelector('[name="movementRepetitions"]').value,
          durationSeconds: movement.querySelector('[name="movementDuration"]').value,
          instructions: movement.querySelector('[name="movementInstructions"]').value,
        })),
      })),
    };
  }

  function renderPlanForm() {
    planForm.replaceChildren();
    planDialog.setAttribute('aria-label', i18n.t('coach.planDialog'));
    const readOnly = editorState.published;
    const close = actionButton('×', 'close-plan');
    close.className = 'profile-close';
    close.setAttribute('aria-label', i18n.t('coach.closePlan'));
    const title = element(document, 'input', {
      name: 'planTitle', value: editorState.title, required: true, disabled: readOnly,
    });
    title.className = 'field-input';
    const description = element(document, 'textarea', {
      name: 'planDescription', value: editorState.description, disabled: readOnly,
    });
    description.className = 'field-input field-textarea';
    const duration = element(document, 'input', {
      type: 'number', name: 'planDuration', value: editorState.durationMinutes,
      required: true, disabled: readOnly,
    });
    duration.className = 'field-input';
    duration.min = '1';
    duration.max = '1440';
    const instructions = element(document, 'textarea', {
      name: 'planInstructions', value: editorState.instructions, disabled: readOnly,
    });
    instructions.className = 'field-input field-textarea';
    planForm.append(
      close,
      element(document, 'div', { className: 'profile-kicker', text: i18n.t(readOnly ? 'coach.publishedPlan' : 'coach.workoutPlan') }),
      element(document, 'h1', { text: readOnly ? editorState.title : i18n.t(editorState.id ? 'coach.editWorkoutPlan' : 'coach.createWorkoutPlan') }),
      field(document, i18n.t('coach.planTitle'), title),
      field(document, i18n.t('coach.description'), description),
      field(document, i18n.t('coach.expectedDuration'), duration),
      field(document, i18n.t('coach.instructions'), instructions),
    );
    const rounds = element(document, 'div', { className: 'plan-rounds' });
    editorState.rounds.forEach((round, index) => {
      const box = element(document, 'fieldset', { className: 'plan-round' });
      box.dataset.planRound = round.id;
      box.append(element(document, 'legend', { text: i18n.t('coach.round', { number: index + 1 }) }));
      const label = element(document, 'input', { name: 'roundLabel', value: round.label, disabled: readOnly });
      const repetitions = element(document, 'input', { type: 'number', name: 'roundRepetitions', value: round.repetitions ?? '', disabled: readOnly });
      const roundDuration = element(document, 'input', { type: 'number', name: 'roundDuration', value: round.durationSeconds ?? '', disabled: readOnly });
      const rest = element(document, 'input', { type: 'number', name: 'roundRest', value: round.restSeconds ?? '', disabled: readOnly });
      const roundInstructions = element(document, 'input', { name: 'roundInstructions', value: round.instructions, disabled: readOnly });
      for (const input of [label, repetitions, roundDuration, rest, roundInstructions]) input.className = 'field-input';
      box.append(
        field(document, i18n.t('coach.roundLabel'), label),
        field(document, i18n.t('coach.roundRepetitions'), repetitions),
        field(document, i18n.t('coach.roundDuration'), roundDuration),
        field(document, i18n.t('coach.rest'), rest),
        field(document, i18n.t('coach.roundInstructions'), roundInstructions),
      );
      if (!readOnly) {
        box.append(
          actionButton(i18n.t('coach.moveRoundUp'), 'move-round-up'),
          actionButton(i18n.t('coach.moveRoundDown'), 'move-round-down'),
        );
      }
      const movementList = element(document, 'div', { className: 'plan-movement-list' });
      round.movements.forEach((movement) => {
        const row = element(document, 'div', { className: 'plan-movement' });
        row.dataset.planMovement = movement.id;
        const name = element(document, 'input', { name: 'movementName', value: movement.movementName, required: true, disabled: readOnly });
        name.className = 'field-input';
        name.setAttribute('list', 'capoeiraMovementNames');
        const side = element(document, 'select', { name: 'movementSide', disabled: readOnly });
        for (const [value, key] of [['', 'anySide'], ['left', 'left'], ['right', 'right'], ['both', 'both']]) {
          const text = i18n.t(`coach.${key}`);
          const option = element(document, 'option', { value, text });
          option.selected = movement.side === value;
          side.append(option);
        }
        const movementRepetitions = element(document, 'input', { type: 'number', name: 'movementRepetitions', value: movement.repetitions ?? '', disabled: readOnly });
        const movementDuration = element(document, 'input', { type: 'number', name: 'movementDuration', value: movement.durationSeconds ?? '', disabled: readOnly });
        const movementInstructions = element(document, 'input', { name: 'movementInstructions', value: movement.instructions, disabled: readOnly });
        for (const input of [side, movementRepetitions, movementDuration, movementInstructions]) input.className = 'field-input';
        row.append(
          field(document, i18n.t('coach.movement'), name),
          field(document, i18n.t('coach.side'), side),
          field(document, i18n.t('coach.movementRepetitions'), movementRepetitions),
          field(document, i18n.t('coach.movementDuration'), movementDuration),
          field(document, i18n.t('coach.movementInstructions'), movementInstructions),
        );
        if (!readOnly) {
          row.append(
            actionButton(i18n.t('coach.moveMovementUp'), 'move-movement-up'),
            actionButton(i18n.t('coach.moveMovementDown'), 'move-movement-down'),
            actionButton(i18n.t('coach.removeMovement'), 'remove-movement'),
          );
        }
        movementList.append(row);
      });
      box.append(movementList);
      if (!readOnly) box.append(actionButton(i18n.t('coach.addMovement'), 'add-plan-movement'));
      rounds.append(box);
    });
    planForm.append(rounds);
    const names = element(document, 'datalist');
    names.id = 'capoeiraMovementNames';
    MOVEMENTS.forEach((name) => names.append(element(document, 'option', { value: name })));
    planForm.append(names);
    if (!readOnly) {
      const actions = element(document, 'div', { className: 'dashboard-actions' });
      actions.append(
        actionButton(i18n.t('coach.addRound'), 'add-round'),
        Object.assign(element(document, 'button', {
          type: 'submit', className: 'primary-button', text: i18n.t('coach.saveDraft'), action: 'save-plan',
        }), { disabled: savingPlan }),
      );
      if (editorState.id) actions.append(actionButton(i18n.t('coach.publishPlan'), 'publish-plan'));
      planForm.append(actions);
    }
    planForm.append(element(document, 'p', { className: 'profile-status' }));
  }

  function openPlanEditor(planId = null) {
    if (!active()) return;
    const plan = plans.find(({ id }) => id === planId);
    editorState = plan ? normalizePlan(plan) : createPlanDraft({ groupId: context.groupId, durationMinutes: 60 });
    renderPlanForm();
    showDialog(planDialog);
  }

  function renderScheduleForm() {
    scheduleForm.replaceChildren();
    scheduleDialog.setAttribute('aria-label', i18n.t('coach.scheduleDialog'));
    const close = actionButton('×', 'close-schedule');
    close.className = 'profile-close';
    close.setAttribute('aria-label', i18n.t('coach.closeSchedule'));
    const date = element(document, 'input', { type: 'date', name: 'scheduleDate', required: true });
    const time = element(document, 'input', { type: 'time', name: 'scheduleTime', required: true });
    const visible = element(document, 'input', { type: 'checkbox', name: 'scheduleVisible' });
    visible.checked = true;
    scheduleForm.append(
      close,
      element(document, 'div', { className: 'profile-kicker', text: i18n.t('coach.scheduling') }),
      element(document, 'h1', { text: i18n.t(scheduleState.kind === 'group' ? 'coach.scheduleGroup' : 'coach.schedulePersonalTitle') }),
      field(document, i18n.t('coach.trainingDate'), date),
      field(document, i18n.t('coach.startTime'), time),
      field(document, i18n.t('coach.showBefore'), visible),
      element(document, 'p', { className: 'profile-status' }),
      Object.assign(element(document, 'button', {
        type: 'submit', className: 'primary-button', text: i18n.t('coach.scheduleTraining'),
      }), { disabled: scheduling }),
    );
  }

  function openGroupSchedule(planVersionId) {
    if (!active() || !context.groupId) return;
    scheduleState = { kind: 'group', planVersionId, groupId: context.groupId };
    renderScheduleForm();
    showDialog(scheduleDialog);
  }

  function openPersonalSchedule(planVersionId, studentProfileId = null) {
    if (!active()) return;
    const student = coachStudents().find(({ profileId: id }) => id === studentProfileId)
      ?? coachStudents()[0];
    if (!student) return;
    scheduleState = { kind: 'personal_class', planVersionId, student };
    renderScheduleForm();
    showDialog(scheduleDialog);
  }

  async function load() {
    const token = ++loadToken;
    if (!coachingActive()) {
      clearPrivate();
      return;
    }
    const groupId = context.groupId;
    status.textContent = i18n.t('coach.loadingSchedule');
    try {
      const [loadedPlans, loadedConnections, loadedRoster] = await Promise.all([
        trainingService.listPlans(groupId),
        connectionService.listMine(),
        groupId ? groupService.listRoster(groupId) : Promise.resolve([]),
      ]);
      if (token !== loadToken || groupId !== context.groupId) return;
      plans = loadedPlans.map(normalizePlan);
      connections = loadedConnections;
      roster = loadedRoster;
      const students = coachStudents();
      const year = new Date().getFullYear();
      const calendarRows = await Promise.all(students.map(async (student) => (
        (await trainingService.listCalendar({
          start: `${year}-01-01`, endExclusive: `${year + 1}-01-01`,
          profileId: student.profileId,
        })).map((item) => ({ ...item, student_profile_id: student.profileId }))
      )));
      if (token !== loadToken || groupId !== context.groupId) return;
      const unique = new Map();
      for (const item of calendarRows.flat()) {
        if (item.item_type === 'scheduled' && item.status === 'scheduled'
          && (!context.groupId || !item.group_id || item.group_id === context.groupId)) {
          const prior = unique.get(item.item_id);
          unique.set(item.item_id, prior?.student_profile_id === item.student_profile_id
            ? prior : { ...item, student_profile_ids: [
              ...(prior?.student_profile_ids ?? (prior ? [prior.student_profile_id] : [])),
              item.student_profile_id,
            ] });
        }
      }
      schedules = [...unique.values()];
      status.textContent = '';
      if (active()) render();
      else renderStudents();
    } catch (error) {
      if (token !== loadToken || groupId !== context.groupId) return;
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        await revoke(groupId);
      } else {
        status.textContent = safeMessage(error, i18n.t('coach.scheduleLoadError'));
      }
    }
  }

  function setContext(nextContext) {
    loadToken += 1;
    context = { ...context, ...nextContext };
    if (!coachingActive()) clearPrivate();
    else {
      workspace.replaceChildren();
      studentWorkspace.replaceChildren();
    }
  }

  workspace.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'new-plan') openPlanEditor();
    if (button.dataset.action === 'edit-plan') openPlanEditor(button.dataset.value);
    if (button.dataset.action === 'schedule-group') openGroupSchedule(button.dataset.value);
    if (button.dataset.action === 'schedule-personal') {
      openPersonalSchedule(button.dataset.value, button.dataset.studentId);
    }
    if (button.dataset.action === 'confirm-training') openCompletion(button.dataset.value);
  });

  studentWorkspace.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'view-student-training') void loadStudentTraining(button.dataset.value);
    if (button.dataset.action === 'open-student-day') {
      void openStudentDay(button.dataset.studentId, button.dataset.value);
    }
  });

  studentWorkspace.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-student-feedback]');
    if (!form) return;
    event.preventDefault();
    const message = form.querySelector('[role="status"]');
    message.textContent = '';
    const [kind, id] = form.elements.context.value.split(':');
    try {
      await trainingService.addFeedback({
        participationId: form.dataset.studentFeedback,
        groupId: kind === 'group' ? id : null,
        connectionId: kind === 'connection' ? id : null,
        body: form.elements.body.value,
      });
      const date = form.closest('.training-day-card')?.dataset.localDate;
      message.textContent = i18n.t('coach.feedbackSaved');
      form.elements.body.value = '';
      if (date) await openStudentDay(selectedStudentId, date);
    } catch (error) {
      if (error?.kind === 'authorization' || error?.kind === 'authentication') await revoke(context.groupId);
      else message.textContent = safeMessage(error, i18n.t('coach.feedbackSaveError'));
    }
  });

  planForm.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !editorState) return;
    if (button.dataset.action === 'close-plan') return closeDialog(planDialog);
    if (button.dataset.action === 'add-round') {
      syncEditor();
      editorState = addRound(editorState, {}, { randomUUID: nextId });
      renderPlanForm();
    }
    if (button.dataset.action === 'move-round-up' || button.dataset.action === 'move-round-down') {
      syncEditor();
      const roundId = button.closest('[data-plan-round]').dataset.planRound;
      editorState = moveRound(
        editorState,
        roundId,
        button.dataset.action === 'move-round-up' ? 'up' : 'down',
      );
      renderPlanForm();
    }
    if (button.dataset.action === 'add-plan-movement') {
      syncEditor();
      const roundId = button.closest('[data-plan-round]').dataset.planRound;
      editorState = addMovement(editorState, roundId, {}, { randomUUID: nextId });
      renderPlanForm();
    }
    if (['move-movement-up', 'move-movement-down', 'remove-movement'].includes(button.dataset.action)) {
      syncEditor();
      const roundId = button.closest('[data-plan-round]').dataset.planRound;
      const movementId = button.closest('[data-plan-movement]').dataset.planMovement;
      editorState = button.dataset.action === 'remove-movement'
        ? removeMovement(editorState, roundId, movementId)
        : moveMovement(
          editorState,
          roundId,
          movementId,
          button.dataset.action === 'move-movement-up' ? 'up' : 'down',
        );
      renderPlanForm();
    }
    if (button.dataset.action === 'publish-plan') {
      try {
        await trainingService.publishPlan(editorState.id);
        editorState = { ...editorState, published: true };
        plans = plans.map((plan) => plan.id === editorState.id ? editorState : plan);
        renderPlanForm();
        render();
      } catch (error) {
        planForm.querySelector('.profile-status').textContent = safeMessage(error, i18n.t('coach.publishError'));
      }
    }
  });

  planForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (savingPlan || editorState?.published) return;
    syncEditor();
    savingPlan = true;
    const planStatus = planForm.querySelector('.profile-status');
    planStatus.textContent = '';
    try {
      const serialized = { ...serializePlanDraft(editorState), groupId: context.groupId };
      const result = editorState.id
        ? await trainingService.savePlanDraft({
          ...serialized, planId: editorState.id, expectedUpdatedAt: editorState.expectedUpdatedAt,
        })
        : await trainingService.createPlan(serialized);
      editorState = {
        ...editorState,
        id: result.plan_id ?? editorState.id,
        versionId: result.version_id ?? editorState.versionId,
        expectedUpdatedAt: result.updated_at ?? editorState.expectedUpdatedAt,
      };
      const existing = plans.findIndex(({ id }) => id === editorState.id);
      if (existing >= 0) plans.splice(existing, 1, editorState);
      else plans.push(editorState);
      renderPlanForm();
      render();
    } catch (error) {
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        await revoke(context.groupId);
      } else {
        planStatus.textContent = safeMessage(error, i18n.t('coach.planSaveError'));
      }
    } finally {
      savingPlan = false;
    }
  });

  scheduleForm.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close-schedule"]')) closeDialog(scheduleDialog);
  });

  scheduleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (scheduling || !scheduleState) return;
    scheduling = true;
    const scheduleStatus = scheduleForm.querySelector('.profile-status');
    scheduleStatus.textContent = '';
    const localDate = scheduleForm.elements.scheduleDate.value;
    const time = scheduleForm.elements.scheduleTime.value;
    try {
      const common = {
        planVersionId: scheduleState.planVersionId,
        localDate,
        startsAt: scheduledInstant(localDate, time, timezone),
        timezone,
        visibleInAdvance: scheduleForm.elements.scheduleVisible.checked,
      };
      if (scheduleState.kind === 'group') {
        await trainingService.scheduleGroupTraining({ ...common, groupId: scheduleState.groupId });
      } else {
        await trainingService.schedulePersonalClass({
          ...common,
          studentProfileId: scheduleState.student.profileId,
          groupId: scheduleState.student.groupId,
          connectionId: scheduleState.student.connectionId,
        });
      }
      closeDialog(scheduleDialog);
      scheduleState = null;
      void load();
    } catch (error) {
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        await revoke(context.groupId);
      } else if (error instanceof RangeError) {
        scheduleStatus.textContent = i18n.t(
          error.message.includes('does not exist')
            ? 'coach.nonexistentTime'
            : 'coach.invalidDateTime',
        );
      } else {
        scheduleStatus.textContent = safeMessage(error, i18n.t('coach.scheduleSaveError'));
      }
    } finally {
      scheduling = false;
    }
  });

  completionForm.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close-completion"]')) closeDialog(completionDialog);
  });

  completionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (completing || !completionState) return;
    completing = true;
    const formStatus = completionForm.querySelector('[role="status"]');
    formStatus.textContent = '';
    const durationMinutes = Number(completionForm.elements.completionDuration.value);
    const schedule = completionState.schedule;
    try {
      if (schedule.kind === 'group') {
        const attendees = [...completionForm.querySelectorAll('[name="attendee"]')]
          .map((checkbox) => {
            const override = completionForm.querySelector(`[data-attendee-duration="${checkbox.value}"]`);
            completionState.attendees.set(checkbox.value, {
              selected: checkbox.checked, duration: Number(override.value),
            });
            return checkbox.checked ? {
              profileId: checkbox.value, durationMinutes: Number(override.value),
            } : null;
          }).filter(Boolean);
        await completeGroup({
          scheduleId: schedule.item_id, attendees, durationMinutes,
          idempotencyKey: completionState.idempotencyKey,
        });
      } else {
        await trainingService.completePersonalClass({
          scheduleId: schedule.item_id, durationMinutes,
          idempotencyKey: completionState.idempotencyKey,
        });
      }
      closeDialog(completionDialog);
      completionState = null;
      await load();
    } catch (error) {
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        await revoke(context.groupId);
      } else if (error?.code === 'invalid_attendee' || error?.message === 'invalid_attendee') {
        formStatus.textContent = i18n.t('coach.membershipChanged');
      } else {
        formStatus.textContent = safeMessage(error, i18n.t('coach.confirmError'));
      }
    } finally {
      completing = false;
    }
  });

  return {
    load,
    setContext,
    openPlanEditor,
    openGroupSchedule,
    openPersonalSchedule,
    openCompletion,
    completeGroup,
    loadStudentTraining,
    openStudentDay,
    setLocale() {
      completionDialog.setAttribute('aria-label', i18n.t('coach.confirmDialog'));
      render();
      renderStudents();
      if (planDialog.open && editorState) renderPlanForm();
      if (scheduleDialog.open && scheduleState) renderScheduleForm();
      if (completionDialog.open && completionState) renderCompletionForm();
    },
    clear() {
      loadToken += 1;
      clearPrivate();
    },
  };
}

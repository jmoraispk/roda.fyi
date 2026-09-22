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
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
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
  timezone = 'UTC',
  profileId,
  onAccessRevoked = async () => {},
}) {
  const workspace = document.querySelector('#coachingTrainingWorkspace');
  const status = document.querySelector('#coachingTrainingStatus');
  const planDialog = document.querySelector('#workoutPlanDialog');
  const planForm = document.querySelector('#workoutPlanForm');
  const scheduleDialog = document.querySelector('#scheduleTrainingDialog');
  const scheduleForm = document.querySelector('#scheduleTrainingForm');
  let context = { mode: 'training', activeTab: null, groupId: null, isCoach: false };
  let plans = [];
  let connections = [];
  let roster = [];
  let editorState = null;
  let scheduleState = null;
  let loadToken = 0;
  let savingPlan = false;
  let scheduling = false;
  let localCounter = 0;

  function nextId() {
    localCounter += 1;
    return `editor-${localCounter}`;
  }

  function active() {
    return context.mode === 'coaching' && context.activeTab === 'schedule' && context.isCoach;
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
    editorState = null;
    scheduleState = null;
    workspace.replaceChildren();
    status.textContent = '';
    closeDialog(planDialog);
    closeDialog(scheduleDialog);
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
      element(document, 'div', { className: 'dashboard-eyebrow', text: 'Coach planning' }),
      element(document, 'h2', { text: 'Training schedule' }),
      actionButton('Create workout plan', 'new-plan'),
    );
    workspace.append(header);

    const planList = element(document, 'div', { className: 'workout-plan-list' });
    for (const plan of plans) {
      const card = element(document, 'article', { className: 'workout-plan-card' });
      card.dataset.planId = plan.id;
      card.append(
        element(document, 'h3', { text: plan.title }),
        element(document, 'p', {
          text: `${plan.durationMinutes} minutes · ${plan.published ? 'Published' : 'Draft'}`,
        }),
        actionButton(plan.published ? 'View plan' : 'Edit plan', 'edit-plan', plan.id),
      );
      if (plan.published) {
        if (context.groupId) card.append(actionButton('Schedule group training', 'schedule-group', plan.versionId));
        for (const student of coachStudents()) {
          const button = actionButton(`Schedule personal class · ${student.name}`, 'schedule-personal', plan.versionId);
          button.dataset.studentId = student.profileId;
          card.append(button);
        }
      }
      planList.append(card);
    }
    if (plans.length === 0) {
      planList.append(element(document, 'p', {
        className: 'calendar-empty', text: 'Create a workout plan to start scheduling.',
      }));
    }
    workspace.append(planList);
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
    const readOnly = editorState.published;
    const close = actionButton('×', 'close-plan');
    close.className = 'profile-close';
    close.setAttribute('aria-label', 'Close workout plan');
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
      element(document, 'div', { className: 'profile-kicker', text: readOnly ? 'Published plan' : 'Workout plan' }),
      element(document, 'h1', { text: readOnly ? editorState.title : editorState.id ? 'Edit workout plan' : 'Create workout plan' }),
      field(document, 'Plan title', title),
      field(document, 'Description', description),
      field(document, 'Expected duration in minutes', duration),
      field(document, 'Instructions', instructions),
    );
    const rounds = element(document, 'div', { className: 'plan-rounds' });
    editorState.rounds.forEach((round, index) => {
      const box = element(document, 'fieldset', { className: 'plan-round' });
      box.dataset.planRound = round.id;
      box.append(element(document, 'legend', { text: `Round ${index + 1}` }));
      const label = element(document, 'input', { name: 'roundLabel', value: round.label, disabled: readOnly });
      const repetitions = element(document, 'input', { type: 'number', name: 'roundRepetitions', value: round.repetitions ?? '', disabled: readOnly });
      const roundDuration = element(document, 'input', { type: 'number', name: 'roundDuration', value: round.durationSeconds ?? '', disabled: readOnly });
      const rest = element(document, 'input', { type: 'number', name: 'roundRest', value: round.restSeconds ?? '', disabled: readOnly });
      const roundInstructions = element(document, 'input', { name: 'roundInstructions', value: round.instructions, disabled: readOnly });
      for (const input of [label, repetitions, roundDuration, rest, roundInstructions]) input.className = 'field-input';
      box.append(
        field(document, 'Round label', label),
        field(document, 'Round repetitions', repetitions),
        field(document, 'Round duration in seconds', roundDuration),
        field(document, 'Rest in seconds', rest),
        field(document, 'Round instructions', roundInstructions),
      );
      if (!readOnly) {
        box.append(
          actionButton('Move round up', 'move-round-up'),
          actionButton('Move round down', 'move-round-down'),
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
        for (const [value, text] of [['', 'Any side'], ['left', 'Left'], ['right', 'Right'], ['both', 'Both']]) {
          const option = element(document, 'option', { value, text });
          option.selected = movement.side === value;
          side.append(option);
        }
        const movementRepetitions = element(document, 'input', { type: 'number', name: 'movementRepetitions', value: movement.repetitions ?? '', disabled: readOnly });
        const movementDuration = element(document, 'input', { type: 'number', name: 'movementDuration', value: movement.durationSeconds ?? '', disabled: readOnly });
        const movementInstructions = element(document, 'input', { name: 'movementInstructions', value: movement.instructions, disabled: readOnly });
        for (const input of [side, movementRepetitions, movementDuration, movementInstructions]) input.className = 'field-input';
        row.append(
          field(document, 'Movement', name),
          field(document, 'Side', side),
          field(document, 'Movement repetitions', movementRepetitions),
          field(document, 'Movement duration in seconds', movementDuration),
          field(document, 'Movement instructions', movementInstructions),
        );
        if (!readOnly) {
          row.append(
            actionButton('Move movement up', 'move-movement-up'),
            actionButton('Move movement down', 'move-movement-down'),
            actionButton('Remove movement', 'remove-movement'),
          );
        }
        movementList.append(row);
      });
      box.append(movementList);
      if (!readOnly) box.append(actionButton('Add movement', 'add-plan-movement'));
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
        actionButton('Add round', 'add-round'),
        Object.assign(element(document, 'button', {
          type: 'submit', className: 'primary-button', text: 'Save draft', action: 'save-plan',
        }), { disabled: savingPlan }),
      );
      if (editorState.id) actions.append(actionButton('Publish plan', 'publish-plan'));
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
    const close = actionButton('×', 'close-schedule');
    close.className = 'profile-close';
    close.setAttribute('aria-label', 'Close training schedule');
    const date = element(document, 'input', { type: 'date', name: 'scheduleDate', required: true });
    const time = element(document, 'input', { type: 'time', name: 'scheduleTime', required: true });
    const visible = element(document, 'input', { type: 'checkbox', name: 'scheduleVisible' });
    visible.checked = true;
    scheduleForm.append(
      close,
      element(document, 'div', { className: 'profile-kicker', text: 'Coach scheduling' }),
      element(document, 'h1', { text: scheduleState.kind === 'group' ? 'Schedule group training' : 'Schedule personal class' }),
      field(document, 'Training date', date),
      field(document, 'Start time', time),
      field(document, 'Show plan details before training', visible),
      element(document, 'p', { className: 'profile-status' }),
      Object.assign(element(document, 'button', {
        type: 'submit', className: 'primary-button', text: 'Schedule training',
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
    if (!active()) {
      clearPrivate();
      return;
    }
    const groupId = context.groupId;
    status.textContent = 'Loading coach schedule…';
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
      status.textContent = '';
      render();
    } catch (error) {
      if (token !== loadToken || groupId !== context.groupId) return;
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        await revoke(groupId);
      } else {
        status.textContent = safeMessage(error, 'We could not load coach scheduling.');
      }
    }
  }

  function setContext(nextContext) {
    loadToken += 1;
    context = { ...context, ...nextContext };
    if (!active()) clearPrivate();
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
        planForm.querySelector('.profile-status').textContent = safeMessage(error, 'We could not publish this plan.');
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
        planStatus.textContent = safeMessage(error, 'We could not save this plan. Your entries are still here.');
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
    const common = {
      planVersionId: scheduleState.planVersionId,
      localDate,
      startsAt: scheduledInstant(localDate, time, timezone),
      timezone,
      visibleInAdvance: scheduleForm.elements.scheduleVisible.checked,
    };
    try {
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
    } catch (error) {
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        await revoke(context.groupId);
      } else {
        scheduleStatus.textContent = safeMessage(error, 'We could not schedule this training. Your entries are still here.');
      }
    } finally {
      scheduling = false;
    }
  });

  return {
    load,
    setContext,
    openPlanEditor,
    openGroupSchedule,
    openPersonalSchedule,
    clear() {
      loadToken += 1;
      clearPrivate();
    },
  };
}

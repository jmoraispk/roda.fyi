import {
  calendarGrid,
  createCalendarState,
  monthBounds,
  reduceCalendarState,
  shiftMonth,
} from '../training-calendar-state.js';

const MOVEMENTS = Object.freeze([
  ['ginga', 'Ginga'],
  ['armada', 'Armada'],
  ['meia-lua-de-compasso', 'Meia Lua de Compasso'],
  ['au', 'Aú'],
]);

function kindKey(kind) {
  if (kind === 'personal_class') return 'training.personalClass';
  if (kind === 'group') return 'training.group';
  return 'training.alone';
}

function showDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

export function createTrainingCalendarView({
  document,
  service,
  i18n,
  profile,
  timezone,
  targetProfileId = null,
  canCoach = false,
  onAccessRevoked = async () => {},
}) {
  const calendar = document.querySelector('#trainingCalendar');
  const monthLabel = document.querySelector('#calendarMonthLabel');
  const previousMonth = document.querySelector('#calendarPreviousMonth');
  const nextMonth = document.querySelector('#calendarNextMonth');
  const status = document.querySelector('#calendarStatus');
  const detail = document.querySelector('#trainingDayDetail');
  const recordAlone = document.querySelector('#recordAloneTraining');
  const dialog = document.querySelector('#aloneTrainingDialog');
  const form = document.querySelector('#aloneTrainingForm');
  const dateInput = document.querySelector('#aloneDate');
  const durationInput = document.querySelector('#aloneDuration');
  const notesInput = document.querySelector('#aloneNotes');
  const rounds = document.querySelector('#aloneRounds');
  const addRound = document.querySelector('#addAloneRound');
  const formStatus = document.querySelector('#aloneTrainingStatus');
  const saveButton = document.querySelector('#saveAloneTraining');
  let state = createCalendarState();
  let requestToken = 0;
  let idempotencyKey = null;
  let submitting = false;
  let viewedProfileId = targetProfileId;

  function localizedDate(localDate, options = {}) {
    return i18n.formatDate(`${localDate}T12:00:00`, options);
  }

  function applyCopy() {
    recordAlone.textContent = i18n.t('calendar.recordAlone');
    previousMonth.setAttribute('aria-label', i18n.t('calendar.previousMonth'));
    nextMonth.setAttribute('aria-label', i18n.t('calendar.nextMonth'));
    document.querySelector('#aloneTrainingTitle').textContent = i18n.t('alone.title');
    document.querySelector('#aloneDateLabel').textContent = i18n.t('alone.date');
    document.querySelector('#aloneDurationLabel').textContent = i18n.t('alone.duration');
    document.querySelector('#aloneNotesLabel').textContent = i18n.t('alone.notes');
    addRound.textContent = i18n.t('alone.addRound');
    saveButton.textContent = i18n.t('alone.save');
    document.querySelector('[data-close-alone]')
      .setAttribute('aria-label', i18n.t('alone.close'));
  }

  function renderCalendar() {
    applyCopy();
    monthLabel.textContent = localizedDate(`${state.visibleMonth}-15`, {
      month: 'long', year: 'numeric',
    });
    calendar.replaceChildren();
    calendar.setAttribute('role', 'grid');
    calendar.setAttribute('aria-label', i18n.t('calendar.title'));

    const weekdayFormatter = new Intl.DateTimeFormat(
      i18n.locale() === 'pt' ? 'pt-PT' : 'en-US',
      { weekday: 'short', timeZone: 'UTC' },
    );
    for (let index = 0; index < 7; index += 1) {
      const heading = document.createElement('span');
      heading.className = 'calendar-weekday';
      heading.setAttribute('role', 'columnheader');
      heading.textContent = weekdayFormatter.format(new Date(Date.UTC(2026, 5, 1 + index)));
      calendar.append(heading);
    }

    for (const day of calendarGrid(state.visibleMonth)) {
      const items = state.summaryByDate.get(day.date) ?? [];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `calendar-day${day.inMonth ? '' : ' calendar-day-outside'}`;
      button.dataset.date = day.date;
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-selected', String(day.date === state.selectedDate));
      const names = items.map((item) => i18n.t(kindKey(item.kind))).join(', ');
      button.setAttribute('aria-label', [
        localizedDate(day.date, { dateStyle: 'long' }), names,
      ].filter(Boolean).join(' · '));
      const number = document.createElement('span');
      number.className = 'calendar-day-number';
      number.textContent = String(day.day);
      button.append(number);
      const markers = document.createElement('span');
      markers.className = 'calendar-markers';
      for (const item of items) {
        const marker = document.createElement('span');
        marker.className = `calendar-marker calendar-marker-${item.kind}`;
        marker.dataset.kind = item.kind;
        marker.dataset.status = item.status;
        marker.title = `${i18n.t(kindKey(item.kind))} · ${item.status === 'completed'
          ? i18n.t('calendar.completed') : i18n.t('calendar.upcoming')}`;
        markers.append(marker);
      }
      button.append(markers);
      calendar.append(button);
    }
  }

  function renderDetail(items) {
    detail.replaceChildren();
    if (!items?.length) {
      const empty = document.createElement('p');
      empty.className = 'calendar-empty';
      empty.textContent = i18n.t('calendar.emptyDay');
      detail.append(empty);
      return;
    }
    for (const item of items) {
      const article = document.createElement('article');
      article.className = 'training-day-card';
      const heading = document.createElement('h3');
      heading.textContent = i18n.t(kindKey(item.kind));
      const duration = document.createElement('p');
      duration.textContent = i18n.formatDuration(item.duration_minutes ?? 0);
      article.append(heading, duration);
      const ownRecord = !viewedProfileId || viewedProfileId === profile.id;
      if (ownRecord && item.participation_id) {
        const notesForm = document.createElement('form');
        notesForm.dataset.notesForm = item.participation_id;
        const notesLabel = document.createElement('label');
        notesLabel.textContent = i18n.t('training.personalNotes');
        const notes = document.createElement('textarea');
        notes.className = 'field-input field-textarea';
        notes.name = 'notes';
        notes.value = item.personal_notes ?? '';
        notesLabel.append(notes);
        const saveNotes = document.createElement('button');
        saveNotes.type = 'submit';
        saveNotes.className = 'secondary-button';
        saveNotes.textContent = i18n.t('training.saveNotes');
        const notesStatus = document.createElement('p');
        notesStatus.setAttribute('role', 'status');
        notesForm.append(notesLabel, saveNotes, notesStatus);
        article.append(notesForm);
        if (item.personal_notes) {
          const savedNotes = document.createElement('p');
          savedNotes.dataset.personalNotes = '';
          savedNotes.textContent = item.personal_notes;
          article.append(savedNotes);
        }
      } else if (item.personal_notes) {
        const notes = document.createElement('p');
        notes.textContent = item.personal_notes;
        article.append(notes);
      }

      for (const [roundIndex, round] of (item.rounds ?? []).entries()) {
        const roundBox = document.createElement('section');
        roundBox.className = 'training-round-detail';
        const roundTitle = document.createElement('h4');
        roundTitle.textContent = round.label || i18n.t('alone.round', { number: roundIndex + 1 });
        roundBox.append(roundTitle);
        for (const movement of round.movements ?? []) {
          const movementBox = document.createElement('div');
          movementBox.className = 'training-movement-detail';
          const name = document.createElement('strong');
          name.textContent = movement.movement_name ?? movement.movementName;
          movementBox.append(name);
          if (ownRecord && item.participation_id) {
            const assessment = document.createElement('form');
            assessment.dataset.assessmentForm = movement.id;
            assessment.dataset.participationId = item.participation_id;
            const choices = document.createElement('fieldset');
            const legend = document.createElement('legend');
            legend.textContent = i18n.t('training.difficulty');
            choices.append(legend);
            for (const difficulty of ['easy', 'okay', 'hard']) {
              const label = document.createElement('label');
              const radio = document.createElement('input');
              radio.type = 'radio';
              radio.name = 'difficulty';
              radio.value = difficulty;
              radio.required = true;
              radio.checked = movement.assessment?.difficulty === difficulty;
              label.append(radio, i18n.t(`training.${difficulty}`));
              choices.append(label);
            }
            const note = document.createElement('textarea');
            note.className = 'field-input field-textarea';
            note.name = 'note';
            note.value = movement.assessment?.note ?? '';
            note.setAttribute('aria-label', i18n.t('training.movementNote'));
            const save = document.createElement('button');
            save.type = 'submit';
            save.className = 'secondary-button';
            save.textContent = i18n.t('training.saveAssessment');
            const assessmentStatus = document.createElement('p');
            assessmentStatus.setAttribute('role', 'status');
            assessment.append(choices, note, save, assessmentStatus);
            movementBox.append(assessment);
          } else if (movement.assessment) {
            const result = document.createElement('p');
            result.textContent = `${i18n.t(`training.${movement.assessment.difficulty}`)}${
              movement.assessment.note ? ` · ${movement.assessment.note}` : ''}`;
            movementBox.append(result);
          }
          roundBox.append(movementBox);
        }
        article.append(roundBox);
      }

      if ((item.feedback ?? []).length) {
        const feedbackList = document.createElement('section');
        feedbackList.className = 'training-feedback-list';
        const feedbackTitle = document.createElement('h4');
        feedbackTitle.textContent = i18n.t('training.coachFeedback');
        feedbackList.append(feedbackTitle);
        for (const feedback of item.feedback) {
          const entry = document.createElement('article');
          const context = (item.feedback_contexts ?? []).find(({ id }) => (
            id === (feedback.group_id ?? feedback.connection_id)
          ));
          const meta = document.createElement('p');
          meta.textContent = [
            feedback.coach_name,
            context?.label ?? (feedback.group_id
              ? i18n.t('training.groupContext') : i18n.t('training.directContext')),
            feedback.created_at ? i18n.formatDate(feedback.created_at, { dateStyle: 'medium', timeStyle: 'short' }) : null,
          ].filter(Boolean).join(' · ');
          const body = document.createElement('p');
          body.textContent = feedback.body;
          entry.append(meta, body);
          feedbackList.append(entry);
        }
        article.append(feedbackList);
      }

      if (canCoach && item.participation_id && (item.feedback_contexts ?? []).length) {
        const feedbackForm = document.createElement('form');
        feedbackForm.dataset.feedbackForm = item.participation_id;
        const context = document.createElement('select');
        context.name = 'context';
        context.className = 'field-input';
        context.setAttribute('aria-label', i18n.t('training.feedbackContext'));
        for (const optionContext of item.feedback_contexts) {
          const option = document.createElement('option');
          option.value = `${optionContext.kind}:${optionContext.id}`;
          option.textContent = optionContext.label;
          context.append(option);
        }
        const body = document.createElement('textarea');
        body.name = 'body';
        body.required = true;
        body.className = 'field-input field-textarea';
        body.setAttribute('aria-label', i18n.t('training.feedbackBody'));
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'secondary-button';
        submit.textContent = i18n.t('training.addFeedback');
        const feedbackStatus = document.createElement('p');
        feedbackStatus.setAttribute('role', 'status');
        feedbackForm.append(context, body, submit, feedbackStatus);
        article.append(feedbackForm);
      }
      detail.append(article);
    }
  }

  async function loadMonth(month = state.visibleMonth) {
    const token = ++requestToken;
    state = reduceCalendarState(state, {
      type: 'MONTH_LOAD_STARTED', visibleMonth: month, token,
    });
    status.textContent = i18n.t('calendar.loading');
    renderCalendar();
    const bounds = monthBounds(month);
    try {
      const items = await service.listCalendar({
        start: bounds.start,
        endExclusive: bounds.endExclusive,
        profileId: viewedProfileId,
      });
      state = reduceCalendarState(state, { type: 'MONTH_LOAD_SUCCEEDED', token, items });
      if (token === requestToken) status.textContent = '';
      renderCalendar();
      return items;
    } catch (error) {
      state = reduceCalendarState(state, { type: 'MONTH_LOAD_FAILED', token, error });
      if (token === requestToken) status.textContent = error?.message || i18n.t('calendar.loadError');
      renderCalendar();
      return [];
    }
  }

  async function selectDay(date) {
    state = reduceCalendarState(state, { type: 'DAY_SELECTED', date });
    renderCalendar();
    detail.textContent = i18n.t('calendar.loading');
    try {
      const items = await service.getDay({ localDate: date, profileId: viewedProfileId });
      state = reduceCalendarState(state, {
        type: 'DAY_LOAD_SUCCEEDED', date, items,
      });
      if (state.selectedDate === date) renderDetail(items);
      return items;
    } catch (error) {
      state = reduceCalendarState(state, { type: 'DAY_LOAD_FAILED', date, error });
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        detail.replaceChildren();
        await onAccessRevoked(viewedProfileId);
      } else if (state.selectedDate === date) {
        detail.textContent = error?.message || i18n.t('calendar.loadError');
      }
      return [];
    }
  }

  function addMovementRow(container) {
    const row = document.createElement('div');
    row.className = 'alone-movement-row';
    const select = document.createElement('select');
    select.className = 'field-input';
    select.dataset.movementKey = '';
    select.setAttribute('aria-label', i18n.t('alone.movement'));
    for (const [value, label] of MOVEMENTS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    const repetitions = document.createElement('input');
    repetitions.type = 'number';
    repetitions.min = '1';
    repetitions.dataset.movementRepetitions = '';
    repetitions.setAttribute('aria-label', i18n.t('alone.repetitions'));
    row.append(select, repetitions);
    container.append(row);
  }

  function addRoundEditor() {
    const index = rounds.querySelectorAll('.alone-round').length + 1;
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'alone-round';
    const legend = document.createElement('legend');
    legend.textContent = i18n.t('alone.round', { number: index });
    const label = document.createElement('input');
    label.className = 'field-input';
    label.dataset.roundLabel = '';
    label.setAttribute('aria-label', i18n.t('alone.roundLabel'));
    const movementList = document.createElement('div');
    movementList.className = 'alone-movement-list';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.dataset.action = 'add-movement';
    button.textContent = i18n.t('alone.addMovement');
    fieldset.append(legend, label, movementList, button);
    rounds.append(fieldset);
  }

  function serializeRounds() {
    return [...rounds.querySelectorAll('.alone-round')].map((round) => ({
      label: round.querySelector('[data-round-label]').value.trim() || null,
      repetitions: null,
      duration_seconds: null,
      rest_seconds: null,
      instructions: null,
      movements: [...round.querySelectorAll('.alone-movement-row')].map((movement) => {
        const select = movement.querySelector('[data-movement-key]');
        const repetitions = movement.querySelector('[data-movement-repetitions]').value;
        return {
          movement_key: select.value,
          movement_name: select.selectedOptions[0].textContent,
          side: null,
          repetitions: repetitions ? Number(repetitions) : null,
          duration_seconds: null,
          instructions: null,
        };
      }),
    }));
  }

  function openAlone(date = state.selectedDate) {
    applyCopy();
    dateInput.value = date ?? `${state.visibleMonth}-01`;
    durationInput.value = '45';
    notesInput.value = '';
    rounds.replaceChildren();
    formStatus.textContent = '';
    idempotencyKey = service.createIdempotencyKey();
    showDialog(dialog);
  }

  async function submitAlone() {
    if (submitting) return;
    submitting = true;
    saveButton.disabled = true;
    saveButton.textContent = i18n.t('alone.saving');
    formStatus.textContent = '';
    const submittedDate = dateInput.value;
    try {
      await service.recordAloneTraining({
        localDate: submittedDate,
        timezone,
        durationMinutes: Number(durationInput.value),
        notes: notesInput.value,
        rounds: serializeRounds(),
        idempotencyKey,
      });
      closeDialog(dialog);
      form.reset();
      rounds.replaceChildren();
      idempotencyKey = null;
      await loadMonth(submittedDate.slice(0, 7));
      await selectDay(submittedDate);
    } catch (error) {
      formStatus.textContent = error?.message || i18n.t('alone.saveError');
    } finally {
      submitting = false;
      saveButton.disabled = false;
      saveButton.textContent = i18n.t('alone.save');
    }
  }

  calendar.addEventListener('click', (event) => {
    const day = event.target.closest('[data-date]');
    if (day) selectDay(day.dataset.date);
  });
  calendar.addEventListener('keydown', (event) => {
    const day = event.target.closest('[data-date]');
    if (!day) return;
    const buttons = [...calendar.querySelectorAll('[data-date]')];
    const index = buttons.indexOf(day);
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!offset) return;
    event.preventDefault();
    buttons[index + offset]?.focus();
  });
  previousMonth.addEventListener('click', () => loadMonth(shiftMonth(state.visibleMonth, -1)));
  nextMonth.addEventListener('click', () => loadMonth(shiftMonth(state.visibleMonth, 1)));
  recordAlone.addEventListener('click', () => openAlone());
  addRound.addEventListener('click', addRoundEditor);
  rounds.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="add-movement"]');
    if (button) addMovementRow(button.parentElement.querySelector('.alone-movement-list'));
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAlone();
  });
  document.querySelector('[data-close-alone]').addEventListener('click', () => closeDialog(dialog));

  detail.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submittedDate = state.selectedDate;
    const notesForm = event.target.closest('[data-notes-form]');
    const assessmentForm = event.target.closest('[data-assessment-form]');
    const feedbackForm = event.target.closest('[data-feedback-form]');
    const activeForm = notesForm ?? assessmentForm ?? feedbackForm;
    if (!activeForm) return;
    const formMessage = activeForm.querySelector('[role="status"]');
    formMessage.textContent = '';
    try {
      if (notesForm) {
        await service.saveNotes({
          participationId: notesForm.dataset.notesForm,
          notes: notesForm.elements.notes.value,
        });
      } else if (assessmentForm) {
        await service.saveAssessment({
          participationId: assessmentForm.dataset.participationId,
          movementId: assessmentForm.dataset.assessmentForm,
          difficulty: new FormData(assessmentForm).get('difficulty'),
          note: assessmentForm.elements.note.value,
        });
      } else {
        const [kind, id] = feedbackForm.elements.context.value.split(':');
        await service.addFeedback({
          participationId: feedbackForm.dataset.feedbackForm,
          groupId: kind === 'group' ? id : null,
          connectionId: kind === 'connection' ? id : null,
          body: feedbackForm.elements.body.value,
        });
      }
      if (state.selectedDate === submittedDate) await selectDay(submittedDate);
    } catch (error) {
      if (error?.kind === 'authorization' || error?.kind === 'authentication') {
        detail.replaceChildren();
        await onAccessRevoked(viewedProfileId);
      } else {
        formMessage.textContent = error?.message || i18n.t('training.saveError');
      }
    }
  });

  return {
    loadMonth,
    selectDay,
    openAlone,
    refresh() {
      return loadMonth(state.visibleMonth);
    },
    setLocale() {
      renderCalendar();
      if (state.dayDetail) renderDetail(state.dayDetail);
    },
    async setProfile(profileId, coachMode = false) {
      requestToken += 1;
      viewedProfileId = profileId;
      canCoach = coachMode;
      state = reduceCalendarState(state, { type: 'CLEAR_PRIVATE' });
      detail.replaceChildren();
      return loadMonth(state.visibleMonth);
    },
    clear() {
      requestToken += 1;
      state = reduceCalendarState(state, { type: 'CLEAR_PRIVATE' });
      calendar.replaceChildren();
      detail.replaceChildren();
      status.textContent = '';
      formStatus.textContent = '';
      closeDialog(dialog);
    },
  };
}

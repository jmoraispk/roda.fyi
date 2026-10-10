import {
  calendarGrid,
  createCalendarState,
  monthBounds,
  reduceCalendarState,
  shiftMonth,
} from '../training-calendar-state.js';
import { createRoundDetail } from './round-detail.js';
import { createRoundEditor } from './round-editor.js';

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
  getTermMappings = () => [],
  repertoire = null,
}) {
  const calendar = document.querySelector('#trainingCalendar');
  const monthLabel = document.querySelector('#calendarMonthLabel');
  const previousMonth = document.querySelector('#calendarPreviousMonth');
  const nextMonth = document.querySelector('#calendarNextMonth');
  const status = document.querySelector('#calendarStatus');
  const monthSummary = document.querySelector('#calendarMonthSummary');
  const legend = document.querySelector('#calendarLegend');
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
  const roundEditor = createRoundEditor({
    document, i18n, mode: 'record', getTermMappings, repertoire, showAddButton: false,
  });
  rounds.replaceChildren(roundEditor.element);
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
    roundEditor.refreshCopy();
  }

  function renderSidebar() {
    const items = [...state.summaryByDate.values()].flat();
    const completed = items.filter((item) => item.status === 'completed');
    const minutes = completed.reduce((sum, item) => sum + (item.duration_minutes ?? 0), 0);
    monthSummary.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = i18n.t('calendar.monthSummary');
    const count = document.createElement('strong');
    count.textContent = i18n.t('calendar.trainingCount', { count: completed.length });
    const duration = document.createElement('span');
    duration.textContent = i18n.t('calendar.trainingTime', {
      duration: i18n.formatDuration(minutes),
    });
    monthSummary.append(heading, count, duration);

    legend.replaceChildren();
    const legendTitle = document.createElement('h3');
    legendTitle.textContent = i18n.t('calendar.legend');
    const list = document.createElement('div');
    list.className = 'calendar-legend-list';
    for (const kind of ['alone', 'group', 'personal_class']) {
      const item = document.createElement('span');
      const marker = document.createElement('span');
      marker.className = `calendar-marker calendar-marker-${kind}`;
      item.append(marker, i18n.t(kindKey(kind)));
      list.append(item);
    }
    legend.append(legendTitle, list);
  }

  function renderCalendar() {
    applyCopy();
    renderSidebar();
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

  function renderSelectDayPrompt() {
    detail.replaceChildren();
    const prompt = document.createElement('p');
    prompt.className = 'calendar-empty';
    prompt.textContent = i18n.t('calendar.selectDay');
    detail.append(prompt);
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
        article.append(createRoundDetail({
          document, i18n, round, index: roundIndex, getTermMappings,
          editable: ownRecord && Boolean(item.participation_id),
          onSave: (ratings) => service.saveRoundAssessments({
            participationId: item.participation_id, roundId: round.id, ratings,
          }),
        }));
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

  function openAlone(date = state.selectedDate, { rounds: prefill = null } = {}) {
    applyCopy();
    dateInput.value = date ?? `${state.visibleMonth}-01`;
    durationInput.value = '45';
    notesInput.value = '';
    roundEditor.setRounds(prefill?.length ? prefill : [{ sourceText: '' }]);
    formStatus.textContent = '';
    idempotencyKey = service.createIdempotencyKey();
    showDialog(dialog);
  }

  async function submitAlone() {
    if (submitting) return;
    const payloadRounds = roundEditor.getRounds();
    if (!payloadRounds.length) {
      formStatus.textContent = i18n.t('alone.needRound');
      return;
    }
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
        rounds: payloadRounds,
        idempotencyKey,
      });
      closeDialog(dialog);
      form.reset();
      roundEditor.setRounds([{ sourceText: '' }]);
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
  addRound.addEventListener('click', () => roundEditor.addRound());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAlone();
  });
  document.querySelector('[data-close-alone]').addEventListener('click', () => closeDialog(dialog));

  detail.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submittedDate = state.selectedDate;
    const notesForm = event.target.closest('[data-notes-form]');
    const feedbackForm = event.target.closest('[data-feedback-form]');
    const activeForm = notesForm ?? feedbackForm;
    if (!activeForm) return;
    const formMessage = activeForm.querySelector('[role="status"]');
    formMessage.textContent = '';
    try {
      if (notesForm) {
        await service.saveNotes({
          participationId: notesForm.dataset.notesForm,
          notes: notesForm.elements.notes.value,
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

  renderSelectDayPrompt();

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
      else renderSelectDayPrompt();
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

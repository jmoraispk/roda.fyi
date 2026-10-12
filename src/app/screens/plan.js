// src/app/screens/plan.js
import { createPlanDraft, roundText, serializePlanDraft } from '../training-plan-state.js';
import { el, pageHeader } from '../shell/page.js';
import { createRoundEditor } from '../ui/round-editor.js';
import { openScheduleSheet } from './schedule-sheet.js';

function draftFrom(plan) {
  return createPlanDraft({
    id: plan.plan_id, versionId: plan.version_id, expectedUpdatedAt: plan.updated_at, title: plan.title,
    description: plan.description, groupId: plan.source_group_id, durationMinutes: plan.expected_duration_minutes,
    instructions: plan.instructions, published: plan.state === 'published', rounds: plan.rounds ?? [],
  });
}

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

function readOnly(ctx, screen, header, draft) {
  const { document, i18n } = ctx;
  screen.append(...[
    header(draft.title),
    el(document, 'p', { className: 'muted', text: `${i18n.formatDuration(draft.durationMinutes)} · ${i18n.t('coach.published')}` }),
    draft.description ? el(document, 'p', { text: draft.description }) : null,
    draft.instructions ? el(document, 'p', { className: 'training-notes', text: draft.instructions }) : null,
    el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.rounds') }),
    el(document, 'ol', { className: 'chapters' }, draft.rounds.map((round, index) => el(document, 'li', { className: 'chapter' }, [
      el(document, 'span', { className: 'chapter-number', text: String(index + 1) }),
      el(document, 'span', { className: 'chapter-text', text: roundText(round) }),
    ]))),
    el(document, 'button', {
      className: 'button-primary', text: `📅 ${i18n.t('plan.schedule')}`, attrs: { type: 'button' }, dataset: { action: 'schedule-plan' },
      on: { click: () => openScheduleSheet(ctx, { planVersionId: draft.versionId }) },
    }),
  ].filter(Boolean));
  return screen;
}

function editable(ctx, screen, header, initial, route) {
  const { document, i18n } = ctx;
  const training = ctx.services.training;
  let draft = initial;
  const title = el(document, 'input', { className: 'field-input', attrs: { name: 'title', maxlength: '120' } });
  title.value = draft.title;
  const description = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'description' } });
  description.value = draft.description;
  const duration = el(document, 'input', { className: 'field-input', attrs: { type: 'number', name: 'duration', min: '1', max: '1440', inputmode: 'numeric' } });
  duration.value = String(draft.durationMinutes);
  const instructions = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'instructions' } });
  instructions.value = draft.instructions;
  const editor = createRoundEditor({ document, i18n, mode: 'plan', getTermMappings: ctx.getTermMappings, repertoire: ctx.services.repertoire ?? null });
  editor.setRounds(draft.rounds.length ? draft.rounds : [{ sourceText: '' }]);
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const save = el(document, 'button', { className: 'button-primary', text: i18n.t('coach.saveDraft'), attrs: { type: 'button' }, dataset: { action: 'save-plan' } });
  const publish = el(document, 'button', { className: 'button-secondary', text: i18n.t('coach.publishPlan'), attrs: { type: 'button' }, dataset: { action: 'publish-plan' } });
  publish.hidden = !draft.id;
  let busy = false;

  async function persist() {
    const rounds = editor.getRounds();
    if (!rounds.length) {
      status.textContent = i18n.t('plan.needRound');
      return false;
    }
    const values = { ...draft, title: title.value, description: description.value, durationMinutes: duration.value, instructions: instructions.value };
    const serialized = { ...serializePlanDraft(values, rounds), groupId: draft.groupId };
    const result = draft.id
      ? await training.savePlanDraft({ ...serialized, planId: draft.id, expectedUpdatedAt: draft.expectedUpdatedAt })
      : await training.createPlan(serialized);
    draft = {
      ...values,
      rounds: rounds.map((round) => ({ sourceText: round.source_text, ratings: round.ratings })),
      id: result.plan_id ?? draft.id,
      versionId: result.version_id ?? draft.versionId,
      expectedUpdatedAt: result.updated_at ?? draft.expectedUpdatedAt,
    };
    return true;
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    save.disabled = true;
    publish.disabled = true;
    status.textContent = '';
    try {
      await action();
    } catch (error) {
      status.textContent = error?.message || i18n.t('coach.planSaveError');
    } finally {
      busy = false;
      save.disabled = false;
      publish.disabled = false;
    }
  }

  save.addEventListener('click', () => run(async () => {
    const wasNew = !draft.id;
    if (!(await persist())) return;
    status.textContent = i18n.t('plan.saved');
    publish.hidden = false;
    if (wasNew) ctx.replace(`/me/teaching/plans/${draft.id}`);
  }));
  publish.addEventListener('click', () => run(async () => {
    if (!(await persist())) return;
    await training.publishPlan(draft.id);
    screen.replaceWith(await renderPlan(ctx, { ...route, params: { id: draft.id } }));
  }));

  screen.append(
    header(i18n.t(draft.id ? 'coach.editPlan' : 'teaching.newPlan')),
    field(document, i18n.t('coach.planTitle'), title),
    field(document, i18n.t('coach.description'), description),
    field(document, i18n.t('coach.expectedDuration'), duration),
    field(document, i18n.t('coach.instructions'), instructions),
    el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.rounds') }),
    editor.element, status,
    el(document, 'div', { className: 'chip-row' }, [save, publish]),
  );
  return screen;
}

export async function renderPlan(ctx, route) {
  const { document, i18n } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-plan' });
  const header = (title) => pageHeader({ document, title, backLabel: i18n.t('app.back'), onBack: () => ctx.back('/me/teaching') });
  if (route.params.id === 'new') return editable(ctx, screen, header, createPlanDraft({ durationMinutes: 60 }), route);
  let plan;
  try {
    plan = (await ctx.services.training.listPlans(null)).find(({ plan_id: id }) => id === route.params.id);
  } catch (error) {
    screen.append(header(''), el(document, 'p', { className: 'muted', text: error?.message || i18n.t('app.loadError') }));
    return screen;
  }
  if (!plan) {
    screen.append(header(''), el(document, 'p', { className: 'muted', text: i18n.t('plan.unavailable') }));
    return screen;
  }
  const draft = draftFrom(plan);
  return draft.published ? readOnly(ctx, screen, header, draft) : editable(ctx, screen, header, draft, route);
}

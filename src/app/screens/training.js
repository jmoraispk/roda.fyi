// src/app/screens/training.js
import { renderMarkdown } from '../markdown-lite.js';
import { el, pageHeader } from '../shell/page.js';
import { createResourceSection, RESOURCE_ICONS } from '../ui/resource-view.js';
import { createRoundDetail } from '../ui/round-detail.js';
import { kindLabel } from './today-state.js';
import { youtubeEmbedUrl } from './youtube.js';

function roundText(round) {
  return round.source_text || (round.movements ?? []).map((movement) => (
    movement.repetitions ? `${movement.repetitions}x ${movement.movement_name}` : movement.movement_name
  )).join(', ');
}

function titleFor(i18n, training) {
  const second = training.group_name
    ?? (training.student_name ? i18n.t('trainingPage.with', { name: training.student_name }) : null);
  return [kindLabel(i18n, training.kind), second].filter(Boolean).join(' · ');
}

export async function renderTraining(ctx, route) {
  const { document, i18n } = ctx;
  const screen = el(document, 'section', { className: 'screen screen-training' });
  const back = () => ctx.back('/');
  let training;
  try {
    training = await ctx.services.training.getTraining(route.params.id);
  } catch (error) {
    const unavailable = error?.kind === 'authorization' || error?.kind === 'validation';
    screen.append(pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back }),
      el(document, 'p', { className: 'muted', text: unavailable ? i18n.t('trainingPage.unavailable') : (error?.message || i18n.t('app.loadError')) }));
    return screen;
  }
  const reload = async () => screen.replaceWith(await renderTraining(ctx, route));
  screen.append(pageHeader({ document, title: '', backLabel: i18n.t('app.back'), onBack: back }));

  const video = training.resources.find(({ kind, url }) => kind === 'video' && youtubeEmbedUrl(url));
  if (video) {
    screen.append(el(document, 'figure', { className: 'training-video' }, [
      el(document, 'iframe', { attrs: {
        src: youtubeEmbedUrl(video.url), title: video.title || i18n.t('trainingPage.recording'), loading: 'lazy',
        allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      } }),
      el(document, 'figcaption', { className: 'muted', text: video.title || i18n.t('trainingPage.recording') }),
    ]));
  }
  const time = new Intl.DateTimeFormat(i18n.locale() === 'pt' ? 'pt-PT' : 'en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: training.timezone || ctx.timezone,
  }).format(new Date(training.occurred_at));
  const meta = [i18n.formatDate(`${training.local_date}T12:00:00`, { weekday: 'short', day: 'numeric', month: 'short' }),
    time, training.kind === 'alone' ? null : training.coach_name].filter(Boolean).join(' · ');
  screen.append(el(document, 'h1', { className: 'training-title', text: titleFor(i18n, training) }),
    el(document, 'p', { className: 'training-meta muted', text: meta }));
  const tags = el(document, 'div', { className: 'training-tags' }, [
    el(document, 'span', { className: 'tag', text: `⏱ ${i18n.formatDuration(training.duration_minutes)}` }),
    training.kind === 'group' ? el(document, 'span', { className: 'tag', text: `👥 ${i18n.t('today.attended', { count: training.attendee_count })}` }) : null,
  ]);
  screen.append(tags);

  if (training.resources.length) {
    screen.append(el(document, 'div', { className: 'resource-buttons' }, training.resources.map((resource) => el(document, 'button', {
      className: 'button-secondary', text: `${RESOURCE_ICONS[resource.kind]} ${resource.title || i18n.t(`resources.${resource.kind}`)}`,
      attrs: { type: 'button' }, dataset: { resource: resource.id },
      on: { click: () => {
        if (resource.kind === 'video') {
          if (resource === video) screen.querySelector('.training-video')?.scrollIntoView({ behavior: 'smooth' });
          else ctx.window?.open?.(resource.url, '_blank', 'noopener,noreferrer');
          return;
        }
        const body = resource.kind === 'summary'
          ? el(document, 'div', { className: 'resource-markdown' }, [renderMarkdown(document, resource.body)])
          : el(document, 'pre', { className: 'resource-transcript', text: resource.body });
        ctx.openSheet({ title: resource.title || i18n.t(`resources.${resource.kind}`), content: body });
      } },
    }))));
  }

  screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.rounds') }));
  screen.append(el(document, 'ol', { className: 'chapters' }, training.rounds.map((round, index) => {
    const felt = (round.ratings ?? []).find(({ segment_key: key }) => key === 'r');
    return el(document, 'li', { className: 'chapter' }, [
      el(document, 'span', { className: 'chapter-number', text: String(index + 1) }),
      el(document, 'span', { className: 'chapter-text', text: roundText(round) }),
      felt ? el(document, 'span', { className: 'felt', text: i18n.t('today.felt', { difficulty: i18n.t(`training.${felt.difficulty}`) }) }) : null,
    ]);
  })));

  if (training.participation?.personal_notes) {
    screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.notes') }),
      el(document, 'p', { className: 'training-notes', text: training.participation.personal_notes }));
  }
  if (training.feedback.length) {
    screen.append(el(document, 'h2', { className: 'section-label', text: i18n.t('trainingPage.feedback') }),
      ...training.feedback.map((entry) => el(document, 'blockquote', { className: 'feedback' }, [
        el(document, 'p', { text: entry.body }), el(document, 'cite', { className: 'muted', text: entry.coach_name ?? '' }),
      ])));
  }

  let pending = [];
  try {
    pending = JSON.parse(document.defaultView?.localStorage?.getItem(`roda.pendingResources:${training.occurrence_id}`) ?? '[]');
  } catch {
    pending = [];
  }
  if (training.can_add_resources && Array.isArray(pending) && pending.length) {
    screen.append(el(document, 'div', { className: 'card pending-resources' }, [createResourceSection({
      document, i18n, item: { ...training, resources: [] }, service: ctx.services.training, onChanged: reload,
    })]));
  }

  const actions = [];
  if (training.participation) {
    actions.push(el(document, 'button', { className: 'bar-main', text: `★ ${i18n.t('trainingPage.rate')}`, attrs: { type: 'button' }, dataset: { action: 'rate' },
      on: { click: () => {
        const content = el(document, 'div', { className: 'rate-rounds' }, training.rounds.map((round, index) => createRoundDetail({
          document, i18n, round, index, editable: true, getTermMappings: ctx.getTermMappings,
          onSave: (ratings) => ctx.services.training.saveRoundAssessments({ participationId: training.participation.id, roundId: round.id, ratings }),
        })));
        ctx.openSheet({ title: i18n.t('trainingPage.rate'), content, onClose: reload });
      } } }));
    actions.push(el(document, 'button', { text: `📝 ${i18n.t('trainingPage.editNotes')}`, attrs: { type: 'button' }, dataset: { action: 'notes' },
      on: { click: () => {
        const textarea = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { 'aria-label': i18n.t('trainingPage.notes'), maxlength: '4000' } });
        textarea.value = training.participation.personal_notes ?? '';
        const status = el(document, 'p', { attrs: { role: 'status' } });
        const form = el(document, 'form', {}, [textarea, el(document, 'button', { className: 'button-primary', text: i18n.t('trainingPage.saveNotes'), attrs: { type: 'submit' } }), status]);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            await ctx.services.training.saveNotes({ participationId: training.participation.id, notes: textarea.value });
            status.textContent = i18n.t('trainingPage.notesSaved');
          } catch (error) {
            status.textContent = error?.message || i18n.t('training.saveError');
          }
        });
        ctx.openSheet({ title: i18n.t('trainingPage.notes'), content: form, onClose: reload });
      } } }));
  }
  if (training.can_add_resources) {
    actions.push(el(document, 'button', { text: `📎 ${i18n.t('trainingPage.add')}`, attrs: { type: 'button' }, dataset: { action: 'add' },
      on: { click: () => {
        const section = createResourceSection({ document, i18n, item: { ...training, resources: [] }, service: ctx.services.training, onChanged: async () => {} });
        ctx.openSheet({ title: i18n.t('resources.add'), content: section, onClose: reload });
        section.querySelector('[data-action="open-resources"]')?.click();
      } } }));
  }
  if (actions.length) screen.append(el(document, 'div', { className: 'training-bar' }, actions));
  return screen;
}

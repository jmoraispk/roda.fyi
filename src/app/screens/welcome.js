// src/app/screens/welcome.js
import { modeOf } from '../shell/access.js';
import { el } from '../shell/page.js';
import { createModeSlider } from './mode-slider.js';
import { createProfileForm, nameProblem, saveProfile } from './profile-form.js';

const profileStep = {
  id: 'profile',
  title: 'welcome.profileTitle',
  render(state, ctx) {
    state.form ??= createProfileForm({ document: ctx.document, i18n: ctx.i18n, user: ctx.user, profile: ctx.profile });
    return state.form.element;
  },
  validate(state) {
    return nameProblem(state.form.values().displayName);
  },
};

const modeStep = {
  id: 'mode',
  title: 'welcome.modeTitle',
  render(state, ctx) {
    // One line under the slider says what the chosen position changes.
    state.means ??= el(ctx.document, 'p', { className: 'card mode-means' });
    state.slider ??= createModeSlider({
      document: ctx.document, i18n: ctx.i18n, value: state.mode,
      onChange: (mode) => {
        state.mode = mode;
        state.means.textContent = ctx.i18n.t(`welcome.means.${mode}`);
      },
    });
    state.means.textContent = ctx.i18n.t(`welcome.means.${state.mode}`);
    return el(ctx.document, 'div', {}, [
      state.slider.element,
      state.means,
      el(ctx.document, 'p', { className: 'muted', text: ctx.i18n.t('welcome.modeNote') }),
    ]);
  },
};

// Ruling R1: Plan 3 appends its city and "Who can find you" step to this list.
export function welcomeSteps() {
  return [profileStep, modeStep];
}

export async function renderWelcome(ctx, _route, { steps = welcomeSteps(), onDone }) {
  const { document, i18n } = ctx;
  const state = { mode: modeOf(ctx.profile), memo: {} };
  let index = 0;
  let saving = false;
  const progress = el(document, 'p', { className: 'muted welcome-progress' });
  const heading = el(document, 'h2', { className: 'welcome-step-title' });
  const body = el(document, 'div', { className: 'welcome-body' });
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const back = el(document, 'button', { className: 'button-secondary', text: i18n.t('welcome.back'), attrs: { type: 'button' }, dataset: { action: 'welcome-back' } });
  const next = el(document, 'button', { className: 'button-primary', attrs: { type: 'button' }, dataset: { action: 'welcome-next' } });
  const isLast = () => index === steps.length - 1;

  function show() {
    const step = steps[index];
    progress.textContent = i18n.t('welcome.step', { number: index + 1, total: steps.length });
    heading.textContent = i18n.t(step.title);
    body.replaceChildren(step.render(state, ctx));
    back.hidden = index === 0;
    next.textContent = i18n.t(isLast() ? 'welcome.finish' : 'welcome.next');
    status.textContent = '';
  }

  async function finish() {
    saving = true;
    next.disabled = true;
    next.textContent = i18n.t('welcome.saving');
    status.textContent = '';
    try {
      await ctx.services.profile.setUsageMode(state.mode);
      for (const step of steps) await step.save?.(state, ctx);
      const fresh = await saveProfile(ctx, state.form.values(), state.memo);
      onDone(fresh, state.mode);
    } catch (error) {
      status.textContent = error?.message || i18n.t('welcome.saveError');
    } finally {
      saving = false;
      next.disabled = false;
      next.textContent = i18n.t(isLast() ? 'welcome.finish' : 'welcome.next');
    }
  }

  back.addEventListener('click', () => {
    if (saving || index === 0) return;
    index -= 1;
    show();
  });
  next.addEventListener('click', () => {
    if (saving) return;
    const problem = steps[index].validate?.(state, ctx);
    if (problem) {
      status.textContent = i18n.t(problem);
      return;
    }
    if (!isLast()) {
      index += 1;
      show();
      return;
    }
    finish();
  });

  const screen = el(document, 'section', { className: 'screen screen-welcome' }, [
    el(document, 'h1', { className: 'page-title', text: i18n.t('welcome.title') }),
    progress, heading, body, status,
    el(document, 'div', { className: 'welcome-actions' }, [back, next]),
  ]);
  show();
  return screen;
}

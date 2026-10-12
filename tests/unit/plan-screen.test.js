// tests/unit/plan-screen.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderPlan } from '../../src/app/screens/plan.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

const draft = {
  plan_id: 'p2', version_id: 'v2', title: 'Ginga drills', state: 'draft', expected_duration_minutes: 45,
  description: null, instructions: null, updated_at: 't0', source_group_id: null, rounds: [{ source_text: 'ginga 10 min' }],
};

function typeRound(view, text) {
  const round = view.querySelector('textarea[data-round-text]');
  round.value = text;
  round.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('plan page', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('creates a draft and moves to its page', async () => {
    const training = { listPlans: vi.fn(), createPlan: vi.fn().mockResolvedValue({ status: 'created', plan_id: 'p9', version_id: 'v9', updated_at: 't1' }) };
    const ctx = appCtx({ services: { training, repertoire: { list: vi.fn().mockResolvedValue([]) } } });
    const view = await renderPlan(ctx, { name: 'teaching-plan', params: { id: 'new' }, query: {} });
    document.body.replaceChildren(view);
    expect(training.listPlans).not.toHaveBeenCalled();
    expect(view.querySelector('[data-action="publish-plan"]').hidden).toBe(true);
    view.querySelector('[data-action="save-plan"]').click();
    await vi.waitFor(() => expect(view.querySelector('.form-status[role="status"]').textContent).toBe('Add at least one round.'));
    view.querySelector('input[name="title"]').value = 'Armada ladder';
    typeRound(view, 'ginga 10 min');
    await vi.waitFor(() => expect(view.querySelector('[data-action="save-plan"]').disabled).toBe(false));
    view.querySelector('[data-action="save-plan"]').click();
    await vi.waitFor(() => expect(ctx.replace).toHaveBeenCalledWith('/me/teaching/plans/p9'));
    expect(training.createPlan).toHaveBeenCalledWith({
      title: 'Armada ladder', description: null, durationMinutes: 60, instructions: null,
      rounds: [expect.objectContaining({ source_text: 'ginga 10 min' })], groupId: null,
    });
  });

  it('saves before publishing and then shows the plan read-only', async () => {
    const training = {
      listPlans: vi.fn().mockResolvedValueOnce([draft]).mockResolvedValue([{ ...draft, title: 'Ginga drills 2', state: 'published' }]),
      savePlanDraft: vi.fn().mockResolvedValue({ status: 'saved', plan_id: 'p2', version_id: 'v2', updated_at: 't1' }),
      publishPlan: vi.fn().mockResolvedValue({ status: 'published' }),
    };
    const ctx = appCtx({ services: { training } });
    const view = await renderPlan(ctx, { name: 'teaching-plan', params: { id: 'p2' }, query: {} });
    document.body.replaceChildren(view);
    expect(view.querySelector('input[name="title"]').value).toBe('Ginga drills');
    view.querySelector('input[name="title"]').value = 'Ginga drills 2';
    view.querySelector('[data-action="publish-plan"]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="schedule-plan"]')).not.toBeNull());
    expect(training.savePlanDraft).toHaveBeenCalledWith(expect.objectContaining({ planId: 'p2', expectedUpdatedAt: 't0', title: 'Ginga drills 2' }));
    expect(training.publishPlan).toHaveBeenCalledWith('p2');
    expect(document.querySelector('input[name="title"]')).toBeNull();
    expect(document.querySelector('h1').textContent).toBe('Ginga drills 2');
    expect(document.querySelector('.chapter-text').textContent).toBe('ginga 10 min');
  });

  it('explains a plan that is not mine', async () => {
    const ctx = appCtx({ services: { training: { listPlans: vi.fn().mockResolvedValue([]) } } });
    const view = await renderPlan(ctx, { name: 'teaching-plan', params: { id: 'nope' }, query: {} });
    expect(view.textContent).toContain("This plan isn't available.");
  });
});

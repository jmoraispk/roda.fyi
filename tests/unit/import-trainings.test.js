// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importKey, parseImport, renderImport } from '../../src/app/screens/import-trainings.js';
import { closeSheet } from '../../src/app/shell/sheet.js';
import { appCtx } from './app-test-context.js';

const NOW = new Date('2026-11-01T12:00:00Z');
const file = (trainings) => JSON.stringify({ trainings });
const one = {
  id: 'zoom-20261013-130606', start: '2026-10-13T13:06:06Z', durationMinutes: 108,
  notes: 'Class with the professor.', rounds: ['Round 1 · 15 min: ginga', '10x (armada, aú)'],
  resources: [
    { kind: 'video', url: 'https://www.youtube.com/watch?v=REtWeTI2Ihw' },
    { kind: 'summary', body: '# Class summary' },
    { kind: 'voice', title: 'Transcript', body: 'We started with ginga…' },
  ],
};

describe('import trainings', () => {
  beforeEach(() => { closeSheet(); document.body.replaceChildren(); });

  it('reads a file of past trainings', () => {
    const { trainings, errors } = parseImport(file([one]), { now: NOW });
    expect(errors).toEqual([]);
    expect(trainings).toEqual([expect.objectContaining({
      id: 'zoom-20261013-130606', start: '2026-10-13T13:06:06.000Z', durationMinutes: 108, rounds: one.rounds,
      resources: [
        { kind: 'video', title: '', url: 'https://www.youtube.com/watch?v=REtWeTI2Ihw', body: null },
        { kind: 'summary', title: '', url: null, body: '# Class summary' },
        { kind: 'voice', title: 'Transcript', url: null, body: 'We started with ginga…' },
      ],
    })]);
  });

  it.each([
    ['not JSON', 'The file is not valid JSON.'],
    [file([]), 'The file has no trainings.'],
    [file([{ ...one, id: '' }]), 'Training 1: add an id.'],
    [file([{ ...one, start: 'yesterday' }]), 'Training 1: the start time is not a date and time.'],
    [file([{ ...one, start: '2026-12-01T10:00:00Z' }]), 'Training 1: the start time is in the future.'],
    [file([{ ...one, durationMinutes: 0 }]), 'Training 1: the duration must be 1 to 600 minutes.'],
    [file([{ ...one, rounds: [] }]), 'Training 1: add at least one round.'],
    [file([{ ...one, resources: [{ kind: 'video', url: 'http://x' }] }]), 'Training 1: resource 1 is not a video link, summary, or transcript.'],
    [file([one, one]), 'Training 2: the id zoom-20261013-130606 is used twice.'],
  ])('explains a file it cannot use: %s', (text, message) => {
    expect(parseImport(text, { now: NOW }).errors).toContain(message);
  });

  it('makes the same keys every time, different per training and resource', async () => {
    const a = await importKey('zoom-1', 'training');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await importKey('zoom-1', 'training')).toBe(a);
    expect(await importKey('zoom-1', 'resource-0')).not.toBe(a);
    expect(await importKey('zoom-2', 'training')).not.toBe(a);
  });

  it('previews, then imports each training with its resources as my own logs', async () => {
    const training = {
      recordAloneTraining: vi.fn().mockResolvedValue({ occurrence_id: 'o1' }),
      addResource: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const ctx = appCtx({ services: { training }, timezone: 'America/New_York', now: () => NOW });
    const view = await renderImport(ctx);
    document.body.append(view);
    const area = view.querySelector('textarea[name="importFile"]');
    area.value = file([one]);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.querySelector('.import-preview').textContent).toContain('1 training');
    expect(view.querySelector('[data-import-row]').textContent).toContain('2 rounds · 3 resources');
    area.value = JSON.stringify({ trainings: [{ ...one, rounds: ['ginga'], resources: [one.resources[0]] }] });
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.querySelector('[data-import-row]').textContent).toContain('1 round · 1 resource');
    area.value = file([one]);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    view.querySelector('[data-action="import"]').click();
    await vi.waitFor(() => expect(view.querySelector('[data-import-row="zoom-20261013-130606"]').textContent).toContain('Imported'));
    expect(training.recordAloneTraining).toHaveBeenCalledWith(expect.objectContaining({
      localDate: '2026-10-13', timezone: 'America/New_York', durationMinutes: 108, notes: 'Class with the professor.',
      occurredAt: '2026-10-13T13:06:06.000Z', idempotencyKey: await importKey('zoom-20261013-130606', 'training'),
      rounds: [expect.objectContaining({ source_text: 'Round 1 · 15 min: ginga', duration_seconds: 900 }), expect.anything()],
    }));
    expect(training.addResource).toHaveBeenCalledTimes(3);
    expect(training.addResource).toHaveBeenCalledWith(expect.objectContaining({
      occurrenceId: 'o1', kind: 'video', clientKey: await importKey('zoom-20261013-130606', 'resource-0'),
    }));
  });

  it('keeps going when one training fails and says which', async () => {
    const training = {
      recordAloneTraining: vi.fn().mockRejectedValueOnce(new Error('The network request failed.')).mockResolvedValue({ occurrence_id: 'o2' }),
      addResource: vi.fn().mockResolvedValue({}),
    };
    const ctx = appCtx({ services: { training }, now: () => NOW });
    const view = await renderImport(ctx);
    document.body.append(view);
    const area = view.querySelector('textarea[name="importFile"]');
    area.value = file([one, { ...one, id: 'zoom-2', resources: [] }]);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    view.querySelector('[data-action="import"]').click();
    await vi.waitFor(() => expect(view.querySelector('[data-import-row="zoom-2"]').textContent).toContain('Imported'));
    expect(view.querySelector('[data-import-row="zoom-20261013-130606"]').textContent).toContain('The network request failed.');
  });
});

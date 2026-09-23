import { describe, expect, it, vi } from 'vitest';

import { seedDemoData } from '../../src/app/demo-data.js';

function storage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
    values,
  };
}

describe('demo data', () => {
  it('seeds a complete coach/practitioner account and current-month activity locally', () => {
    const localStorage = storage();

    seedDemoData(localStorage, new Date('2026-09-22T12:00:00Z'));

    const profile = JSON.parse(localStorage.getItem('roda.e2e.profile'));
    const coach = JSON.parse(localStorage.getItem('roda.e2e.coachProfile'));
    const groups = JSON.parse(localStorage.getItem('roda.e2e.groupState'));
    const training = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    expect(profile).toMatchObject({ id: 'practitioner-1', completed_at: expect.any(String) });
    expect(coach).toMatchObject({ profile_id: 'practitioner-1' });
    expect(groups.memberships).toHaveLength(1);
    expect(groups.rosters['demo-group'].length).toBeGreaterThanOrEqual(4);
    expect(training.occurrences.filter(({ local_date: date }) => date.startsWith('2026-09-')))
      .toHaveLength(8);
    expect(training.schedules).toContainEqual(expect.objectContaining({
      kind: 'group', state: 'scheduled', group_id: 'demo-group',
    }));
  });

  it('restores the demo session without overwriting demo edits', () => {
    const localStorage = storage();
    seedDemoData(localStorage, new Date('2026-09-22T12:00:00Z'));
    const training = JSON.parse(localStorage.getItem('roda.e2e.trainingState'));
    training.occurrences.push({ id: 'user-added' });
    localStorage.setItem('roda.e2e.trainingState', JSON.stringify(training));
    localStorage.removeItem('roda.e2e.session');

    seedDemoData(localStorage, new Date('2026-09-22T12:00:00Z'));

    expect(JSON.parse(localStorage.getItem('roda.e2e.session')).user.id)
      .toBe('practitioner-1');
    expect(JSON.parse(localStorage.getItem('roda.e2e.trainingState')).occurrences)
      .toContainEqual({ id: 'user-added' });
  });
});

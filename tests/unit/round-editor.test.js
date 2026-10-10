// tests/unit/round-editor.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createRoundEditor } from '../../src/app/ui/round-editor.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

function type(textarea, value) {
  textarea.value = value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function mount(options = {}) {
  const editor = createRoundEditor({ document, i18n, mode: 'record', ...options });
  document.body.replaceChildren(editor.element);
  return editor;
}

const text = (n = 1) => document.querySelector(`textarea[aria-label="Round ${n} text"]`);

describe('round editor', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('starts with one round and shows recognized and new chips in order', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: '' }]);
    type(text(), '10x armada, galopanti → aú');
    const chips = [...document.querySelectorAll('[data-chip]')].map((chip) => [chip.dataset.chip, chip.dataset.status]);
    expect(chips).toEqual([['1', 'known'], ['2', 'new'], ['3', 'known']]);
    expect(editor.getRounds()).toEqual([expect.objectContaining({
      label: null, source_text: '10x armada, galopanti → aú',
      movements: [
        expect.objectContaining({ movement_key: 'armada', repetitions: 10, catalogued: true }),
        expect.objectContaining({ movement_key: 'galopanti', catalogued: false }),
        expect.objectContaining({ movement_key: 'au' }),
      ],
      ratings: [],
    })]);
  });

  it('excludes a chip without changing the text', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: 'armada, stretching, au' }]);
    document.querySelector('button[aria-label="Not a move: stretching"]').click();
    const [round] = editor.getRounds();
    expect(round.source_text).toBe('armada, stretching, au');
    expect(round.movements.map(({ movement_key: key }) => key)).toEqual(['armada', 'au']);
  });

  it('collects the round rating and segment ratings with neighbors', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: 'armada, au' }]);
    document.querySelector('[data-round-difficulty] input[value="hard"]').click();
    document.querySelector('button[aria-label="Rate parts"]').click();
    document.querySelector('[data-segment-key="t:1>2"]').click();
    document.querySelector('[data-segment-editor] input[value="hard"]').click();
    expect(editor.getRounds()[0].ratings).toEqual([
      { segment_key: 'r', segment_kind: 'round', difficulty: 'hard', note: null, from_movement_key: null, to_movement_key: null },
      { segment_key: 't:1>2', segment_kind: 'transition', difficulty: 'hard', note: null, from_movement_key: 'armada', to_movement_key: 'au' },
    ]);
  });

  it('drops ratings for parts that disappear after editing', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: 'armada, au' }]);
    document.querySelector('button[aria-label="Rate parts"]').click();
    document.querySelector('[data-segment-key="t:1>2"]').click();
    document.querySelector('[data-segment-editor] input[value="hard"]').click();
    type(text(), 'armada');
    expect(editor.getRounds()[0].ratings).toEqual([]);
  });

  it('splits pasted multi-round text into cards', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: '' }]);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { getData: () => 'Round 1: ginga 10 min\nRound 2: 10x (armada, au)' };
    text().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getRounds().map(({ source_text: value }) => value)).toEqual(['ginga 10 min', '10x (armada, au)']);
  });

  it('appends picked moves and inserts saved sequences as a group', async () => {
    const repertoire = {
      list: vi.fn().mockResolvedValue([{ id: 's1', title: 'Flow', source_text: 'armada, au' }]),
      save: vi.fn().mockResolvedValue({ status: 'saved' }),
    };
    const editor = mount({ repertoire });
    editor.setRounds([{ sourceText: 'ginga' }]);
    document.querySelector('button[aria-label="Add moves"]').click();
    document.querySelector('[data-pick="armada"]').click();
    expect(text().value).toBe('ginga, Armada');
    document.querySelector('button[aria-label="Insert saved sequence"]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-saved-select] option[value="s1"]')).not.toBeNull());
    document.querySelector('[data-action="insert-saved"]').click();
    expect(text().value).toBe('ginga, Armada, 1x (armada, au)');
    document.querySelector('button[aria-label="Save as sequence"]').click();
    await vi.waitFor(() => expect(repertoire.save).toHaveBeenCalledWith({
      title: '', sourceText: 'ginga, Armada, 1x (armada, au)', sequence: expect.any(Array),
    }));
  });

  it('labels planned difficulty in plan mode and shows plan expectations in record mode', () => {
    mount({ mode: 'plan' }).setRounds([{ sourceText: 'armada' }]);
    expect(document.querySelector('[data-round-difficulty] legend').textContent).toBe('Planned difficulty');
    mount().setRounds([{ sourceText: 'armada', planned: [{ segment_key: 'r', segment_kind: 'round', difficulty: 'hard' }] }]);
    expect(document.querySelector('[data-planned]').textContent).toBe('Planned: Hard');
  });

  it('adds and removes rounds and ignores blank cards', () => {
    const editor = mount();
    editor.setRounds([{ sourceText: 'armada' }]);
    document.querySelector('[data-action="add-round"]').click();
    expect(text(2)).not.toBeNull();
    expect(editor.getRounds()).toHaveLength(1);
    document.querySelector('button[aria-label="Remove round 1"]').click();
    expect(text(1).value).toBe('');
    expect(editor.hasContent()).toBe(false);
  });

  it('hides difficulty controls when ratings are off', () => {
    const editor = mount({ ratings: false });
    editor.setRounds([{ sourceText: 'armada' }]);
    expect(document.querySelector('[data-round-difficulty]')).toBeNull();
    expect(document.querySelector('button[aria-label="Rate parts"]')).toBeNull();
    expect(editor.getRounds()[0].ratings).toEqual([]);
  });
});

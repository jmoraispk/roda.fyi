// src/app/ui/move-picker.js
import { listCategories, listMoves } from '../movement-catalog.js';
import { figureSvg } from './move-figure.js';

export function createMovePicker({ document, i18n, onPick }) {
  const element = document.createElement('div');
  element.className = 'move-picker';
  element.dataset.movePicker = '';
  const chips = document.createElement('div');
  chips.className = 'move-picker-categories';
  chips.setAttribute('role', 'group');
  const grid = document.createElement('div');
  grid.className = 'move-picker-grid';
  element.append(chips, grid);
  let category = 'all';

  function renderChips() {
    chips.setAttribute('aria-label', i18n.t('picker.categories'));
    chips.replaceChildren(...['all', ...listCategories()].map((id) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.category = id;
      chip.textContent = i18n.t(`catalog.category.${id}`);
      chip.setAttribute('aria-pressed', String(id === category));
      return chip;
    }));
  }

  function renderGrid() {
    grid.setAttribute('aria-label', i18n.t('picker.moves'));
    const moves = listMoves({ category: category === 'all' ? null : category });
    grid.replaceChildren(...moves.map((entry) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'pick';
      tile.dataset.pick = entry.slug;
      tile.setAttribute('aria-label', entry.name);
      const name = document.createElement('span');
      name.className = 'pick-name';
      name.textContent = entry.name;
      tile.append(figureSvg(document, entry), name);
      return tile;
    }));
  }

  function setCategory(next) {
    category = next;
    renderChips();
    renderGrid();
  }

  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category]');
    if (chip) setCategory(chip.dataset.category);
  });
  grid.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-pick]');
    if (!tile) return;
    const entry = listMoves().find(({ slug }) => slug === tile.dataset.pick);
    if (entry) onPick(entry);
  });

  setCategory('all');
  return { element, setCategory, refreshCopy: () => setCategory(category) };
}

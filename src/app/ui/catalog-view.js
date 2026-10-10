// src/app/ui/catalog-view.js
import { listMoves, slugify } from '../movement-catalog.js';

export function createCatalogView({ document, i18n, catalog, onMappingsChanged }) {
  const panel = document.querySelector('#trainingCatalogPanel');
  let terms = [];
  let token = 0;

  function cell(tag, text, dataName) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (dataName) node.dataset[dataName] = '';
    return node;
  }

  function actionButton(text, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = text;
    button.dataset.action = action;
    return button;
  }

  function render(message = '') {
    panel.replaceChildren(cell('h2', i18n.t('catalog.title')), cell('p', i18n.t('catalog.intro')));
    const status = cell('p', message);
    status.setAttribute('role', 'status');
    panel.append(status);
    if (!terms.length) {
      const empty = cell('p', i18n.t('catalog.empty'));
      empty.className = 'calendar-empty';
      panel.append(empty);
      return;
    }
    const table = document.createElement('table');
    table.className = 'catalog-table';
    const head = document.createElement('tr');
    for (const key of ['catalog.term', 'catalog.spelling', 'catalog.people', 'catalog.uses', 'catalog.seen', 'catalog.actions']) {
      head.append(cell('th', i18n.t(key)));
    }
    table.append(head);
    for (const term of terms) {
      const row = document.createElement('tr');
      row.dataset.term = term.term;
      const seen = [term.first_seen, term.last_seen].map((value) => (value ? i18n.formatDate(value) : '—')).join(' / ');
      row.append(
        cell('td', term.term), cell('td', term.spelling),
        cell('td', String(term.people), 'people'), cell('td', String(term.uses), 'uses'),
        cell('td', seen),
      );
      const actions = document.createElement('td');
      const select = document.createElement('select');
      select.className = 'field-input';
      select.setAttribute('aria-label', i18n.t('catalog.mapTo', { term: term.term }));
      for (const move of listMoves()) {
        const option = document.createElement('option');
        option.value = move.slug;
        option.textContent = move.name;
        select.append(option);
      }
      const merge = document.createElement('input');
      merge.className = 'field-input';
      merge.setAttribute('aria-label', i18n.t('catalog.mergeInto', { term: term.term }));
      const needsVideo = document.createElement('input');
      needsVideo.type = 'checkbox';
      needsVideo.checked = Boolean(term.needs_video);
      needsVideo.dataset.action = 'needs-video';
      const videoLabel = document.createElement('label');
      videoLabel.append(needsVideo, ` ${i18n.t('catalog.needsVideo')}`);
      actions.append(
        select, actionButton(i18n.t('catalog.map'), 'map'),
        merge, actionButton(i18n.t('catalog.merge'), 'merge'),
        actionButton(i18n.t('catalog.ignore'), 'ignore'), videoLabel,
      );
      row.append(actions);
      table.append(row);
    }
    panel.append(table);
  }

  async function load(message = '') {
    const current = ++token;
    try {
      const next = await catalog.listUncataloguedTerms();
      if (current !== token) return;
      terms = next;
      render(message);
    } catch (error) {
      if (current === token) render(error?.message || i18n.t('catalog.loadError'));
    }
  }

  async function act(run) {
    try {
      await run();
      await onMappingsChanged();
      await load(i18n.t('catalog.saved'));
    } catch (error) {
      render(error?.message || i18n.t('catalog.loadError'));
    }
  }

  panel.addEventListener('click', (event) => {
    const control = event.target.closest('[data-action]');
    const row = event.target.closest('[data-term]');
    if (!control || !row) return;
    const term = row.dataset.term;
    if (control.dataset.action === 'map') act(() => catalog.mapTerm(term, row.querySelector('select').value));
    if (control.dataset.action === 'merge') {
      const target = slugify(row.querySelector('input:not([type])').value);
      if (target) act(() => catalog.mergeTerm(term, target));
    }
    if (control.dataset.action === 'ignore') act(() => catalog.ignoreTerm(term));
    if (control.dataset.action === 'needs-video') act(() => catalog.setNeedsVideo(term, control.checked));
  });

  return {
    load,
    clear() {
      token += 1;
      terms = [];
      panel.replaceChildren();
    },
  };
}

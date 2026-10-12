// src/app/ui/repertoire-view.js
export function createRepertoireView({ document, i18n, repertoire, onLog, panel: panelElement = null }) {
  const panel = panelElement ?? document.querySelector('#trainingRepertoirePanel');
  let items = [];
  let renaming = null;
  let confirming = null;
  let loadToken = 0;

  function button(text, action, id) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'secondary-button';
    node.textContent = text;
    node.dataset.action = action;
    node.dataset.id = id;
    return node;
  }

  function render(message = '') {
    panel.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = i18n.t('repertoire.title');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = message;
    panel.append(heading, status);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'calendar-empty';
      empty.textContent = i18n.t('repertoire.empty');
      panel.append(empty);
      return;
    }
    const list = document.createElement('div');
    list.className = 'repertoire-list';
    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'repertoire-card';
      card.dataset.sequenceId = item.id;
      if (renaming === item.id) {
        const form = document.createElement('form');
        form.dataset.rename = item.id;
        const label = document.createElement('label');
        label.textContent = i18n.t('repertoire.titleLabel');
        const input = document.createElement('input');
        input.name = 'title';
        input.className = 'field-input';
        input.maxLength = 120;
        input.value = item.title;
        label.append(input);
        const save = document.createElement('button');
        save.type = 'submit';
        save.className = 'secondary-button';
        save.textContent = i18n.t('repertoire.saveTitle');
        form.append(label, save);
        card.append(form);
      } else {
        const title = document.createElement('h3');
        title.textContent = item.title;
        card.append(title);
      }
      const text = document.createElement('p');
      text.className = 'repertoire-text';
      text.textContent = item.source_text;
      const actions = document.createElement('div');
      actions.className = 'dashboard-actions';
      actions.append(
        button(i18n.t('repertoire.log'), 'log', item.id),
        button(i18n.t('repertoire.rename'), 'rename', item.id),
        button(i18n.t(confirming === item.id ? 'repertoire.confirmDelete' : 'repertoire.delete'), 'delete', item.id),
      );
      card.append(text, actions);
      list.append(card);
    }
    panel.append(list);
  }

  async function load(message = '') {
    const token = ++loadToken;
    try {
      const next = await repertoire.list();
      if (token !== loadToken) return;
      items = next;
      render(message);
    } catch (error) {
      if (token === loadToken) render(error?.message || i18n.t('repertoire.loadError'));
    }
  }

  panel.addEventListener('click', async (event) => {
    const target = event.target.closest('button[data-action]');
    if (!target || target.type === 'submit') return;
    const item = items.find(({ id }) => id === target.dataset.id);
    if (!item) return;
    if (target.dataset.action === 'log') onLog(item);
    if (target.dataset.action === 'rename') { renaming = item.id; confirming = null; render(); }
    if (target.dataset.action === 'delete') {
      if (confirming !== item.id) { confirming = item.id; render(); return; }
      confirming = null;
      try {
        await repertoire.remove(item.id);
        await load(i18n.t('repertoire.deleted'));
      } catch (error) {
        render(error?.message || i18n.t('repertoire.saveError'));
      }
    }
  });

  panel.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-rename]');
    if (!form) return;
    event.preventDefault();
    const item = items.find(({ id }) => id === form.dataset.rename);
    try {
      await repertoire.save({ id: item.id, title: form.elements.title.value, sourceText: item.source_text, sequence: item.sequence ?? null });
      renaming = null;
      await load(i18n.t('repertoire.renamed'));
    } catch (error) {
      render(error?.message || i18n.t('repertoire.saveError'));
    }
  });

  return {
    load,
    clear() {
      loadToken += 1;
      items = [];
      panel.replaceChildren();
    },
  };
}

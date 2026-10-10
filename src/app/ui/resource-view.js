// src/app/ui/resource-view.js
import { renderMarkdown } from '../markdown-lite.js';
import { normalizeResource } from '../training-service.js';

export const RESOURCE_ICONS = Object.freeze({ video: '🎥', voice: '🎙️', summary: '📄' });
const ORDER = ['video', 'voice', 'summary'];

export function resourceIcons(document, i18n, kinds) {
  const present = ORDER.filter((kind) => kinds.includes(kind));
  const span = document.createElement('span');
  span.className = 'resource-icons';
  span.textContent = present.map((kind) => RESOURCE_ICONS[kind]).join('');
  span.setAttribute('aria-label', present.map((kind) => i18n.t(`resources.${kind}`)).join(', '));
  return span;
}

function titleFor(i18n, resource) {
  return resource.title || i18n.t(`resources.${resource.kind}`);
}

// The queue lives in memory and is mirrored to browser storage when possible,
// so unsynced resources survive a reload but saving never depends on storage.
function pendingStore(document, occurrenceId) {
  const key = `roda.pendingResources:${occurrenceId}`;
  let storage = null;
  try {
    storage = document.defaultView?.localStorage ?? null;
  } catch {
    storage = null;
  }
  let items = [];
  try {
    const value = JSON.parse(storage?.getItem(key) ?? '[]');
    items = Array.isArray(value) ? value : [];
  } catch {
    items = [];
  }
  return {
    read() {
      return [...items];
    },
    write(next) {
      items = [...next];
      try {
        if (items.length) storage?.setItem(key, JSON.stringify(items));
        else storage?.removeItem(key);
      } catch {
        // Storage full or blocked: the in-memory queue still holds the items.
      }
    },
  };
}

export function createResourceSection({ document, i18n, item, service, onChanged }) {
  const pending = pendingStore(document, item.occurrence_id);

  async function syncPending(status) {
    let queue = pending.read();
    try {
      while (queue.length) {
        await service.addResource(queue[0]);
        queue = queue.slice(1);
        pending.write(queue);
      }
    } catch (error) {
      status.textContent = error?.message || i18n.t('resources.saveError');
      return false;
    }
    status.textContent = i18n.t('resources.saved');
    await onChanged();
    return true;
  }

  const section = document.createElement('section');
  section.className = 'training-resources';
  section.dataset.resources = item.occurrence_id;
  const heading = document.createElement('h4');
  heading.textContent = i18n.t('resources.title');
  section.append(heading);

  for (const resource of item.resources ?? []) {
    const row = document.createElement('div');
    row.className = `resource resource-${resource.kind}`;
    const label = `${RESOURCE_ICONS[resource.kind]} ${titleFor(i18n, resource)}`;
    if (resource.kind === 'video') {
      const link = document.createElement('a');
      link.href = resource.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = label;
      row.append(link);
    } else {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = label;
      details.append(summary);
      if (resource.kind === 'summary') {
        const body = document.createElement('div');
        body.className = 'resource-markdown';
        body.append(renderMarkdown(document, resource.body));
        details.append(body);
      } else {
        const body = document.createElement('pre');
        body.className = 'resource-transcript';
        body.textContent = resource.body;
        details.append(body);
      }
      row.append(details);
    }
    if (resource.can_edit) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quiet-button';
      remove.textContent = '×';
      remove.dataset.action = 'delete-resource';
      remove.dataset.resourceId = resource.id;
      remove.setAttribute('aria-label', i18n.t('resources.delete', { title: titleFor(i18n, resource) }));
      row.append(remove);
    }
    section.append(row);
  }

  if (!item.can_add_resources) return section;

  const waiting = pending.read();
  if (waiting.length) {
    const notice = document.createElement('p');
    notice.dataset.pendingResources = '';
    notice.textContent = waiting.length === 1
      ? i18n.t('resources.pendingOne')
      : i18n.t('resources.pendingMany', { count: waiting.length });
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'secondary-button';
    retry.dataset.action = 'retry-resources';
    retry.textContent = i18n.t('resources.retry');
    const retryStatus = document.createElement('p');
    retryStatus.setAttribute('role', 'status');
    retryStatus.dataset.retryStatus = '';
    section.append(notice, retry, retryStatus);
  }

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'secondary-button';
  open.dataset.action = 'open-resources';
  open.textContent = i18n.t('resources.add');
  section.append(open);

  function buildForm() {
    const form = document.createElement('form');
    form.dataset.resourceForm = item.occurrence_id;
    const field = (labelKey, control) => {
      const label = document.createElement('label');
      label.className = 'field-label';
      label.textContent = i18n.t(labelKey);
      label.append(control);
      return label;
    };
    const kind = document.createElement('select');
    kind.name = 'kind';
    kind.className = 'field-input';
    for (const [value, key] of [['video', 'resources.videoLink'], ['voice', 'resources.voice'], ['summary', 'resources.summary']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = i18n.t(key);
      kind.append(option);
    }
    const title = Object.assign(document.createElement('input'), { name: 'title', className: 'field-input', maxLength: 200 });
    const url = Object.assign(document.createElement('input'), { name: 'url', className: 'field-input', type: 'url' });
    const text = Object.assign(document.createElement('textarea'), { name: 'body', className: 'field-input field-textarea' });
    const files = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.txt,.md,text/plain,text/markdown' });
    const save = Object.assign(document.createElement('button'), { type: 'submit', className: 'primary-button', textContent: i18n.t('resources.save') });
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    form.append(
      field('resources.kind', kind), field('resources.itemTitle', title), field('resources.link', url),
      field('resources.text', text), field('resources.files', files), save, status,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      status.textContent = '';
      save.disabled = true;
      const queued = [];
      const chosen = kind.value;
      if (chosen === 'video' && url.value.trim()) {
        queued.push({ occurrenceId: item.occurrence_id, kind: 'video', title: title.value, url: url.value, body: null });
      }
      if (chosen !== 'video' && text.value.trim()) {
        queued.push({ occurrenceId: item.occurrence_id, kind: chosen, title: title.value, url: null, body: text.value });
      }
      for (const file of files.files ?? []) {
        queued.push({
          occurrenceId: item.occurrence_id,
          kind: /\.md$/i.test(file.name) ? 'summary' : 'voice',
          title: file.name, url: null, body: await file.text(),
        });
      }
      if (!queued.length) {
        status.textContent = i18n.t('resources.empty');
        save.disabled = false;
        return;
      }
      try {
        queued.forEach((resource) => normalizeResource(resource));
      } catch (error) {
        status.textContent = error?.message || i18n.t('resources.saveError');
        save.disabled = false;
        return;
      }
      pending.write([...pending.read(), ...queued]);
      try {
        await syncPending(status);
      } finally {
        save.disabled = false;
      }
    });
    return form;
  }

  section.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'open-resources' && !section.querySelector('form[data-resource-form]')) {
      section.append(buildForm());
    }
    if (button.dataset.action === 'retry-resources') {
      button.disabled = true;
      await syncPending(section.querySelector('[data-retry-status]'));
      button.disabled = false;
    }
    if (button.dataset.action === 'delete-resource') {
      await service.deleteResource(button.dataset.resourceId);
      await onChanged();
    }
  });
  return section;
}

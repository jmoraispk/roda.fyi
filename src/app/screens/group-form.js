// src/app/screens/group-form.js
import { el } from '../shell/page.js';

function field(document, label, control) {
  return el(document, 'label', { className: 'field-label' }, [label, control]);
}

export function openGroupForm(ctx, { group = null, onSaved }) {
  const { document, i18n } = ctx;
  const input = (name, value, attrs = {}) => {
    const node = el(document, 'input', { className: 'field-input', attrs: { name, ...attrs } });
    node.value = value ?? '';
    return node;
  };
  const name = input('name', group?.name, { maxlength: '80' });
  const description = el(document, 'textarea', { className: 'field-input field-textarea', attrs: { name: 'description', maxlength: '1000' } });
  description.value = group?.description ?? '';
  const location = input('location', group?.location, { maxlength: '120' });
  const timezone = input('timezone', group?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'), { autocomplete: 'off' });
  const discoverable = el(document, 'input', { attrs: { type: 'checkbox', name: 'discoverable' } });
  discoverable.checked = Boolean(group?.is_discoverable);
  const status = el(document, 'p', { className: 'form-status', attrs: { role: 'status' } });
  const submit = el(document, 'button', { className: 'button-primary', text: i18n.t(group ? 'groupForm.save' : 'groupForm.create'), attrs: { type: 'submit' } });
  const form = el(document, 'form', { className: 'sheet-form', attrs: { novalidate: true } }, [
    field(document, i18n.t('groupForm.name'), name),
    field(document, i18n.t('groupForm.description'), description),
    field(document, i18n.t('groupForm.location'), location),
    field(document, i18n.t('groupForm.timezone'), timezone),
    el(document, 'label', { className: 'check-row' }, [discoverable, ` ${i18n.t('groupForm.discoverable')}`]),
    status, submit,
  ]);
  const sheet = ctx.openSheet({ title: i18n.t(group ? 'groupForm.editTitle' : 'groupForm.createTitle'), content: form });
  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!name.value.trim()) {
      status.textContent = i18n.t('groupForm.nameRequired');
      return;
    }
    busy = true;
    submit.disabled = true;
    status.textContent = '';
    const values = {
      name: name.value, description: description.value, location: location.value,
      timezone: timezone.value, discoverable: discoverable.checked,
    };
    try {
      const result = group
        ? await ctx.services.group.updateGroup(group.id, values)
        : await ctx.services.group.createGroup(values);
      sheet.close();
      onSaved(group?.id ?? result.group_id ?? result.id);
    } catch (error) {
      status.textContent = error?.message || i18n.t('groupForm.saveError');
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  return sheet;
}

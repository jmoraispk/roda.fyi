// src/app/screens/group-discover-form.js
import { contactsFromRow, fieldErrors, normalizePlace, placeFromRow, validateContacts } from '../discover-rules.js';
import { el } from '../shell/page.js';
import { createCityPicker, createContactFields, errorText } from './discover-settings.js';

export async function renderGroupDiscoverForm(ctx, groupId) {
  const { document, i18n } = ctx;
  let group;
  try {
    group = await ctx.services.discover.loadGroup(groupId);
  } catch (error) {
    return el(document, 'section', { className: 'group-discover' }, [el(document, 'p', { className: 'muted', text: errorText(i18n, error) })]);
  }
  if (!group || group.owner_id !== ctx.profile.id) return null;
  let place = placeFromRow(group);
  const city = createCityPicker(ctx, { value: place, onChange: (next) => { place = next; } });
  const contacts = createContactFields(ctx, { values: contactsFromRow(group), fields: ['instagram', 'website', 'email'] });
  const status = el(document, 'p', { className: 'muted', attrs: { role: 'status' } });
  const save = el(document, 'button', {
    className: 'button-primary', text: i18n.t('discoverSettings.save'), attrs: { type: 'button' }, dataset: { action: 'save-group-discover' },
  });
  save.addEventListener('click', async () => {
    const values = contacts.read();
    const errors = validateContacts(values);
    contacts.showErrors(errors);
    if (Object.keys(errors).length) {
      status.textContent = '';
      contacts.focusFirstError(errors);
      return;
    }
    save.disabled = true;
    status.textContent = i18n.t('log.saving');
    try {
      await ctx.services.discover.updateGroup(groupId, { place: normalizePlace(place), contacts: values });
      status.textContent = i18n.t('discoverSettings.saved');
    } catch (error) {
      contacts.showErrors(fieldErrors(error));
      status.textContent = errorText(i18n, error);
    } finally {
      save.disabled = false;
    }
  });
  return el(document, 'section', { className: 'group-discover', dataset: { groupId } }, [
    el(document, 'h2', { className: 'section-label', text: i18n.t('groupDiscover.title') }),
    group.is_discoverable ? null : el(document, 'p', { className: 'muted', text: i18n.t('groupDiscover.hidden') }),
    el(document, 'h3', { className: 'field-label', text: i18n.t('groupDiscover.place') }),
    city.element, contacts.element, save, status,
  ]);
}

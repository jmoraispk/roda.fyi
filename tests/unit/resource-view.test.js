// tests/unit/resource-view.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { createResourceSection, resourceIcons } from '../../src/app/ui/resource-view.js';

const i18n = createDashboardI18n({ document, storage: { getItem: () => 'en', setItem() {} }, navigator: { languages: ['en'] } });

describe('resource view', () => {
  beforeEach(() => { localStorage.clear(); });

  it('renders icons for present kinds', () => {
    const icons = resourceIcons(document, i18n, ['summary', 'video']);
    expect(icons.textContent).toBe('🎥📄');
    expect(icons.getAttribute('aria-label')).toBe('Video, Summary');
  });

  it('shows resources and adds link, text, and files', async () => {
    const service = {
      addResource: vi.fn().mockResolvedValue({ status: 'saved' }),
      deleteResource: vi.fn().mockResolvedValue({ status: 'deleted' }),
    };
    const onChanged = vi.fn();
    const item = {
      occurrence_id: 'o1', can_add_resources: true,
      resources: [
        { id: 'r1', kind: 'video', title: 'Zoom', url: 'https://youtu.be/x', body: null, can_edit: true },
        { id: 'r2', kind: 'summary', title: null, url: null, body: '# Notes', can_edit: false },
      ],
    };
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged }));
    const link = document.querySelector('a[href="https://youtu.be/x"]');
    expect(link.textContent).toBe('🎥 Zoom');
    expect(link.target).toBe('_blank');
    expect(document.querySelector('.resource-markdown h1').textContent).toBe('Notes');
    expect(document.querySelector('button[aria-label="Delete Summary"]')).toBeNull();

    document.querySelector('button[data-action="open-resources"]').click();
    const form = document.querySelector('form[data-resource-form]');
    form.querySelector('select[name="kind"]').value = 'video';
    form.querySelector('input[name="url"]').value = 'https://youtu.be/y';
    const file = new File(['transcript text'], 'class-2.txt', { type: 'text/plain' });
    Object.defineProperty(form.querySelector('input[type="file"]'), 'files', { value: [file] });
    form.requestSubmit();
    await vi.waitFor(() => expect(service.addResource).toHaveBeenCalledTimes(2));
    expect(service.addResource).toHaveBeenCalledWith({ occurrenceId: 'o1', kind: 'video', title: '', url: 'https://youtu.be/y', body: null, clientKey: expect.any(String) });
    expect(service.addResource).toHaveBeenCalledWith({ occurrenceId: 'o1', kind: 'voice', title: 'class-2.txt', url: null, body: 'transcript text', clientKey: expect.any(String) });
    expect(onChanged).toHaveBeenCalled();

    document.querySelector('button[aria-label="Delete Zoom"]').click();
    await vi.waitFor(() => expect(service.deleteResource).toHaveBeenCalledWith('r1'));
  });

  it('keeps the form and shows the error when saving fails', async () => {
    const service = { addResource: vi.fn().mockRejectedValue(new Error('Paste a link that starts with https://.')) };
    const item = { occurrence_id: 'o1', can_add_resources: true, resources: [] };
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged() {} }));
    document.querySelector('button[data-action="open-resources"]').click();
    const form = document.querySelector('form[data-resource-form]');
    form.querySelector('select[name="kind"]').value = 'video';
    form.querySelector('input[name="url"]').value = 'http://bad';
    form.requestSubmit();
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent).toBe('Paste a link that starts with https://.'));
    expect(form.querySelector('input[name="url"]').value).toBe('http://bad');
    expect(service.addResource).not.toHaveBeenCalled();
    expect(localStorage.getItem('roda.pendingResources:o1')).toBeNull();
  });

  it('keeps unsynced resources in the browser and retries only the ones that failed', async () => {
    localStorage.clear();
    const service = {
      addResource: vi.fn()
        .mockResolvedValueOnce({ status: 'saved' })
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ status: 'saved' }),
    };
    const onChanged = vi.fn();
    const item = { occurrence_id: 'o9', can_add_resources: true, resources: [] };
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged }));
    document.querySelector('button[data-action="open-resources"]').click();
    const form = document.querySelector('form[data-resource-form]');
    form.querySelector('select[name="kind"]').value = 'summary';
    form.querySelector('textarea[name="body"]').value = '# Notes';
    const file = new File(['transcript'], 'voice.txt', { type: 'text/plain' });
    Object.defineProperty(form.querySelector('input[type="file"]'), 'files', { value: [file] });
    form.requestSubmit();
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent).toBe('offline'));

    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged }));
    expect(document.querySelector('[data-pending-resources]').textContent).toBe('1 resource waiting to sync.');
    document.querySelector('button[data-action="retry-resources"]').click();
    await vi.waitFor(() => expect(service.addResource).toHaveBeenCalledTimes(3));
    expect(service.addResource.mock.calls[2][0]).toMatchObject({ kind: 'voice', title: 'voice.txt', body: 'transcript' });
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(localStorage.getItem('roda.pendingResources:o9')).toBeNull();
  });

  it('still saves resources when browser storage is unavailable', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const service = { addResource: vi.fn().mockResolvedValue({ status: 'saved' }) };
      const onChanged = vi.fn();
      const item = { occurrence_id: 'o5', can_add_resources: true, resources: [] };
      document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged }));
      document.querySelector('button[data-action="open-resources"]').click();
      const form = document.querySelector('form[data-resource-form]');
      form.querySelector('select[name="kind"]').value = 'summary';
      form.querySelector('textarea[name="body"]').value = '# Notes';
      form.requestSubmit();
      await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(service.addResource).toHaveBeenCalledWith(expect.objectContaining({ kind: 'summary', body: '# Notes' }));
    } finally {
      setItem.mockRestore();
    }
  });

  it('retries a queued resource with the same key it was queued with', async () => {
    const service = {
      createIdempotencyKey: vi.fn().mockReturnValueOnce('key-a'),
      addResource: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'saved' }),
    };
    const item = { occurrence_id: 'o3', can_add_resources: true, resources: [] };
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged: vi.fn() }));
    document.querySelector('button[data-action="open-resources"]').click();
    const form = document.querySelector('form[data-resource-form]');
    form.querySelector('input[name="url"]').value = 'https://youtu.be/y';
    form.requestSubmit();
    await vi.waitFor(() => expect(form.querySelector('[role="status"]').textContent).toBe('offline'));
    document.body.replaceChildren(createResourceSection({ document, i18n, item, service, onChanged: vi.fn() }));
    document.querySelector('button[data-action="retry-resources"]').click();
    await vi.waitFor(() => expect(service.addResource).toHaveBeenCalledTimes(2));
    expect(service.addResource.mock.calls.map(([input]) => input.clientKey)).toEqual(['key-a', 'key-a']);
  });

  it('gives a resource queued before keys existed one key and keeps it', () => {
    localStorage.setItem('roda.pendingResources:o4', JSON.stringify([{ occurrenceId: 'o4', kind: 'summary', title: '', url: null, body: '# Old' }]));
    const service = { createIdempotencyKey: vi.fn().mockReturnValueOnce('key-old'), addResource: vi.fn() };
    const item = { occurrence_id: 'o4', can_add_resources: true, resources: [] };
    createResourceSection({ document, i18n, item, service, onChanged: vi.fn() });
    createResourceSection({ document, i18n, item, service, onChanged: vi.fn() });
    expect(JSON.parse(localStorage.getItem('roda.pendingResources:o4'))[0].clientKey).toBe('key-old');
    expect(service.createIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});

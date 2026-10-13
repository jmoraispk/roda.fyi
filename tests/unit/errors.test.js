import { afterEach, describe, expect, it } from 'vitest';

import { createDashboardI18n } from '../../src/app/dashboard-i18n.js';
import { AppError, SAFE_CODES, toAppError, useErrorTranslations } from '../../src/app/errors.js';

afterEach(() => useErrorTranslations(null));

describe('toAppError', () => {
  it.each([
    [{ code: 'PT401', message: 'not_authenticated' }, 'authentication', 'not_authenticated'],
    [{ code: 'PT403', message: 'not_authorized' }, 'authorization', 'not_authorized'],
    [{ code: 'P0001', message: 'invitation_expired' }, 'expired', 'invitation_expired'],
    [{ code: 'P0001', message: 'cycle_detected' }, 'validation', 'cycle_detected'],
  ])('maps a stable database error without exposing implementation detail',
    (source, kind, code) => {
      expect(toAppError(source)).toMatchObject({ kind, code });
    });

  it('classifies a fetch failure as a retryable network error', () => {
    expect(toAppError(new TypeError('Failed to fetch'))).toMatchObject({
      kind: 'network',
      code: 'network_failure',
      retryable: true,
    });
  });

  it('does not wrap an existing application error twice', () => {
    const error = new AppError('validation', 'invalid_email', 'Enter a valid email.');
    expect(toAppError(error)).toBe(error);
  });

  it.each(Object.entries({
    cancelled_training: 'This training was canceled.',
    connection_ended: 'This coaching connection has ended.',
    duplicate_completion: 'This training was already completed.',
    edit_conflict: 'This plan changed elsewhere. Reload it before saving again.',
    invalid_attendee: 'One or more attendees are not active group members.',
    published_plan_immutable: 'Published plans cannot be changed.',
  }))('uses safe training copy for %s', (code, message) => {
    expect(toAppError({ code: 'P0001', message: code })).toMatchObject({
      code,
      message,
    });
  });

  it('explains a client key reused on another training', () => {
    expect(toAppError({ code: 'P0001', message: 'idempotency_conflict' }).message)
      .toBe('This item was already saved to another training.');
  });

  it('speaks the chosen language once the app passes its copy', () => {
    const pt = createDashboardI18n({ document: null, storage: { getItem: () => 'pt', setItem() {} }, navigator: { languages: ['pt'] } });
    useErrorTranslations(pt);
    expect(toAppError({ code: 'PT403' }).message).toBe('Não tens permissão para fazer isso.');
    expect(new AppError('network', 'network_failure').message).toBe('O pedido de rede falhou. Tenta novamente.');
    expect(new AppError('validation', 'something_new').message).toBe('Algo correu mal.');
    useErrorTranslations(null);
    expect(toAppError({ code: 'PT403' }).message).toBe('You do not have permission to do that.');
  });
});

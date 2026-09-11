import { describe, expect, it } from 'vitest';

import { AppError, toAppError } from '../../src/app/errors.js';

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
});

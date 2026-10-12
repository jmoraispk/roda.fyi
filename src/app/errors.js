const EXPIRED_CODES = new Set([
  'expired',
  'invitation_expired',
  'otp_expired',
  'request_expired',
  'relationship_expired',
]);

const SAFE_MESSAGES = Object.freeze({
  cancelled_training: 'This training was canceled.',
  connection_ended: 'This coaching connection has ended.',
  duplicate_completion: 'This training was already completed.',
  edit_conflict: 'This plan changed elsewhere. Reload it before saving again.',
  invalid_email: 'Enter a valid email address.',
  invalid_attendee: 'One or more attendees are not active group members.',
  invitation_expired: 'This invitation has expired.',
  missing_code: 'The sign-in response did not include a code.',
  missing_session: 'The sign-in response did not create a session.',
  network_failure: 'The network request failed. Please try again.',
  not_authenticated: 'Please sign in to continue.',
  not_authorized: 'You do not have permission to do that.',
  otp_expired: 'This sign-in link has expired.',
  published_plan_immutable: 'Published plans cannot be changed.',
  request_expired: 'This request has expired.',
  relationship_expired: 'This group invitation has expired.',
});

export class AppError extends Error {
  constructor(kind, code, message = SAFE_MESSAGES[code] ?? 'Something went wrong.', options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.kind = kind;
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

function stableCode(error) {
  if (error?.code === 'PT401') return 'not_authenticated';
  if (error?.code === 'PT403') return 'not_authorized';
  if (error?.code === 'P0001' && /^[a-z][a-z0-9_]*$/.test(error.message ?? '')) {
    return error.message;
  }
  if (/^[a-z][a-z0-9_]*$/.test(error?.code ?? '')) return error.code;
  return 'validation_failed';
}

export function toAppError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof TypeError) {
    return new AppError('network', 'network_failure', undefined, {
      retryable: true,
      cause: error,
    });
  }

  const code = stableCode(error);
  const kind = code === 'not_authenticated'
    ? 'authentication'
    : code === 'not_authorized'
      ? 'authorization'
      : EXPIRED_CODES.has(code) || code.endsWith('_expired')
        ? 'expired'
        : 'validation';

  return new AppError(kind, code, SAFE_MESSAGES[code], { cause: error });
}

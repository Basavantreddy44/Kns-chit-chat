/**
 * A typed error thrown by every auth/registration provider so the UI can show
 * a friendly message without knowing which provider (mock or API) failed.
 *
 * code values:
 *   INVALID_CREDENTIALS | EMAIL_NOT_CONFIRMED | ACCOUNT_LOCKED | RATE_LIMITED | VALIDATION_ERROR |
 *   CONFLICT | NETWORK_ERROR | TIMEOUT | ABORTED | SERVER_ERROR |
 *   CONFIG_ERROR | UNKNOWN
 *
 * fieldErrors: optional { fieldName: message } map, used when the server
 * rejects specific fields (e.g. "username already taken").
 */
export class AuthError extends Error {
  constructor(message, code = 'UNKNOWN', status = null, fieldErrors = null) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

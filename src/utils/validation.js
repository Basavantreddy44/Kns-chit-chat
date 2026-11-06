/**
 * Pure validation helpers — no React, easy to unit test, shared by the
 * Login and Registration forms (and by the mock backend, which re-runs them
 * the way a real server would). Each validator returns an error string or
 * '' when the value is valid.
 *
 * Remember: client-side validation is for user experience only. The backend
 * must validate every field again.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
const USERNAME_ALLOWED_CHARS = /^[a-zA-Z0-9._]+$/;

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const FULL_NAME_MIN_LENGTH = 2;
const FULL_NAME_MAX_LENGTH = 50;
// Unicode letters plus spaces, apostrophes, hyphens and periods (e.g. "Anne-Marie O'Neil Jr.")
const FULL_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

/* ------------------------------------------------------------------ */
/* Normalisers — apply the same clean-up before validating or sending */
/* ------------------------------------------------------------------ */

export const normalizeFullName = (value) => value.trim().replace(/\s+/g, ' ');
export const normalizeEmail = (value) => value.trim().toLowerCase();
export const normalizeUsername = (value) => value.trim().toLowerCase();

export function isEmail(value) {
  return EMAIL_PATTERN.test(value);
}

/* ------------------------------------------------------------------ */
/* Login form                                                          */
/* ------------------------------------------------------------------ */

/** Accepts either an email address or a username. */
export function validateIdentifier(rawValue) {
  const value = rawValue.trim();
  if (!value) return 'Email or username is required.';

  // If the user typed "@", they are trying to enter an email address.
  if (value.includes('@')) {
    return isEmail(value) ? '' : 'Please enter a valid email address (e.g. name@example.com).';
  }

  return value.length >= USERNAME_MIN_LENGTH &&
    value.length <= USERNAME_MAX_LENGTH &&
    USERNAME_ALLOWED_CHARS.test(value)
    ? ''
    : 'Username must be 3–30 characters: letters, numbers, dots or underscores.';
}

/** Login only checks presence + minimum length; strength rules apply at sign-up. */
export function validatePassword(value) {
  if (!value) return 'Password is required.';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return '';
}

const loginValidators = {
  identifier: validateIdentifier,
  password: validatePassword,
};

export function validateField(name, value) {
  const validator = loginValidators[name];
  return validator ? validator(value) : '';
}

/** Validates the whole login form. Returns only the fields that have errors. */
export function validateLoginForm(values) {
  return collectErrors(loginValidators, values);
}

/* ------------------------------------------------------------------ */
/* Registration form                                                   */
/* ------------------------------------------------------------------ */

export function validateFullName(rawValue) {
  const value = normalizeFullName(rawValue);
  if (!value) return 'Full name is required.';
  if (value.length < FULL_NAME_MIN_LENGTH) return 'Please enter your full name.';
  if (value.length > FULL_NAME_MAX_LENGTH) {
    return `Full name must be ${FULL_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (!FULL_NAME_PATTERN.test(value)) {
    return 'Full name can only contain letters, spaces, hyphens, apostrophes and periods.';
  }
  return '';
}

export function validateUsername(rawValue) {
  const value = rawValue.trim();
  if (!value) return 'Username is required.';
  if (/\s/.test(rawValue.trim())) return 'Username cannot contain spaces.';
  if (!USERNAME_ALLOWED_CHARS.test(value)) {
    return 'Use only letters, numbers, periods (.) and underscores (_).';
  }
  if (value.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return `Username must be ${USERNAME_MAX_LENGTH} characters or fewer.`;
  }
  if (value.startsWith('.') || value.endsWith('.')) {
    return 'Username cannot start or end with a period.';
  }
  if (value.includes('..')) return 'Username cannot contain consecutive periods.';
  return '';
}

export function validateEmail(rawValue) {
  const value = normalizeEmail(rawValue);
  if (!value) return 'Email address is required.';
  if (value.length > MAX_EMAIL_LENGTH || !isEmail(value)) {
    return 'Please enter a valid email address (e.g. name@example.com).';
  }
  return '';
}

/**
 * Password strength rules, shown as a live checklist on the sign-up form.
 * Keep these in sync with the backend's password policy.
 */
export const PASSWORD_RULES = [
  { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: (v) => v.length >= MIN_PASSWORD_LENGTH },
  { id: 'uppercase', label: 'One uppercase letter (A–Z)', test: (v) => /[A-Z]/.test(v) },
  { id: 'lowercase', label: 'One lowercase letter (a–z)', test: (v) => /[a-z]/.test(v) },
  { id: 'number', label: 'One number (0–9)', test: (v) => /\d/.test(v) },
  { id: 'special', label: 'One special character', test: (v) => /[^A-Za-z0-9\s]/.test(v) },
];

export function getPasswordRuleResults(password) {
  return PASSWORD_RULES.map((rule) => ({ ...rule, passed: rule.test(password) }));
}

export function validateNewPassword(value) {
  if (!value) return 'Password is required.';
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }
  if (/\s/.test(value)) return 'Password cannot contain spaces.';
  const failedRule = PASSWORD_RULES.find((rule) => !rule.test(value));
  return failedRule ? 'Password does not meet all the requirements below.' : '';
}

export function validateConfirmPassword(value, password) {
  if (!value) return 'Please confirm your password.';
  return value === password ? '' : 'Passwords do not match.';
}

export function validateTermsAccepted(accepted) {
  return accepted ? '' : 'You must accept the Terms of Service and Privacy Policy to continue.';
}

/**
 * Registration validators receive (value, allValues) so cross-field rules
 * such as "confirm password must match" can read other fields.
 */
const registrationValidators = {
  fullName: (value) => validateFullName(value),
  username: (value) => validateUsername(value),
  email: (value) => validateEmail(value),
  password: (value) => validateNewPassword(value),
  confirmPassword: (value, values) => validateConfirmPassword(value, values.password),
  acceptTerms: (value) => validateTermsAccepted(value),
};

/** Field order matters: it decides which invalid field receives focus first. */
export const REGISTRATION_FIELDS = Object.keys(registrationValidators);

export function validateRegistrationField(name, values) {
  const validator = registrationValidators[name];
  return validator ? validator(values[name], values) : '';
}

export function validateRegistrationForm(values) {
  return collectErrors(registrationValidators, values);
}

/* ------------------------------------------------------------------ */

function collectErrors(validators, values) {
  return Object.keys(validators).reduce((errors, field) => {
    const message = validators[field](values[field], values);
    if (message) errors[field] = message;
    return errors;
  }, {});
}

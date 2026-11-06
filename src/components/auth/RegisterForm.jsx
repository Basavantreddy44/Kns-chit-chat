import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AtSign, Lock, Mail, ShieldCheck, User, UserPlus } from 'lucide-react';
import InputField from '../common/InputField';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import Alert from '../common/Alert';
import PasswordStrength from '../common/PasswordStrength';
import AvailabilityIndicator from './AvailabilityIndicator';
import { useAvailabilityCheck } from '../../hooks/useAvailabilityCheck';
import { useSafeTimeout } from '../../hooks/useSafeTimeout';
import {
  checkEmailAvailability,
  checkUsernameAvailability,
  register,
} from '../../services/registrationService';
import {
  REGISTRATION_FIELDS,
  USERNAME_MAX_LENGTH,
  validateEmail,
  validateRegistrationField,
  validateRegistrationForm,
  validateUsername,
} from '../../utils/validation';
import './RegisterForm.css';

const INITIAL_VALUES = {
  fullName: '',
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
};

const STATUS = { IDLE: 'idle', SUBMITTING: 'submitting', SUCCESS: 'success' };
const REDIRECT_DELAY_MS = 1800; // time to read the success message

const USERNAME_TAKEN = 'This username is already taken. Please choose another.';
const EMAIL_TAKEN = 'An account with this email already exists. Try logging in instead.';

export default function RegisterForm() {
  const navigate = useNavigate();
  const scheduleRedirect = useSafeTimeout();

  const [values, setValues] = useState(INITIAL_VALUES);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState(STATUS.IDLE);
  const [serverError, setServerError] = useState('');

  // A ref (not state) so a fast double-click can't slip a second request
  // through before React re-renders with the button disabled.
  const isSubmittingRef = useRef(false);

  const fieldRefs = {
    fullName: useRef(null),
    username: useRef(null),
    email: useRef(null),
    password: useRef(null),
    confirmPassword: useRef(null),
    acceptTerms: useRef(null),
  };

  // Live server checks — only once the value is in a valid format.
  const usernameCheck = useAvailabilityCheck(values.username, {
    enabled: !validateUsername(values.username),
    checkFn: checkUsernameAvailability,
    takenMessage: USERNAME_TAKEN,
  });
  const emailCheck = useAvailabilityCheck(values.email, {
    enabled: !validateEmail(values.email),
    checkFn: checkEmailAvailability,
    takenMessage: EMAIL_TAKEN,
  });

  const isBusy = status !== STATUS.IDLE;

  /** Error shown under a field: format errors first, then "already taken". */
  const getFieldError = (name) => {
    const localError = touched[name] ? errors[name] : '';
    if (localError) return localError;
    if (name === 'username' && usernameCheck.status === 'taken') return usernameCheck.message;
    if (name === 'email' && emailCheck.status === 'taken') return emailCheck.message;
    return '';
  };

  const hasVisibleErrors = REGISTRATION_FIELDS.some((name) => getFieldError(name));
  const isSubmitDisabled = isBusy || hasVisibleErrors;

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    const nextValue = type === 'checkbox' ? checked : value;
    const nextValues = { ...values, [name]: nextValue };

    setValues(nextValues);
    setServerError('');

    setErrors((prev) => {
      const next = { ...prev };
      // Real-time validation after the user has visited the field once.
      // The checkbox validates immediately — it has no "typing" phase.
      if (touched[name] || type === 'checkbox') {
        next[name] = validateRegistrationField(name, nextValues);
      }
      // Changing the password must re-check the confirmation too.
      if (name === 'password' && touched.confirmPassword) {
        next.confirmPassword = validateRegistrationField('confirmPassword', nextValues);
      }
      return next;
    });
    if (type === 'checkbox') setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleBlur = (event) => {
    const { name } = event.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: validateRegistrationField(name, values) }));
  };

  const focusField = (name) => fieldRefs[name]?.current?.focus();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmittingRef.current) return; // prevents duplicate submissions

    const validationErrors = validateRegistrationForm(values);
    setErrors(validationErrors);
    setTouched(Object.fromEntries(REGISTRATION_FIELDS.map((name) => [name, true])));

    const firstInvalid = REGISTRATION_FIELDS.find(
      (name) =>
        validationErrors[name] ||
        (name === 'username' && usernameCheck.status === 'taken') ||
        (name === 'email' && emailCheck.status === 'taken'),
    );
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    isSubmittingRef.current = true;
    setStatus(STATUS.SUBMITTING);
    setServerError('');

    try {
      // The backend is the final authority on validity and uniqueness.
      const { needsEmailConfirmation = false } = await register({
        fullName: values.fullName,
        username: values.username,
        email: values.email,
        password: values.password,
      });

      setStatus(STATUS.SUCCESS);
      scheduleRedirect(() => {
        navigate('/login', {
          replace: true,
          state: {
            registered: true,
            needsEmailConfirmation,
            identifier: values.username.trim().toLowerCase(),
          },
        });
      }, REDIRECT_DELAY_MS);
      // isSubmittingRef stays true: the form is finished.
    } catch (error) {
      isSubmittingRef.current = false;
      setStatus(STATUS.IDLE);

      const fieldErrors = error?.fieldErrors;
      if (fieldErrors) {
        // Duplicates go through the availability state so the icon updates too.
        if (fieldErrors.username && error.code === 'CONFLICT') usernameCheck.markTaken(fieldErrors.username);
        if (fieldErrors.email && error.code === 'CONFLICT') emailCheck.markTaken(fieldErrors.email);
        if (error.code !== 'CONFLICT') setErrors((prev) => ({ ...prev, ...fieldErrors }));

        const firstServerInvalid = REGISTRATION_FIELDS.find((name) => fieldErrors[name]);
        if (firstServerInvalid) focusField(firstServerInvalid);
      }

      setServerError(error?.message || 'We couldn’t create your account. Please try again.');
    }
  };

  const availabilitySuccess = (check, label) =>
    check.status === 'available' ? `${label} is available.` : '';

  // If the availability service is down, say so — submission still works.
  const availabilityHint = (check, fallback) => (check.status === 'error' ? check.message : fallback);

  return (
    <form className="register-form" onSubmit={handleSubmit} noValidate aria-describedby="register-status">
      <div id="register-status" className="register-form__status" aria-live="polite">
        {serverError && (
          <Alert variant="error" title="Sign-up failed" onDismiss={() => setServerError('')}>
            {serverError}
          </Alert>
        )}
        {status === STATUS.SUCCESS && (
          <Alert variant="success" title="Account created!">
            Welcome to KNS Chit-Chat, {values.fullName.trim().split(' ')[0]}. Taking you to the login page…
          </Alert>
        )}
      </div>

      <InputField
        ref={fieldRefs.fullName}
        id="fullName"
        name="fullName"
        label="Full name"
        placeholder="e.g. Priya Sharma"
        icon={User}
        autoComplete="name"
        maxLength={50}
        value={values.fullName}
        onChange={handleChange}
        onBlur={handleBlur}
        error={getFieldError('fullName')}
        disabled={isBusy}
        required
      />

      <InputField
        ref={fieldRefs.username}
        id="username"
        name="username"
        label="Username"
        placeholder="e.g. priya.sharma"
        icon={AtSign}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={USERNAME_MAX_LENGTH}
        value={values.username}
        onChange={handleChange}
        onBlur={handleBlur}
        error={getFieldError('username')}
        success={availabilitySuccess(usernameCheck, `@${values.username.trim().toLowerCase()}`)}
        hint={availabilityHint(usernameCheck, '3–30 characters: letters, numbers, periods and underscores.')}
        trailing={<AvailabilityIndicator status={usernameCheck.status} />}
        disabled={isBusy}
        required
      />

      <InputField
        ref={fieldRefs.email}
        id="email"
        name="email"
        type="email"
        inputMode="email"
        label="Email address"
        placeholder="you@example.com"
        icon={Mail}
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={values.email}
        onChange={handleChange}
        onBlur={handleBlur}
        error={getFieldError('email')}
        success={availabilitySuccess(emailCheck, 'This email')}
        hint={availabilityHint(emailCheck, '')}
        trailing={<AvailabilityIndicator status={emailCheck.status} />}
        disabled={isBusy}
        required
      />

      <InputField
        ref={fieldRefs.password}
        id="password"
        name="password"
        type="password"
        label="Password"
        placeholder="Create a strong password"
        icon={Lock}
        autoComplete="new-password"
        value={values.password}
        onChange={handleChange}
        onBlur={handleBlur}
        error={getFieldError('password')}
        disabled={isBusy}
        required
      >
        <PasswordStrength password={values.password} />
      </InputField>

      <InputField
        ref={fieldRefs.confirmPassword}
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        label="Confirm password"
        placeholder="Re-enter your password"
        icon={ShieldCheck}
        autoComplete="new-password"
        value={values.confirmPassword}
        onChange={handleChange}
        onBlur={handleBlur}
        error={getFieldError('confirmPassword')}
        success={
          values.confirmPassword && values.confirmPassword === values.password && !getFieldError('password')
            ? 'Passwords match.'
            : ''
        }
        disabled={isBusy}
        required
      />

      <Checkbox
        ref={fieldRefs.acceptTerms}
        id="acceptTerms"
        name="acceptTerms"
        checked={values.acceptTerms}
        onChange={handleChange}
        error={getFieldError('acceptTerms')}
        disabled={isBusy}
        label={
          <>
            I agree to KNS Chit-Chat&apos;s{' '}
            <Link to="/terms" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </Link>
            .
          </>
        }
      />

      <Button
        type="submit"
        fullWidth
        isLoading={status === STATUS.SUBMITTING}
        loadingText="Creating your account…"
        disabled={isSubmitDisabled}
        leftIcon={<UserPlus size={19} aria-hidden="true" />}
      >
        {status === STATUS.SUCCESS ? 'Redirecting…' : 'Create Account'}
      </Button>

      <p className="register-form__login">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Lock, LogIn, Mail, User } from 'lucide-react';
import InputField from '../common/InputField';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import Alert from '../common/Alert';
import SocialLoginButtons from './SocialLoginButtons';
import { useAuth } from '../../context/AuthContext';
import { useSafeTimeout } from '../../hooks/useSafeTimeout';
import { validateField, validateLoginForm } from '../../utils/validation';
import './LoginForm.css';

const INITIAL_VALUES = { identifier: '', password: '', rememberMe: false };
const REDIRECT_DELAY_MS = 900; // lets the user see the success message

/** Form lifecycle: idle -> submitting -> success (then redirect) | back to idle on error */
const STATUS = { IDLE: 'idle', SUBMITTING: 'submitting', SUCCESS: 'success' };

export default function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const scheduleRedirect = useSafeTimeout();

  // Arriving from a successful sign-up: greet the user and prefill the username.
  const justRegistered = Boolean(location.state?.registered);
  // Read once: the effect below clears the router state.
  const [needsEmailConfirmation] = useState(Boolean(location.state?.needsEmailConfirmation));

  const [values, setValues] = useState(() => ({
    ...INITIAL_VALUES,
    identifier: justRegistered ? location.state.identifier || '' : '',
  }));
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [status, setStatus] = useState(STATUS.IDLE);
  const [serverError, setServerError] = useState('');
  const [notice, setNotice] = useState('');
  const [registeredNotice, setRegisteredNotice] = useState(justRegistered);

  // Refs let us move keyboard focus to the first invalid field on submit.
  const fieldRefs = { identifier: useRef(null), password: useRef(null) };

  useEffect(() => {
    if (!justRegistered) return;
    fieldRefs.password.current?.focus();
    // Clear the router state so a page refresh doesn't show the banner again.
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBusy = status !== STATUS.IDLE;
  const hasVisibleErrors = Object.values(errors).some(Boolean);
  // Disabled while a request is in flight, or while a field shows an error
  // the user still needs to fix. It stays enabled on a fresh, empty form so
  // pressing it reveals the "required" messages.
  const isSubmitDisabled = isBusy || hasVisibleErrors;

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    const nextValue = type === 'checkbox' ? checked : value;

    setValues((prev) => ({ ...prev, [name]: nextValue }));
    setServerError('');

    // Re-validate live only after the user has left the field once,
    // so we don't shout errors while they are still typing.
    if (touched[name]) {
      setErrors((prev) => ({ ...prev, [name]: validateField(name, nextValue) }));
    }
  };

  const handleBlur = (event) => {
    const { name, value } = event.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: validateField(name, value) }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault(); // Enter key and button click both land here
    if (isBusy) return;

    const validationErrors = validateLoginForm(values);
    setErrors(validationErrors);
    setTouched({ identifier: true, password: true });

    const firstInvalidField = Object.keys(fieldRefs).find((field) => validationErrors[field]);
    if (firstInvalidField) {
      fieldRefs[firstInvalidField].current?.focus();
      return;
    }

    setStatus(STATUS.SUBMITTING);
    setServerError('');
    setNotice('');

    try {
      await login({
        identifier: values.identifier,
        password: values.password,
        rememberMe: values.rememberMe,
      });
      setStatus(STATUS.SUCCESS);

      // Go back to the page the user originally requested, or the dashboard.
      const destination = location.state?.from || '/dashboard';
      scheduleRedirect(() => navigate(destination, { replace: true }), REDIRECT_DELAY_MS);
    } catch (error) {
      setStatus(STATUS.IDLE);
      setServerError(error?.message || 'Login failed. Please try again.');
      // Clear the password after a failed attempt — standard security practice.
      setValues((prev) => ({ ...prev, password: '' }));
      fieldRefs.password.current?.focus();
    }
  };

  const identifierIcon = values.identifier.includes('@') ? Mail : User;

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate aria-describedby="login-status">
      <div id="login-status" className="login-form__status" aria-live="polite">
        {registeredNotice && !serverError && status === STATUS.IDLE && (
          <Alert
            variant="success"
            title={needsEmailConfirmation ? 'Check your email' : 'Your account is ready!'}
            onDismiss={() => setRegisteredNotice(false)}
          >
            {needsEmailConfirmation
              ? 'Click the link we sent to confirm your email, then log in here.'
              : 'Log in with your new password to get started.'}
          </Alert>
        )}
        {serverError && (
          <Alert variant="error" title="Login failed" onDismiss={() => setServerError('')}>
            {serverError}
          </Alert>
        )}
        {status === STATUS.SUCCESS && (
          <Alert variant="success" title="Login successful!">
            Welcome back. Taking you to your dashboard…
          </Alert>
        )}
        {notice && (
          <Alert variant="info" onDismiss={() => setNotice('')}>
            {notice}
          </Alert>
        )}
      </div>

      <InputField
        ref={fieldRefs.identifier}
        id="identifier"
        name="identifier"
        label="Email or username"
        placeholder="you@example.com or username"
        icon={identifierIcon}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={values.identifier}
        onChange={handleChange}
        onBlur={handleBlur}
        error={touched.identifier ? errors.identifier : ''}
        disabled={isBusy}
        required
      />

      <InputField
        ref={fieldRefs.password}
        id="password"
        name="password"
        type="password"
        label="Password"
        placeholder="Enter your password"
        icon={Lock}
        autoComplete="current-password"
        value={values.password}
        onChange={handleChange}
        onBlur={handleBlur}
        error={touched.password ? errors.password : ''}
        disabled={isBusy}
        required
      />

      <div className="login-form__row">
        <Checkbox
          id="rememberMe"
          name="rememberMe"
          label="Remember me"
          checked={values.rememberMe}
          onChange={handleChange}
          disabled={isBusy}
        />
        <Link to="/forgot-password" className="login-form__forgot">
          Forgot password?
        </Link>
      </div>

      <Button
        type="submit"
        fullWidth
        isLoading={status === STATUS.SUBMITTING}
        loadingText="Logging in…"
        disabled={isSubmitDisabled}
        leftIcon={<LogIn size={19} aria-hidden="true" />}
      >
        {status === STATUS.SUCCESS ? 'Redirecting…' : 'Log in'}
      </Button>

      <SocialLoginButtons disabled={isBusy} onUnavailable={setNotice} />

      <p className="login-form__signup">
        Don&apos;t have an account? <Link to="/signup">Sign up</Link>
      </p>
    </form>
  );
}

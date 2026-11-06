import { forwardRef, useId, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import './InputField.css';

/**
 * Reusable text input with label, leading icon, inline messages and
 * (for type="password") a built-in show/hide toggle.
 *
 * Props beyond normal <input> props:
 *   label, icon      – label text and a Lucide icon component
 *   error            – red message; marks the input aria-invalid
 *   success          – green message (e.g. "Username is available")
 *   hint             – neutral helper text, hidden while an error shows
 *   trailing         – element shown inside the right edge (status icons)
 *   children         – extra content rendered under the input (e.g. a
 *                      password strength meter), linked via describedBy
 *
 * Accessibility: the label is linked to the input, messages are announced via
 * aria-describedby, and the password toggle is a real <button>.
 */
const InputField = forwardRef(function InputField(
  { label, icon: Icon, error, success, hint, trailing, type = 'text', id, children, ...inputProps },
  ref,
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const successId = `${inputId}-success`;
  const hintId = `${inputId}-hint`;
  const extraId = `${inputId}-extra`;

  const isPassword = type === 'password';
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const resolvedType = isPassword && isPasswordVisible ? 'text' : type;

  const showSuccess = Boolean(success) && !error;
  const showHint = Boolean(hint) && !error && !showSuccess;

  const describedBy = [
    error ? errorId : null,
    showSuccess ? successId : null,
    showHint ? hintId : null,
    children ? extraId : null,
  ]
    .filter(Boolean)
    .join(' ');

  const stateClass = error ? 'field--error' : showSuccess ? 'field--success' : '';
  const hasRightSlot = isPassword || Boolean(trailing);

  return (
    <div className={`field ${stateClass}`}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>

      <div className="field__control">
        {Icon && <Icon className="field__icon" size={19} aria-hidden="true" />}

        <input
          ref={ref}
          id={inputId}
          type={resolvedType}
          className={`field__input ${Icon ? 'field__input--with-icon' : ''} ${
            hasRightSlot ? 'field__input--with-toggle' : ''
          }`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          {...inputProps}
        />

        {isPassword ? (
          <button
            type="button"
            className="field__toggle"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
            aria-pressed={isPasswordVisible}
            aria-controls={inputId}
          >
            {isPasswordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        ) : (
          trailing && <span className="field__trailing">{trailing}</span>
        )}
      </div>

      {showHint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}

      {showSuccess && (
        <p id={successId} className="field__success" role="status">
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>{success}</span>
        </p>
      )}

      {error && (
        <p id={errorId} className="field__error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {children && <div id={extraId}>{children}</div>}
    </div>
  );
});

export default InputField;

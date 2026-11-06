import { forwardRef } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import './Checkbox.css';

/**
 * Styled checkbox that keeps a real <input type="checkbox"> underneath,
 * so it works with Space, screen readers and form semantics.
 * `label` may be plain text or JSX (e.g. text containing links).
 */
const Checkbox = forwardRef(function Checkbox({ id, label, checked, onChange, error, ...props }, ref) {
  const errorId = `${id}-error`;

  return (
    <div className={`checkbox-field ${error ? 'checkbox-field--error' : ''}`}>
      <label className="checkbox" htmlFor={id}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="checkbox__input"
          checked={checked}
          onChange={onChange}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          {...props}
        />
        <span className="checkbox__box" aria-hidden="true">
          <Check size={14} strokeWidth={3} />
        </span>
        <span className="checkbox__label">{label}</span>
      </label>

      {error && (
        <p id={errorId} className="checkbox-field__error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
});

export default Checkbox;

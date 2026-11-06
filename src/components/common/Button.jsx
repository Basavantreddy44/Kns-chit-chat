import { Loader2 } from 'lucide-react';
import './Button.css';

/**
 * Reusable button.
 *  variant:   'primary' | 'outline' | 'ghost'
 *  isLoading: shows a spinner, disables the button and sets aria-busy.
 */
export default function Button({
  children,
  variant = 'primary',
  type = 'button',
  isLoading = false,
  loadingText = 'Please wait…',
  fullWidth = false,
  leftIcon,
  disabled,
  className = '',
  ...buttonProps
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    fullWidth ? 'btn--full' : '',
    isLoading ? 'btn--loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...buttonProps}
    >
      {isLoading ? (
        <>
          <Loader2 className="btn__spinner" size={19} aria-hidden="true" />
          <span>{loadingText}</span>
        </>
      ) : (
        <>
          {leftIcon && <span className="btn__icon">{leftIcon}</span>}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}

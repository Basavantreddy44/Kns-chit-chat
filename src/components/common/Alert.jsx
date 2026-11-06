import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import './Alert.css';

const ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

/**
 * Inline status banner. Errors use role="alert" (announced immediately);
 * other variants use role="status" (announced politely).
 */
export default function Alert({ variant = 'info', title, children, onDismiss }) {
  const Icon = ICONS[variant] || Info;

  return (
    <div className={`alert alert--${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <Icon className="alert__icon" size={20} aria-hidden="true" />
      <div className="alert__content">
        {title && <p className="alert__title">{title}</p>}
        {children && <p className="alert__message">{children}</p>}
      </div>
      {onDismiss && (
        <button type="button" className="alert__close" onClick={onDismiss} aria-label="Dismiss message">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

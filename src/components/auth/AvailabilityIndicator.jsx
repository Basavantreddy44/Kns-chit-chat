import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

/**
 * Small status icon shown inside the username/email inputs while their
 * availability is being checked. Text feedback is rendered by InputField.
 */
export default function AvailabilityIndicator({ status }) {
  if (status === 'checking') {
    return (
      <span className="availability availability--checking" role="status">
        <Loader2 size={18} aria-hidden="true" />
        <span className="sr-only">Checking availability…</span>
      </span>
    );
  }
  if (status === 'available') {
    return <CheckCircle2 className="availability availability--ok" size={18} aria-hidden="true" />;
  }
  if (status === 'taken') {
    return <XCircle className="availability availability--taken" size={18} aria-hidden="true" />;
  }
  return null;
}

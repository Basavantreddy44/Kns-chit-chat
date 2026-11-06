import { Check, Circle } from 'lucide-react';
import { getPasswordRuleResults } from '../../utils/validation';
import './PasswordStrength.css';

const STRENGTH_LEVELS = [
  { label: 'Too weak', tone: 'weak' },
  { label: 'Weak', tone: 'weak' },
  { label: 'Weak', tone: 'weak' },
  { label: 'Fair', tone: 'fair' },
  { label: 'Almost there', tone: 'good' },
  { label: 'Strong', tone: 'strong' },
];

/**
 * Live password requirement checklist + strength meter.
 * Always visible on the sign-up form so the rules are clear up front.
 */
export default function PasswordStrength({ password }) {
  const rules = getPasswordRuleResults(password);
  const passedCount = rules.filter((rule) => rule.passed).length;
  const level = STRENGTH_LEVELS[passedCount];
  const hasInput = password.length > 0;

  return (
    <div className="pw-strength">
      <div className="pw-strength__meter-row">
        <div
          className={`pw-strength__meter pw-strength__meter--${hasInput ? level.tone : 'empty'}`}
          role="meter"
          aria-label="Password strength"
          aria-valuemin={0}
          aria-valuemax={rules.length}
          aria-valuenow={passedCount}
          aria-valuetext={hasInput ? level.label : 'No password entered'}
        >
          {rules.map((rule, index) => (
            <span key={rule.id} className={index < passedCount ? 'is-filled' : ''} />
          ))}
        </div>
        <span className={`pw-strength__label pw-strength__label--${hasInput ? level.tone : 'empty'}`}>
          {hasInput ? level.label : 'Password strength'}
        </span>
      </div>

      <ul className="pw-strength__rules" aria-label="Password requirements">
        {rules.map((rule) => (
          <li key={rule.id} className={rule.passed ? 'is-passed' : ''}>
            {rule.passed ? (
              <Check size={14} strokeWidth={3} aria-hidden="true" />
            ) : (
              <Circle size={14} aria-hidden="true" />
            )}
            <span>
              {rule.label}
              <span className="sr-only">{rule.passed ? ' — met' : ' — not met'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

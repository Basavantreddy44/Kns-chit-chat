import { FlaskConical } from 'lucide-react';
import BrandLogo from './BrandLogo';
import HeroPanel from './HeroPanel';
import { useAuth } from '../../context/AuthContext';
import './AuthLayout.css';

/**
 * Shared shell for every auth screen (Login, Create Account, and later
 * Forgot Password): logo, heading, subtitle, the form, an optional footer,
 * and the illustrated hero panel. Keeping it in one place guarantees the
 * pages stay visually identical.
 */
export default function AuthLayout({ title, subtitle, children, footer, hero }) {
  const { authMode } = useAuth();
  const headingId = 'auth-heading';

  return (
    <div className="auth-page">
      <main className="auth-page__main">
        <section className="auth-card" aria-labelledby={headingId}>
          <header className="auth-card__header">
            <BrandLogo />
            {authMode === 'mock' && (
              <span className="auth-card__badge" title="Using the development mock authentication service">
                <FlaskConical size={13} aria-hidden="true" /> Dev mock auth
              </span>
            )}
          </header>

          <div className="auth-card__intro">
            <h1 id={headingId} className="auth-card__title">
              {title}
            </h1>
            {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}
          </div>

          {children}

          {footer && <footer className="auth-card__legal">{footer}</footer>}
        </section>
      </main>

      <HeroPanel {...hero} />
    </div>
  );
}

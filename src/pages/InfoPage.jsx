import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import BrandLogo from '../components/auth/BrandLogo';
import './InfoPage.css';

/**
 * Simple reusable page for routes that will be built out later
 * (Sign up, Forgot password, Terms, Privacy). Keeps every link working.
 */
export default function InfoPage({ title, message }) {
  return (
    <div className="info-page">
      <div className="info-page__card">
        <BrandLogo size={36} />
        <h1>{title}</h1>
        <p>{message}</p>
        <Link to="/login" className="info-page__back">
          <ArrowLeft size={16} aria-hidden="true" /> Back to login
        </Link>
      </div>
    </div>
  );
}

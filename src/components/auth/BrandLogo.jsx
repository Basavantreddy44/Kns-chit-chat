import { APP_NAME } from '../../config/brand';
import './BrandLogo.css';

/**
 * KNS Chit-Chat logo: a speech bubble carrying the KNS "K", with a teal
 * "online" dot. `variant="light"` is for dark backgrounds; `showName={false}`
 * renders the mark alone. The shapes match public/favicon.svg.
 */
export default function BrandLogo({ variant = 'dark', size = 36, showName = true }) {
  return (
    <div className={`brand brand--${variant}`}>
      <svg
        className="brand__mark"
        width={size}
        height={size}
        viewBox="0 0 48 48"
        role="img"
        aria-label={`${APP_NAME} logo`}
      >
        <rect width="48" height="48" rx="12" fill="#17365D" />
        <path
          d="M13 10h20a6 6 0 0 1 6 6v13a6 6 0 0 1-6 6H21l-7.4 5.9a1 1 0 0 1-1.6-.8V35a5 5 0 0 1-5-5V16a6 6 0 0 1 6-6z"
          fill="#fff"
        />
        <path
          d="M18 15.5v14M28 15.5l-10 7 10 7"
          fill="none"
          stroke="#17365D"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="38" cy="11" r="5.5" fill="#14B8A6" stroke="#17365D" strokeWidth="2" />
      </svg>
      {showName && (
        <span className="brand__name">
          <strong>KNS</strong> Chit-Chat
        </span>
      )}
    </div>
  );
}

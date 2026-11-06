import { Hash } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { APP_TAGLINE } from '../../config/brand';
import './HeroPanel.css';

const DEFAULT_TEXT = 'One place for KNS teams to talk, share updates and get work done.';

/**
 * Right-hand brand panel with an illustrated chat preview. The names and
 * messages are sample artwork, so the preview is hidden from screen readers.
 * `title` and `text` let each auth page tailor the message.
 */
export default function HeroPanel({ title = APP_TAGLINE, text = DEFAULT_TEXT }) {
  return (
    <aside className="hero">
      <div className="hero__content">
        <BrandLogo variant="light" size={40} />

        <div className="hero__copy">
          <h2 className="hero__title">{title}</h2>
          <p className="hero__text">{text}</p>
        </div>

        <div className="hero-chat" aria-hidden="true">
          <div className="hero-chat__header">
            <Hash size={15} /> project-updates
          </div>
          <div className="hero-chat__body">
            <div className="hero-msg">
              <span className="hero-msg__avatar">PS</span>
              <div>
                <p className="hero-msg__name">Priya</p>
                <p className="hero-msg__bubble">The design review has moved to 3 PM.</p>
              </div>
            </div>
            <div className="hero-msg hero-msg--own">
              <p className="hero-msg__bubble">Thanks, I&apos;ll be there.</p>
            </div>
            <div className="hero-msg">
              <span className="hero-msg__avatar hero-msg__avatar--alt">AR</span>
              <p className="hero-msg__bubble hero-msg__typing">
                <i />
                <i />
                <i />
              </p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

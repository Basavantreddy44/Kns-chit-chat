import Button from '../common/Button';
import { GoogleIcon, FacebookIcon } from './SocialIcons';
import { SOCIAL_PROVIDERS } from '../../services/authService';
import './SocialLoginButtons.css';

const PROVIDER_ICONS = {
  google: <GoogleIcon />,
  facebook: <FacebookIcon />,
};

/**
 * "Continue with Google / Facebook" buttons.
 * UI only for now: clicking reports back via `onUnavailable` so the parent
 * can show a friendly notice. Wire real OAuth in authService later.
 */
export default function SocialLoginButtons({ disabled, onUnavailable }) {
  // Nothing to offer until a provider is enabled in authService.
  if (!Object.values(SOCIAL_PROVIDERS).some((provider) => provider.enabled)) return null;

  const handleClick = (providerKey) => {
    const provider = SOCIAL_PROVIDERS[providerKey];
    if (!provider.enabled) {
      onUnavailable?.(`${provider.label} sign-in is coming soon. Please use your email or username for now.`);
    }
  };

  return (
    <div className="social">
      <div className="social__divider" role="separator">
        <span>or continue with</span>
      </div>

      <div className="social__buttons">
        {Object.entries(SOCIAL_PROVIDERS).map(([key, provider]) => (
          <Button
            key={key}
            variant="outline"
            fullWidth
            leftIcon={PROVIDER_ICONS[key]}
            onClick={() => handleClick(key)}
            disabled={disabled}
            aria-label={`Log in with ${provider.label}`}
          >
            {provider.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

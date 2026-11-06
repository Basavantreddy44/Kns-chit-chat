import { Moon, Sun } from 'lucide-react';
import Button from '../../components/common/Button';
import { PageHeader } from '../../components/workspace/PageParts';
import { useTheme } from '../../hooks/useTheme';

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="page">
      <PageHeader title="Settings" />
      <section className="card">
        <div className="profile-head" style={{ marginBottom: 0 }}>
          <div className="profile-head__body">
            <h2 className="profile-head__name">Appearance</h2>
            <p className="row__meta">You are using the {isDark ? 'dark' : 'light'} theme on this device.</p>
          </div>
          <Button
            variant="outline"
            onClick={toggleTheme}
            leftIcon={isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          >
            {isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          </Button>
        </div>
      </section>
    </div>
  );
}

import { Link } from 'react-router-dom';
import AuthLayout from '../components/auth/AuthLayout';
import LoginForm from '../components/auth/LoginForm';
import { APP_NAME, APP_TAGLINE } from '../config/brand';

/**
 * Login screen. Layout comes from <AuthLayout />; all form behaviour lives
 * in <LoginForm />.
 */
export default function LoginPage() {
  return (
    <AuthLayout
      title="Welcome back"
      subtitle={APP_TAGLINE}
      footer={
        <>
          By continuing, you agree to {APP_NAME}&apos;s <Link to="/terms">Terms of Service</Link> and{' '}
          <Link to="/privacy">Privacy Policy</Link>.
        </>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}

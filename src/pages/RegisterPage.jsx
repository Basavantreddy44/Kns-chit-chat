import AuthLayout from '../components/auth/AuthLayout';
import RegisterForm from '../components/auth/RegisterForm';

const REGISTER_HERO = {
  title: 'Your team is one message away.',
  text: 'Create your account to start connecting with colleagues across KNS.',
};

/** Create Account screen — same shell and design system as the Login page. */
export default function RegisterPage() {
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join your KNS colleagues on KNS Chit-Chat."
      hero={REGISTER_HERO}
    >
      <RegisterForm />
    </AuthLayout>
  );
}

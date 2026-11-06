import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Only logged-in users may see these routes; others are sent to /login. */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Remember where the user wanted to go so we can send them back after login.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/**
 * Login / Sign-up pages are for guests. A user who is ALREADY logged in when
 * they open one is sent to the dashboard.
 *
 * We decide this once, on entry. If the user logs in on this page, the form
 * itself shows "Login successful!" and then redirects — redirecting here
 * instantly would hide that feedback.
 */
export function PublicOnlyRoute() {
  const { isAuthenticated } = useAuth();
  const [wasAuthenticatedOnEntry] = useState(isAuthenticated);
  return wasAuthenticatedOnEntry ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

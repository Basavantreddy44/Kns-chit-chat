# KNS Chit-Chat — Internal Company Messaging

A production-style authentication flow for the KNS Chit-Chat app: **Login**,
**Create Account**, and a protected **Dashboard**. Built with **React 18 + Vite**,
**React Router 6**, **Lucide React** icons and plain **CSS3**.

## Quick start

Requires **Node.js 18+** (check with `node -v`).

```bash
cd orbit-social
npm install
npm run dev
```

Open http://localhost:5173 — you'll land on `/login`.

### Development mode (mock backend)

By default the app runs against a clearly labelled **mock backend** (you'll
see a "Dev mock auth" badge). It keeps a small user database in your
browser's localStorage (`orbit.mock.users`), so you can create an account and
then log in with it.

Pre-seeded demo account (from `.env.development`, change freely):

| Field             | Value                           |
| ----------------- | ------------------------------- |
| Email or username | `demo@kns.dev` or `demo_user` |
| Password          | `Kns@2026`                      |

Taken in the mock, to test availability messages: usernames `demo_user`,
`admin`, `support`, `orbit` (and other reserved names); email `demo@kns.dev`.

To reset the mock database: DevTools → Application → Local Storage →
delete `orbit.mock.users`.

Restart `npm run dev` after editing any `.env*` file.

## Testing the flow manually

1. **Login → Create Account:** click **Sign up** on the login page.
2. **Validation:** press **Create Account** on the empty form — every field
   shows a "required" message and focus jumps to Full name.
3. **Username:** type `has space` (rejected), `ab` (too short), `demo_user`
   (taken), then something new — a spinner, then "@name is available".
4. **Email:** `not-an-email` (invalid format), `demo@kns.dev` (already
   registered), then a new address.
5. **Password:** watch the checklist and meter update as you type; use the
   eye button to show/hide. Mistype the confirmation to see "Passwords do not
   match".
6. **Terms:** the account can't be created until the box is ticked (Space
   toggles it from the keyboard).
7. **Submit:** a loading state appears, then "Account created!", then you're
   redirected to Login with your username prefilled and a success banner.
8. **Log in** with the new password → Dashboard.
9. **Create Account → Login:** "Already have an account? Log in".

## Production build

```bash
npm run build     # outputs to dist/
npm run preview   # serves the production build locally
```

## Connecting a real backend

1. Create `.env.production` (or edit `.env.development`):
   ```
   VITE_AUTH_MODE=api
   VITE_API_BASE_URL=https://your-api.example.com/api
   ```
2. Implement the endpoints in **`docs/BACKEND_API.md`** (register, availability
   checks, login), including server-side validation, unique indexes and
   bcrypt/Argon2 password hashing. A reference Express implementation is
   included there.
3. No UI code changes are needed — the services choose the provider.

## Connecting Supabase

Follow **`docs/SUPABASE_SETUP.md`**, then set `VITE_AUTH_MODE=supabase`. The
database schema is in `supabase/migrations/` and the username login function is
in `supabase/functions/`.

## Folder structure

```
orbit-social/
├── index.html
├── package.json
├── vite.config.js
├── .env.example                 # documented config template
├── .env.development             # dev-only mock settings + demo account
├── docs/BACKEND_API.md          # API contract + security rules + Express example
├── public/favicon.svg
└── src/
    ├── main.jsx                 # React entry, global CSS
    ├── App.jsx                  # Router + AuthProvider
    ├── routes/
    │   ├── AppRoutes.jsx        # route table (/login, /signup, /dashboard …)
    │   └── RouteGuards.jsx      # ProtectedRoute / PublicOnlyRoute
    ├── context/AuthContext.jsx  # useAuth() hook
    ├── hooks/
    │   ├── useAvailabilityCheck.js   # debounced, cancellable username/email checks
    │   └── useSafeTimeout.js         # redirect timers cleared on unmount
    ├── services/
    │   ├── authService.js            # login/logout entry point for the UI
    │   ├── registrationService.js    # sign-up entry point for the UI
    │   ├── apiAuthService.js         # real backend: login
    │   ├── apiRegistrationService.js # real backend: register + availability
    │   ├── httpClient.js             # fetch wrapper (timeout, abort, JSON)
    │   ├── mockAuthService.js        # DEV ONLY mock login
    │   ├── mockRegistrationService.js# DEV ONLY mock register + availability
    │   ├── mockUserStore.js          # DEV ONLY users "table" (hashed passwords)
    │   ├── sessionStorage.js         # remember-me persistence
    │   └── AuthError.js              # typed errors (+ fieldErrors)
    ├── utils/validation.js      # pure validators shared by both forms
    ├── components/
    │   ├── common/   InputField, Button, Checkbox, Alert, PasswordStrength (+ CSS)
    │   └── auth/     AuthLayout, LoginForm, RegisterForm, AvailabilityIndicator,
    │                 SocialLoginButtons, SocialIcons, HeroPanel, BrandLogo (+ CSS)
    ├── pages/        LoginPage, RegisterPage, DashboardPage, InfoPage, NotFoundPage
    └── styles/       variables.css (design tokens), global.css
```

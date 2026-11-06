# Connecting KNS Chit-Chat to Supabase

KNS Chit-Chat stores accounts in Supabase Auth and profiles in a `public.profiles`
table. The UI is unchanged: `VITE_AUTH_MODE=supabase` selects the provider.

## 1. Create the project

Create a project at https://supabase.com/dashboard. From **Project Settings →
API Keys**, copy the **publishable key** (`sb_publishable_...`), and copy the
project URL (`https://<ref>.supabase.co`).

## 2. Create the database objects

In **SQL Editor**, paste and run all of
`supabase/migrations/20261104000000_auth_profiles.sql`.

## 3. Deploy the username login function

Supabase signs in by email only, so this function handles username logins.

```bash
npx supabase login
npx supabase functions deploy login-with-username --no-verify-jwt --project-ref <ref>
```

Without it, email login still works and username login shows a message asking
the user to log in with their email.

## 4. Configure Auth in the dashboard

- **Authentication → URL Configuration:** set **Site URL** to your app's URL and
  add `http://localhost:5173/**` to **Redirect URLs**. Otherwise confirmation
  links go to the wrong address.
- **Authentication → Providers → Email → Password requirements:** set the minimum
  length to 8 and require lowercase, uppercase, digits and symbols. This is the
  only server-side enforcement of the sign-up password rules.
- **Confirm email:** on by default, and the app handles it either way. Supabase's
  built-in email sender has a very low hourly limit, so set up custom SMTP before
  launch. You can turn confirmation off while developing.

## 5. Point the app at Supabase

Create `.env.development.local` in the project root:

```
VITE_AUTH_MODE=supabase
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Use that exact filename. Vite loads `.env.development` after `.env.local`, so
`VITE_AUTH_MODE` in `.env.local` would be overridden by the `mock` value.
Restart `npm run dev` after saving. For production, set the same values in
`.env.production` or your host's environment settings.

The "Dev mock auth" badge disappears once Supabase mode is active.

## Good to know

- **Creating users from the dashboard fails** unless they have `username` and
  `full_name` in their user metadata, because the sign-up trigger requires them.
  Google or Facebook login will need the trigger extended to generate a username.
- **The availability checks can be scripted.** `is_email_available` is callable
  by anyone and reveals whether an email is registered, which is the trade-off
  behind the form's live email check. The checks have no per-IP rate limit. Remove
  the email check, or move it behind an Edge Function with rate limiting, if this
  matters for your launch.
- **Username logins share a rate limit.** They reach Supabase Auth from the Edge
  Function rather than the user's browser, so Auth's per-IP sign-in limit can apply
  across users. Email logins aren't affected. Watch for this as traffic grows.
- **Keep the rules in sync.** Username rules exist in both
  `src/utils/validation.js` and the migration.

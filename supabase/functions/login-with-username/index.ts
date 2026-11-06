// Signs a user in by username. Supabase Auth only accepts an email, so this
// looks up the email on the server and returns tokens only if the password is
// correct. The email is never returned to the caller.
//
// Deploy with JWT verification off (see supabase/config.toml): callers are not
// logged in yet, and publishable keys are not JWTs.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    // Successful responses carry tokens, which must never be cached.
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Mirrors the profiles_username_format constraint in the migration.
function isValidUsername(username: unknown): username is string {
  return (
    typeof username === 'string' &&
    /^[a-zA-Z0-9._]{3,30}$/.test(username) &&
    !/^\.|\.$|\.\./.test(username)
  );
}

const MAX_PASSWORD_LENGTH = 1024;

function isValidPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length > 0 && password.length <= MAX_PASSWORD_LENGTH;
}

/** New keys arrive as a JSON map of key name to value. The legacy variable is a fallback. */
function readKey(keysVariable: string, legacyVariable: string) {
  const keys = Deno.env.get(keysVariable);
  if (keys) {
    const key = JSON.parse(keys).default;
    if (key) return key as string;
  }
  return Deno.env.get(legacyVariable) ?? '';
}

function serverClient(key: string) {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const invalidCredentials = () => json(401, { code: 'invalid_credentials' });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { code: 'method_not_allowed' });

  try {
    const { username, password } = await req.json().catch(() => ({}));
    // Malformed input gets the same answer as a wrong password.
    if (!isValidUsername(username) || !isValidPassword(password)) return invalidCredentials();

    const admin = serverClient(readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'));
    const { data: email, error: lookupError } = await admin.rpc('get_email_for_username', {
      p_username: username,
    });
    if (lookupError) throw lookupError;

    // An unknown username gets the same answer as a wrong password.
    if (!email) return invalidCredentials();

    const publicClient = serverClient(readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'));
    const { data, error } = await publicClient.auth.signInWithPassword({ email, password });

    if (error) {
      if (error.code === 'invalid_credentials') return invalidCredentials();
      if (error.code === 'email_not_confirmed') return json(403, { code: error.code });
      if (error.code === 'user_banned') return json(403, { code: error.code });
      if (error.status === 429) return json(429, { code: 'over_request_rate_limit' });
      throw error;
    }

    return json(200, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (error) {
    console.error('login-with-username failed', error instanceof Error ? error.message : 'unknown');
    return json(500, { code: 'server_error' });
  }
});

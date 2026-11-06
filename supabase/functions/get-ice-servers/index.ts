// Gives a browser in a live call short-lived Cloudflare TURN credentials, so calls
// can connect on networks that block direct connections. The long-term key stays
// here on the server. Set it with:
//
//   npx supabase secrets set CLOUDFLARE_TURN_KEY_ID=... CLOUDFLARE_TURN_API_TOKEN=...
//
// Deploy with JWT verification off (see supabase/config.toml), because publishable
// keys aren't JWTs. Access is checked below: the caller must be in a live call.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CREDENTIAL_SECONDS = 4 * 60 * 60;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function publishableKey() {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    const key = JSON.parse(keys).default;
    if (key) return key as string;
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { code: 'method_not_allowed' });

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json(401, { code: 'not_authenticated' });

  try {
    // Runs as the caller, so this only finds a call they are really part of.
    const asCaller = createClient(Deno.env.get('SUPABASE_URL') ?? '', publishableKey(), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: calls, error } = await asCaller.rpc('get_my_active_call');
    if (error) return json(401, { code: 'not_authenticated' });
    if (!calls?.length) return json(403, { code: 'no_active_call' });

    const keyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID');
    const token = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN');
    if (!keyId || !token) return json(503, { code: 'turn_not_configured' });

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: CREDENTIAL_SECONDS }),
      },
    );
    if (!response.ok) {
      console.error('get-ice-servers: Cloudflare responded', response.status);
      return json(502, { code: 'turn_unavailable' });
    }

    const { iceServers } = await response.json();
    return json(200, { iceServers: Array.isArray(iceServers) ? iceServers : [iceServers] });
  } catch (error) {
    console.error('get-ice-servers failed', error instanceof Error ? error.message : 'unknown');
    return json(500, { code: 'server_error' });
  }
});

// functions/api/public-config.js
// Returns public Supabase config for the frontend (URL + ANON key only)

export async function onRequestGet({ env }) {
  const supabaseUrl = (env.SUPABASE_URL || '').trim();
  const supabaseAnonKey = (env.SUPABASE_ANON_KEY || '').trim();

  const ok = Boolean(supabaseUrl && supabaseAnonKey);

  return new Response(JSON.stringify({
    ok,
    supabaseUrl: ok ? supabaseUrl : '',
    supabaseAnonKey: ok ? supabaseAnonKey : ''
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}


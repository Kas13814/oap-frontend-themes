// Cloudflare Pages Function
// POST /api/auth-set-password
// Body: { email: string, password: string }
//
// Env vars required (Cloudflare Pages):
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
//
// Patch: After successful Auth password update, mark the latest active reset code
// in public.oap_set_password_codes as used (used_at = now()) to prevent stale active codes.

export async function onRequestPost({ request, env }) {
  try {
    const SUPABASE_URL = env.SUPABASE_URL;
    const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "missing_server_config" }, 500);
    }

    const { email, password } = await request.json().catch(() => ({}));
    const cleanEmail = (email || "").toString().trim().toLowerCase();
    const newPassword = (password || "").toString();

    if (!cleanEmail || !cleanEmail.includes("@")) {
      return json({ ok: false, error: "email_required" }, 400);
    }
    if (!newPassword || newPassword.trim().length < 8) {
      return json({ ok: false, error: "password_too_short" }, 400);
    }

    const base = SUPABASE_URL.replace(/\/$/, "");

    // 1) Get auth_user_id from your public.users table (server-side, using Service Role)
    const usersUrl =
      `${base}` +
      `/rest/v1/users?select=auth_user_id&email=eq.${encodeURIComponent(cleanEmail)}&limit=1`;

    const uRes = await fetch(usersUrl, {
      method: "GET",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });

    if (!uRes.ok) {
      const t = await uRes.text();
      return json({ ok: false, error: "users_lookup_failed", details: t }, 500);
    }

    const rows = await uRes.json().catch(() => []);
    const authUserId = Array.isArray(rows) && rows[0]?.auth_user_id ? rows[0].auth_user_id : null;

    if (!authUserId) {
      // Do not leak whether email exists
      return json({ ok: false, error: "invalid_request" }, 400);
    }

    // 2) Update Supabase Auth password
    const updUrl = `${base}` + `/auth/v1/admin/users/${authUserId}`;

    const updRes = await fetch(updUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ password: newPassword }),
    });

    if (!updRes.ok) {
      const t = await updRes.text();
      return json({ ok: false, error: "auth_update_failed", details: t }, 500);
    }

    // 3) Mark any active reset code for this email as used (prevents 409 on next request)
    //    We only close codes that are still active (used_at is null) and not expired.
    const nowIso = new Date().toISOString();

    const markUrl =
      `${base}` +
      `/rest/v1/oap_set_password_codes` +
      `?email=eq.${encodeURIComponent(cleanEmail)}` +
      `&used_at=is.null` +
      `&expires_at=gt.${encodeURIComponent(nowIso)}`;

    const markRes = await fetch(markUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ used_at: nowIso }),
    });

    if (!markRes.ok) {
      const t = await markRes.text();
      return json({ ok: false, error: "code_mark_failed", details: t }, 500);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

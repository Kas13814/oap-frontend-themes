// Cloudflare Pages Function
// Path: /functions/api/admin-create-auth-user.js
// Ensures a Supabase Auth user exists for an email and returns auth_user_id.
// Admin/Owner only.
//
// Env vars (Cloudflare Pages):
// - SUPABASE_URL (plaintext)
// - SUPABASE_ANON_KEY (plaintext)
// - SUPABASE_SERVICE_ROLE_KEY (secret)

export async function onRequestPost({ request, env }) {
  try {
    const SUPABASE_URL = env.SUPABASE_URL;
    const ANON_KEY = env.SUPABASE_ANON_KEY;
    const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ ok: false, error: "missing_token" }, 401);

    const body = await request.json().catch(() => null);
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return json({ ok: false, error: "bad_email" }, 400);

    // 1) Validate caller JWT (Supabase verifies)
    const meRes = await fetch(`${SUPABASE_URL.replace(/\/$/,"")}/auth/v1/user`, {
      method: "GET",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
    });
    const me = await meRes.json().catch(() => null);
    if (!meRes.ok || !me?.id) return json({ ok: false, error: "unauthorized" }, 401);
    const callerId = me.id;

    // 2) Role check (admin/owner only)
    const roleRes = await fetch(
      `${SUPABASE_URL.replace(/\/$/,"")}/rest/v1/user_roles?auth_user_id=eq.${encodeURIComponent(callerId)}&select=role&limit=1`,
      { method: "GET", headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
    );
    const roleJson = await roleRes.json().catch(() => null);
    const role = Array.isArray(roleJson) && roleJson[0] ? String(roleJson[0].role || "").toLowerCase() : "";
    if (!["admin","owner"].includes(role)) return json({ ok: false, error: "forbidden" }, 403);

    // 3) Create Auth user; if exists, fall back to generate_link to retrieve user id
    const password = randomPassword(20);
    let userId = null;

    const createRes = await fetch(`${SUPABASE_URL.replace(/\/$/,"")}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`
      },
      body: JSON.stringify({ email, password, email_confirm: true })
    });

    const createJson = await createRes.json().catch(() => null);
    if (createRes.ok && createJson?.id) {
      userId = createJson.id;
    } else {
      const glRes = await fetch(`${SUPABASE_URL.replace(/\/$/,"")}/auth/v1/admin/generate_link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`
        },
        body: JSON.stringify({
          type: "magiclink",
          email,
          options: { redirectTo: "https://oap-kas.com/Login.html" }
        })
      });
      const glJson = await glRes.json().catch(() => null);
      if (glRes.ok && glJson?.user?.id) {
        userId = glJson.user.id;
      } else {
        return json({ ok: false, error: "create_failed", details: createJson || glJson || null }, 400);
      }
    }

    return json({ ok: true, auth_user_id: userId }, 200);

  } catch (e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function randomPassword(len) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

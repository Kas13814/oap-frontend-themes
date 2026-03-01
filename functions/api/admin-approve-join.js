/**
 * Cloudflare Pages Function (NO npm dependencies)
 * Route: /api/admin-approve-join
 * File path: /functions/api/admin-approve-join.js
 *
 * Fixes:
 *  - If auth_user_id is NULL, we ensure it exists.
 *  - If creating Auth user fails with email_exists (422), we lookup existing Auth user by email
 *    via Supabase Admin API, then link join_requests.auth_user_id and continue.
 *
 * Required env vars:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 */

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      ...extraHeaders,
    },
  });
}

export async function onRequestOptions() {
  return json({ ok: true }, 200);
}

function sbHeaders(serviceKey, prefer = "return=representation") {
  return {
    "apikey": serviceKey,
    "authorization": `Bearer ${serviceKey}`,
    "content-type": "application/json",
    "prefer": prefer,
  };
}

async function sbGetOne({ baseUrl, serviceKey, table, select, eqKey, eqVal }) {
  const url =
    `${baseUrl}/rest/v1/${encodeURIComponent(table)}` +
    `?select=${encodeURIComponent(select)}` +
    `&${encodeURIComponent(eqKey)}=eq.${encodeURIComponent(eqVal)}` +
    `&limit=1`;
  const r = await fetch(url, { method: "GET", headers: sbHeaders(serviceKey) });
  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { ok: r.ok, status: r.status, data, url };
}

async function sbPatch({ baseUrl, serviceKey, table, eqKey, eqVal, body }) {
  const url =
    `${baseUrl}/rest/v1/${encodeURIComponent(table)}` +
    `?${encodeURIComponent(eqKey)}=eq.${encodeURIComponent(eqVal)}`;
  const r = await fetch(url, { method: "PATCH", headers: sbHeaders(serviceKey), body: JSON.stringify(body) });
  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { ok: r.ok, status: r.status, data, url };
}

async function sbUpsert({ baseUrl, serviceKey, table, onConflict, rows }) {
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?on_conflict=${encodeURIComponent(onConflict)}`;
  const headers = sbHeaders(serviceKey, "resolution=merge-duplicates,return=representation");
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(rows) });
  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { ok: r.ok, status: r.status, data, url };
}

function randomPassword(len = 18) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function adminFetch({ baseUrl, serviceKey, path, method="GET", body=null }) {
  const url = `${baseUrl}${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      "apikey": serviceKey,
      "authorization": `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { ok: r.ok, status: r.status, data, url };
}

async function createAuthUser({ baseUrl, serviceKey, email, user_metadata }) {
  return adminFetch({
    baseUrl,
    serviceKey,
    path: "/auth/v1/admin/users",
    method: "POST",
    body: {
      email,
      password: randomPassword(),
      email_confirm: true,
      user_metadata: user_metadata || {},
    }
  });
}

function extractUserId(payload) {
  if (!payload) return null;
  // Common shapes:
  // { id: "uuid", ... }
  // { user: { id: "uuid", ... } }
  // { users: [ { id } ] }  (possible)
  if (payload.id) return payload.id;
  if (payload.user && payload.user.id) return payload.user.id;
  if (Array.isArray(payload) && payload[0] && payload[0].id) return payload[0].id;
  if (payload.users && Array.isArray(payload.users) && payload.users[0] && payload.users[0].id) return payload.users[0].id;
  return null;
}

async function getAuthUserIdByEmail({ baseUrl, serviceKey, email }) {
  // Supabase / GoTrue admin lookup is not 100% consistent across versions.
  // We try 2 known patterns:
  //  1) GET /auth/v1/admin/users?email=<email>
  //  2) GET /auth/v1/admin/users?filter=email.eq.<email>
  const tries = [
    `/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    `/auth/v1/admin/users?filter=${encodeURIComponent(`email.eq.${email}`)}`,
  ];
  let last = null;
  for (const path of tries) {
    const res = await adminFetch({ baseUrl, serviceKey, path, method: "GET" });
    last = res;
    if (res.ok) {
      const id = extractUserId(res.data);
      if (id) return { ok: true, id, via: path };
    }
  }
  return { ok: false, id: null, last };
}

export async function onRequestPost({ request, env }) {
  try {
    const SUPABASE_URL = env.SUPABASE_URL;
    const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const join_request_id = body.join_request_id ?? body.joinRequestId ?? body.id;
    const pages = Array.isArray(body.pages) ? body.pages : (Array.isArray(body.page_keys) ? body.page_keys : []);
    const approved_by_user_id = body.approved_by_user_id ?? body.approvedByUserId ?? null;

    if (!join_request_id) return json({ ok: false, error: "missing_join_request_id" }, 400);
    if (!pages.length) return json({ ok: false, error: "missing_pages" }, 400);

    // 1) Fetch join request
    const jrRes = await sbGetOne({
      baseUrl: SUPABASE_URL,
      serviceKey: SERVICE,
      table: "join_requests",
      select: "join_request_id,tenant_id,employee_id,full_name,email,username,note,status,requested_role,auth_user_id",
      eqKey: "join_request_id",
      eqVal: join_request_id,
    });

    if (!jrRes.ok) {
      return json({ ok: false, error: "join_request_fetch_failed", jr_status: jrRes.status, details: jrRes.data }, 400);
    }

    const jr = Array.isArray(jrRes.data) ? jrRes.data[0] : null;
    if (!jr) return json({ ok: false, error: "join_request_not_found" }, 404);

    if (String(jr.status || "").toLowerCase() !== "pending") {
      return json({ ok: false, error: "join_request_not_pending", status: jr.status }, 409);
    }

    // 2) Ensure auth_user_id exists
    let auth_user_id = jr.auth_user_id || null;
    if (!auth_user_id) {
      if (!jr.email) return json({ ok: false, error: "missing_email_in_join_request" }, 400);

      const meta = {
        full_name: jr.full_name || null,
        employee_id: jr.employee_id || null,
        username: jr.username || null,
        requested_role: jr.requested_role || null,
        tenant_id: jr.tenant_id || null,
      };

      const crt = await createAuthUser({ baseUrl: SUPABASE_URL, serviceKey: SERVICE, email: jr.email, user_metadata: meta });

      if (!crt.ok) {
        // If email already exists, lookup existing user's UUID then continue
        const isEmailExists =
          crt.status === 422 &&
          crt.data &&
          (crt.data.error_code === "email_exists" || crt.data.msg?.toLowerCase?.().includes("already been registered"));

        if (isEmailExists) {
          const look = await getAuthUserIdByEmail({ baseUrl: SUPABASE_URL, serviceKey: SERVICE, email: jr.email });
          if (!look.ok || !look.id) {
            return json({
              ok: false,
              error: "auth_user_lookup_failed_after_email_exists",
              details: { create: crt.data, lookup_last: look.last }
            }, 400);
          }
          auth_user_id = look.id;
        } else {
          return json({ ok: false, error: "auth_user_create_failed", auth_status: crt.status, details: crt.data }, 400);
        }
      } else {
        auth_user_id = extractUserId(crt.data);
      }

      if (!auth_user_id) {
        return json({ ok: false, error: "auth_user_id_missing_after_ensure", details: { create: crt.data } }, 400);
      }

      // Persist auth_user_id into join_requests BEFORE approving (so DB trigger can insert into public.users safely)
      const link = await sbPatch({
        baseUrl: SUPABASE_URL,
        serviceKey: SERVICE,
        table: "join_requests",
        eqKey: "join_request_id",
        eqVal: join_request_id,
        body: { auth_user_id, updated_at: new Date().toISOString() },
      });

      if (!link.ok) {
        return json({ ok: false, error: "join_request_link_auth_failed", link_status: link.status, details: link.data }, 400);
      }
    }

    // 3) Seed page access
    const rows = pages.map((permission_key) => ({
      user_id: auth_user_id,
      permission_key,
      is_allowed: true,
      updated_at: new Date().toISOString(),
    }));

    const up = await sbUpsert({
      baseUrl: SUPABASE_URL,
      serviceKey: SERVICE,
      table: "user_page_access",
      onConflict: "user_id,permission_key",
      rows,
    });

    if (!up.ok) {
      return json({ ok: false, error: "seed_page_access_failed", up_status: up.status, details: up.data }, 400);
    }

    // 4) Approve
    const upd = await sbPatch({
      baseUrl: SUPABASE_URL,
      serviceKey: SERVICE,
      table: "join_requests",
      eqKey: "join_request_id",
      eqVal: join_request_id,
      body: {
        status: "approved",
        approved_by_user_id: approved_by_user_id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    if (!upd.ok) {
      return json({ ok: false, error: "join_request_update_failed", upd_status: upd.status, details: upd.data }, 400);
    }

    return json({ ok: true, join_request_id, auth_user_id, seeded_pages: pages.length });
  } catch (e) {
    return json({ ok: false, error: "server_error", details: String(e?.message || e) }, 500);
  }
}

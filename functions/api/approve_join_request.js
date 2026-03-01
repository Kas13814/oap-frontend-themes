// functions/api/reject_join_request.js
// OAP: Reject Join Request (REAL MODE)
// - GET  -> 405 JSON (avoid loading index.html)
// - POST -> Updates public.join_requests.status='rejected' + note + rejected_at
//           and enqueues an email in public.oap_email_outbox
//
// Required JSON body:
//   { "join_request_id": 123, "reason": "optional text", "triggered_by": "optional uuid", "role": "optional role" }
//
// IMPORTANT:
// - This endpoint uses Supabase Service Role key from env.SUPABASE_SERVICE_ROLE_KEY
// - Set env vars in Cloudflare Pages:
//     SUPABASE_URL
//     SUPABASE_SERVICE_ROLE_KEY
//
// Notes:
// - We keep logic minimal and stable (no other file changes needed).
// - If join_request is not found -> 404.

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OAP-SECRET",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestGet({ request }) {
  const cors = corsHeaders(request);
  return json(
    {
      ok: false,
      error: "Method Not Allowed",
      hint: "Use POST with JSON body { join_request_id, reason? }",
    },
    405,
    cors
  );
}

function requireEnv(env, name) {
  const v = env && env[name] ? String(env[name]).trim() : "";
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function sbFetch(url, serviceKey, path, opts = {}) {
  const full = url.replace(/\/$/, "") + path;
  const res = await fetch(full, {
    ...opts,
    headers: {
      "apikey": serviceKey,
      "Authorization": "Bearer " + serviceKey,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === "object" && data && data.message ? data.message : (typeof data === "string" ? data : "Supabase error");
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function buildRejectEmailHtml({ full_name, employee_id, username, requested_role, reason }) {
  const safe = (s) => String(s || "").replace(/[<>]/g, "");
  return `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6">
      <h2>OAP — Join request rejected</h2>
      <p>Hello ${safe(full_name) || "Employee"},</p>
      <p>Your join request has been <b>rejected</b>.</p>
      <ul>
        <li><b>Employee ID:</b> ${safe(employee_id)}</li>
        <li><b>Username:</b> ${safe(username)}</li>
        <li><b>Requested role:</b> ${safe(requested_role)}</li>
      </ul>
      ${reason ? `<p><b>Reason:</b> ${safe(reason)}</p>` : ""}
      <p>If you believe this is a mistake, please contact your administrator.</p>
      <hr/>
      <p style="color:#666;font-size:12px">OAP System</p>
    </div>
  `;
}

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request);

  try {
    const SUPABASE_URL = requireEnv(env, "SUPABASE_URL");
    const SERVICE_KEY = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body." }, 400, cors);
    }

    const join_request_id = Number(payload?.join_request_id);
    if (!Number.isFinite(join_request_id) || join_request_id <= 0) {
      return json({ ok: false, error: "join_request_id must be a positive number." }, 400, cors);
    }

    const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
    const triggered_by = typeof payload?.triggered_by === "string" ? payload.triggered_by.trim() : null;
    const role = typeof payload?.role === "string" ? payload.role.trim() : null;

    // 1) Fetch join request
    const rows = await sbFetch(
      SUPABASE_URL,
      SERVICE_KEY,
      `/rest/v1/join_requests?join_request_id=eq.${encodeURIComponent(join_request_id)}&select=*`,
      { method: "GET" }
    );

    const jr = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!jr) {
      return json({ ok: false, error: "Join request not found." }, 404, cors);
    }

    // 2) Update join_requests -> rejected
    const updateBody = {
      status: "rejected",
      note: reason || jr.note || null,
      rejected_at: new Date().toISOString(),
    };

    // If you want to track actor:
    // - rejected_by_user_id is bigint in your schema (not uuid),
    // so we will NOT set it unless you later provide mapping.
    // We keep it unchanged.

    const updated = await sbFetch(
      SUPABASE_URL,
      SERVICE_KEY,
      `/rest/v1/join_requests?join_request_id=eq.${encodeURIComponent(join_request_id)}&select=*`,
      { method: "PATCH", body: JSON.stringify(updateBody) }
    );

    // 3) Enqueue email in oap_email_outbox
    const toEmail = jr.email || "";
    let emailQueued = false;
    let outboxRow = null;

    if (toEmail) {
      const subject = "OAP — Join request rejected";
      const body_html = buildRejectEmailHtml({
        full_name: jr.full_name,
        employee_id: jr.employee_id,
        username: jr.username,
        requested_role: jr.requested_role,
        reason,
      });

      const outboxInsert = {
        to: toEmail,
        subject,
        body_preview: reason ? String(reason).slice(0, 160) : "Your join request has been rejected.",
        type: "join_request_rejected",
        triggered_by: triggered_by || null,
        role: role || null,
        attempt_count: 0,
        body_html,
      };

      const inserted = await sbFetch(
        SUPABASE_URL,
        SERVICE_KEY,
        `/rest/v1/oap_email_outbox?select=*`,
        { method: "POST", body: JSON.stringify(outboxInsert) }
      );

      outboxRow = Array.isArray(inserted) && inserted.length ? inserted[0] : inserted;
      emailQueued = true;
    }

    return json(
      {
        ok: true,
        join_request_id,
        updated_status: "rejected",
        updated_at: updateBody.rejected_at,
        email_queued: emailQueued,
        email_to: toEmail || null,
        outbox_id: outboxRow?.id || null,
      },
      200,
      cors
    );
  } catch (err) {
    console.error("reject_join_request error:", err);
    return json(
      {
        ok: false,
        error: String(err?.message || err),
        details: err?.data || null,
      },
      500,
      cors
    );
  }
}

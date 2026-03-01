/**
 * Cloudflare Pages Function (Server-side Proxy)
 * Path: functions/api/chat.js
 *
 * Purpose:
 *  - Same-origin endpoint for the frontend: POST /api/chat
 *  - Forwards request to Cloud Run backend (env.NXS_BACKEND_URL or fallback)
 *  - Passes Authorization header (Bearer JWT) through
 *  - Handles CORS with allowlist via env.CORS_ORIGINS (comma-separated)
 *
 * IMPORTANT:
 *  - This file is SERVER-SIDE ONLY. Do NOT put browser/DOM/Plotly code here.
 */

function makeCorsHeaders(request, env) {
  // Origin header is usually present for browser POSTs (even same-origin).
  const originRaw = request.headers.get("Origin") || "";
  const origin = originRaw.replace(/\/+$/, "");

  // The origin of THIS Cloudflare Pages site (same-origin calls should always be allowed)
  let siteOrigin = "";
  try {
    siteOrigin = new URL(request.url).origin.replace(/\/+$/, "");
  } catch (_) {}

  // Allowlist from env (comma/space/semicolon separated)
  const allow = (env.CORS_ORIGINS || "")
    .split(/[\s,;]+/g)
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const isSameOrigin = !!origin && !!siteOrigin && origin === siteOrigin;
  const isAllowed = isSameOrigin || (allow.length > 0 && allow.includes(origin));

  const headers = new Headers();
  // Only set CORS headers when we have an Origin (browser). Same-origin does not require them,
  // but keeping them consistent helps with debugging and future cross-origin needs.
  if (origin && isAllowed) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  return { headers, isAllowed, origin: originRaw, origin_norm: origin, site_origin: siteOrigin, allow };
}

async function readJsonSafe(res) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch (_) {
      return null;
    }
  }
  try {
    const text = await res.text();
    return { detail: text.slice(0, 300) };
  } catch (_) {
    return { detail: "Non-JSON response" };
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  const request_id =
    globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

  const { headers: corsHeaders, isAllowed, origin, allow } = makeCorsHeaders(request, env);

  // Preflight
  if (request.method === "OPTIONS") {
    if (!isAllowed) return new Response(null, { status: 204 });
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST
  if (request.method !== "POST") {
    const h = new Headers(corsHeaders);
    h.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ detail: "Method Not Allowed", request_id }), {
      status: 405,
      headers: h,
    });
  }

  // Enforce allowlist (browser calls)
  if (!isAllowed) {
    const h = new Headers();
    h.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify({ detail: "Origin not allowed", origin, allowed: allow, request_id, hint: "Set CORS_ORIGINS in Cloudflare Pages vars (comma-separated) or rely on same-origin; this request origin must match site origin or be listed." }),
      { status: 403, headers: h }
    );
  }

  // Backend URL
  const backendBase = (env.NXS_BACKEND_URL ||
    "https://oap-backend-875458188350.europe-west1.run.app").replace(/\/+$/, "");
  const backendUrl = backendBase + "/api/chat";

  // Body
  let incoming;
  try {
    incoming = await request.json();
  } catch (_) {
    const h = new Headers(corsHeaders);
    h.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ detail: "Invalid JSON body", request_id }), {
      status: 400,
      headers: h,
    });
  }

  const auth = request.headers.get("Authorization") || "";

  // Forward
  let backendRes;
  try {
    backendRes = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: auth,
      },
      body: JSON.stringify({ ...incoming, request_id }),
    });
  } catch (e) {
    const h = new Headers(corsHeaders);
    h.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify({
        detail: "Failed to reach backend",
        error: String(e?.message || e),
        request_id,
      }),
      { status: 502, headers: h }
    );
  }

  const data = (await readJsonSafe(backendRes)) || {};
  const out = JSON.stringify({ ...data, request_id });

  const h = new Headers(corsHeaders);
  h.set("Content-Type", "application/json");
  return new Response(out, { status: backendRes.status, headers: h });
}

// functions/api/send_activation_email.js
// Send activation email endpoint.
// IMPORTANT: This endpoint must NOT fall back to index.html on GET.
// - GET -> 405 JSON (so opening in browser won't load your app + won't redirect to Login)
// - POST -> validates payload (wiring test), returns JSON.
// NOTE: No email action yet — this is فقط للتأكد أن Endpoint شغال.

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

// If someone opens the endpoint in the browser (GET), return 405 JSON (not HTML)
export async function onRequestGet({ request }) {
  const cors = corsHeaders(request);
  return json(
    {
      ok: false,
      error: "Method Not Allowed",
      hint: "Use POST with JSON body { email, username, activation_link? }",
    },
    405,
    cors
  );
}

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request);

  // Optional shared secret (recommended). If not set in env, we skip this check.
  const requiredSecret = env && env.OAP_API_SECRET ? String(env.OAP_API_SECRET) : "";
  if (requiredSecret) {
    const got = request.headers.get("X-OAP-SECRET") || "";
    if (got !== requiredSecret) {
      return json({ ok: false, error: "Unauthorized (bad secret)." }, 401, cors);
    }
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400, cors);
  }

  const email = typeof payload?.email === "string" ? payload.email.trim() : "";
  const username = typeof payload?.username === "string" ? payload.username.trim() : "";
  const activation_link = typeof payload?.activation_link === "string" ? payload.activation_link.trim() : "";

  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "email is required and must look like an email." }, 400, cors);
  }
  if (!username) {
    return json({ ok: false, error: "username is required." }, 400, cors);
  }

  // Return what we received (for testing).
  return json(
    {
      ok: true,
      message: "send_activation_email endpoint is working (validation-only).",
      received: {
        email,
        username,
        activation_link,
      },
      next: "Next step will integrate Resend (or your email provider) and send the activation email.",
    },
    200,
    cors
  );
}

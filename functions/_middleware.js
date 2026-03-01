export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // Allow public assets and auth pages
  // Public endpoints/pages ONLY (everything else must pass permission check)
  // NOTE: Do NOT whitelist whole directories like /pages/auth/ (it bypasses security).
  const PUBLIC_PREFIXES = [
    "/",
    "/index.html",
    "/Login.html",

    "/favicon",
    "/apple-touch-icon",
    "/site.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
    "/assets/",
    "/api/public-config",

    // Public self-service pages (root)
    "/join.html",
    "/joining.html",
    "/Reset_password.html",
    "/Forgot password.html",
    "/password.html",

    // Public self-service pages (under /pages/auth)
    "/pages/auth/joining.html",
    "/pages/auth/Reset_password.html",
    "/pages/auth/Forgot password.html",
    "/pages/auth/password.html",
    "/pages/auth/unauthorized.html",
  ];

  const pathname = url.pathname;

  // If path matches any public prefix, pass through
  for (const p of PUBLIC_PREFIXES) {
    if (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p)) {
      return next();
    }
  }

  // Only protect HTML pages (avoid blocking images/css/js)
  const isHtml = pathname.endsWith(".html") || !pathname.includes(".");
  if (!isHtml) return next();

  // Read access token cookie set by Login.html
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)oap_at=([^;]+)/);
  const accessToken = m ? decodeURIComponent(m[1]) : null;

  if (!accessToken) {
    // Not logged in -> redirect to login with returnTo
    const rt = encodeURIComponent(pathname + (url.search || ""));
    return Response.redirect(`${url.origin}/Login.html?returnTo=${rt}`, 302);
  }

  // Fetch Supabase public config (URL + anon key) from your existing endpoint
  let cfg;
  try {
    const r = await fetch(`${url.origin}/api/public-config`, { headers: { "Cache-Control": "no-store" } });
    cfg = await r.json();
  } catch (e) {
    cfg = null;
  }
  if (!cfg || !cfg.ok || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    // Fail closed (runtime configured) -> block
    return new Response("Auth gate misconfigured (public-config missing).", { status: 403 });
  }

  const SUPABASE_URL = cfg.supabaseUrl;
  const ANON_KEY = cfg.supabaseAnonKey;

  // 1) Validate token by calling Supabase Auth /user
  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
    },
  });

  if (!userResp.ok) {
    // Token invalid/expired -> redirect to login
    const rt = encodeURIComponent(pathname + (url.search || ""));
    return Response.redirect(`${url.origin}/Login.html?returnTo=${rt}`, 302);
  }

  // 2) Authorize page by page_key using DB-enforced RLS + RPC mapping (no need for page_path column)
  const PATH_TO_KEY = {
    "/index.html": "HOME",
    "/AI.html": "AI",
    "/KPIs.html": "KPIS",
    "/Form.html": "FORM",
    "/Audit.html": "AUDIT",
    "/joining.html": "JOINING",
    "/joining_admin.html": "JOINING_ADMIN",
    "/permissions_admin.html": "PERMISSIONS_ADMIN",
    "/settings.html": "SETTINGS",

    // Same admin pages when hosted under /pages/auth/
    "/pages/auth/joining_admin.html": "JOINING_ADMIN",
    "/pages/auth/permissions_admin.html": "PERMISSIONS_ADMIN",
    "/pages/auth/permissions_admin115.html": "PERMISSIONS_ADMIN",
  };

  const pageKey = PATH_TO_KEY[pathname];
  if (!pageKey) {
    return new Response("Forbidden", { status: 403 });
  }

  const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/can_access_page_v3`, {
    method: "POST",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ p_page_key: pageKey }),
  });

  if (!rpcResp.ok) {
    return new Response("Forbidden", { status: 403 });
  }

  const allowedPath = await rpcResp.json().catch(() => null);
  if (!allowedPath || allowedPath !== pathname) {
    return new Response("Forbidden", { status: 403 });
  }

  // Allowed
  return next();
}

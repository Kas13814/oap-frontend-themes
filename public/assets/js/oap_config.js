/* =====================================================
   OAP AUTO-RUNTIME CONFIG (ADDED - NO DELETIONS)
   Reads Cloudflare Pages env vars via /api/public-config and exposes them to window.*
   This is required because the browser cannot read Pages Variables directly.
===================================================== */
(function () {
  "use strict";

  // If config already present, do nothing.
  if (window.SUPABASE_URL && (window.SUPABASE_ANON_KEY || window.SUPABASE_KEY)) return;

  // Shared promise so multiple scripts can await the same fetch.
  if (!window.__OAP_PUBLIC_CONFIG_PROMISE__) {
    window.__OAP_PUBLIC_CONFIG_PROMISE__ = (async () => {
      try {
        const res = await fetch("/api/public-config", {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          headers: { "Accept": "application/json" }
        });
        const cfg = await res.json().catch(() => ({}));
        if (!cfg || cfg.ok !== true) return false;

        const url = (cfg.supabaseUrl || "").trim();
        const anon = (cfg.supabaseAnonKey || "").trim();
        if (!url || !anon) return false;

        window.OAP_CONFIG = window.OAP_CONFIG || {};
        window.OAP_CONFIG.SUPABASE_URL = window.OAP_CONFIG.SUPABASE_URL || url;
        window.OAP_CONFIG.SUPABASE_ANON_KEY = window.OAP_CONFIG.SUPABASE_ANON_KEY || anon;

        // Aliases used across your codebase
        window.SUPABASE_URL = window.SUPABASE_URL || url;
        window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || anon;
        window.SUPABASE_KEY = window.SUPABASE_KEY || anon;

        window.NXS_SUPABASE_URL = window.NXS_SUPABASE_URL || url;
        window.NXS_SUPABASE_ANON_KEY = window.NXS_SUPABASE_ANON_KEY || anon;

        // Helper expected by gates/pages
        window.ensureSupabaseConfig = window.ensureSupabaseConfig || (async function ensureSupabaseConfig() {
          // Ensure config fetched at least once
          try { await window.__OAP_PUBLIC_CONFIG_PROMISE__; } catch (_) {}
          return !!(window.SUPABASE_URL && (window.SUPABASE_ANON_KEY || window.SUPABASE_KEY));
        });

        return true;
      } catch (e) {
        return false;
      }
    })();
  }

  // Fire-and-forget (also keeps waitForSupabaseConfig from timing out)
  // No await here to avoid blocking page rendering.
  window.__OAP_PUBLIC_CONFIG_PROMISE__;
})();


/* *****************************************************
 OAP Central Access Controller (Enterprise)
 File: public/assets/js/oap_access_api.js

 Single source of truth:
   - public.oap_page_access (page_path -> permission_key, requires_auth, is_active, redirects)

 Design goals:
   - No auth logic inside HTML pages (except loading this file)
   - One controller decides: session? permission? where to go?
   - Robust to URL aliases: /AI <-> /AI.html, / <-> /index.html
   - Robust to schema drift: uses select("*") and supports redirect column aliases
***************************************************** */
(function () {
  "use strict";

  // ---------------- Config ----------------
  const PAGE_MAP_TABLE = "oap_page_access";

  // Public pages (no session check)
  const PUBLIC_PATHS = new Set([
    // Home / Landing pages (must NOT force-auth; prevents bounce to Login when returning from AI)
    "/",
    "/index",
    "/index/",
    "/index.html",
    // Canonical login
    "/Login.html",
    // Aliases (some routes/users hit /Login without .html)
    "/Login",
    "/Login/",
    "/login",
    "/login/",
    "/joining",
    "/joining/",
    "/joining.html",
    "/pages/auth/joining",        // ✅ ADDED: pretty-url without .html
    "/pages/auth/joining/",       // ✅ ADDED: trailing-slash variant
    "/pages/auth/joining.html",
    "/pages/auth/password.html",
    "/pages/auth/unauthorized.html",
  ]);

  const PUBLIC_PREFIXES = [
    "/pages/email_approval/",
  ];

  // Safe defaults if DB columns are missing
  const DEFAULT_LOGIN = "/Login.html";
  const DEFAULT_UNAUTHORIZED = "/pages/auth/unauthorized.html";

  // ---------------- Helpers ----------------
  function isPublicPath(pathname) {
    if (PUBLIC_PATHS.has(pathname)) return true;
    for (const p of PUBLIC_PREFIXES) {
      if (pathname.startsWith(p)) return true;
    }
    return false;
  }

  function currentFullPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function buildRedirect(baseUrl, returnTo) {
    const url = new URL(baseUrl, window.location.origin);
    if (returnTo) url.searchParams.set("returnTo", returnTo);
    return url.pathname + url.search + url.hash;
  }

  function safeRedirect(url) {
    try {
      window.location.replace(url);
    } catch (_) {
      window.location.href = url;
    }
  }

  // ---------------- Supabase ----------------
  
  // --------- Load Guards (prevents false logout redirects) ---------
  async function waitForSupabaseJs(timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.supabase && typeof window.supabase.createClient === "function") return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  async function waitForSupabaseConfig(timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const url =
        window.SUPABASE_URL ||
        window.OAP_SUPABASE_URL ||
        (window.OAP_CONFIG && window.OAP_CONFIG.SUPABASE_URL) ||
        window.NXS_SUPABASE_URL ||
        (window.oap_config && window.oap_config.SUPABASE_URL);

      const anon =
        window.SUPABASE_KEY ||
        window.SUPABASE_ANON_KEY ||
        (window.OAP_CONFIG && window.OAP_CONFIG.SUPABASE_ANON_KEY) ||
        window.NXS_SUPABASE_ANON_KEY ||
        (window.oap_config && window.oap_config.SUPABASE_ANON_KEY);

      if (url && anon) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  function getSupabaseClient() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase is not loaded");
    }

    // Accept config from the unified runtime config loader (oap_config.js)
    const url =
      window.SUPABASE_URL ||
      window.OAP_SUPABASE_URL ||
      (window.OAP_CONFIG && window.OAP_CONFIG.SUPABASE_URL) ||
      window.NXS_SUPABASE_URL ||
      (window.oap_config && window.oap_config.SUPABASE_URL);

    const anon =
      window.SUPABASE_KEY ||
      window.SUPABASE_ANON_KEY ||
      (window.OAP_CONFIG && window.OAP_CONFIG.SUPABASE_ANON_KEY) ||
      window.NXS_SUPABASE_ANON_KEY ||
      (window.oap_config && window.oap_config.SUPABASE_ANON_KEY);

    if (!url || !anon) {
      throw new Error("Supabase is not configured");
    }

    // Backward-compat aliases expected by legacy code
    if (!window.SUPABASE_URL) window.SUPABASE_URL = url;
    if (!window.SUPABASE_KEY) window.SUPABASE_KEY = anon;

    return window.supabase.createClient(url, anon);
  }

  async function getSession() {
    // Wait a moment for scripts/config to load (AI.html loads multiple bundles)
    await waitForSupabaseJs();
    await waitForSupabaseConfig();

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  // ---------------- Core Logic ----------------
  async function canAccessPath(pathname) {
    if (isPublicPath(pathname)) {
      return { allow: true };
    }

    let session;
    try {
      session = await getSession();
    } catch (_) {
      session = null;
    }

    if (!session) {
      // ✅ Grace window right after successful login (prevents bounce-back)
      try {
        const ts = Number(localStorage.getItem("OAP_LOGIN_TS") || 0);
        if (ts && (Date.now() - ts) < 8000) {
          return { allow: true };
        }
      } catch (_) {}

      return {
        allow: false,
        redirect: buildRedirect(DEFAULT_LOGIN, currentFullPath()),
      };
    }

    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from(PAGE_MAP_TABLE)
      .select("*")
      .eq("page_path", pathname)
      .limit(1);

    if (error) throw error;

    const row = data && data[0];
    if (!row) {
      return { allow: true };
    }

    if (row.is_active === false) {
      return {
        allow: false,
        redirect: row.redirects || DEFAULT_UNAUTHORIZED,
      };
    }

    if (row.requires_auth === false) {
      return { allow: true };
    }

    if (!row.permission_key) {
      return { allow: true };
    }

    const permissions =
      session.user?.app_metadata?.permissions ||
      session.user?.user_metadata?.permissions ||
      [];

    if (!permissions.includes(row.permission_key)) {
      return {
        allow: false,
        redirect: row.redirects || DEFAULT_UNAUTHORIZED,
      };
    }

    return { allow: true };
  }

  // ---------------- Public API ----------------
  const OAP_Access = {
    async ensure() {
      const pathname = window.location.pathname;

      try {
        const result = await canAccessPath(pathname);
        if (!result.allow && result.redirect) {
          safeRedirect(result.redirect);
        }
      } catch (err) {
        console.error("OAP Access Error:", err);
      }
    },
  };

  window.OAP_Access = OAP_Access;

  // ---------------- Auto enforce ----------------
  (async function boot() {
    try {
      const pathname = window.location.pathname;

      // never enforce access logic on public paths (prevents login loop)
      if (isPublicPath(pathname)) return;

      await OAP_Access.ensure();
    } catch (err) {
      console.error("Access API Boot Error:", err);
    }
  })();
})();

/* =====================================================
   OAP Runtime Config Shim (added, no code removed)
   Purpose:
   - Provide ensureSupabaseConfig() expected by pages (e.g., index.html)
   - Populate window.NXS_SUPABASE_URL / window.NXS_SUPABASE_ANON_KEY aliases
   Notes:
   - Runs only if ensureSupabaseConfig is not already defined.
===================================================== */
(function () {
  "use strict";

  // If another script already provides config loader, do nothing.
  if (typeof window.ensureSupabaseConfig === "function") return;

  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return false;

    // Try common key names
    const url =
      cfg.NXS_SUPABASE_URL ||
      cfg.SUPABASE_URL ||
      cfg.supabaseUrl ||
      cfg.supabase_url ||
      (cfg.supabase && (cfg.supabase.url || cfg.supabase.supabaseUrl)) ||
      null;

    const anon =
      cfg.NXS_SUPABASE_ANON_KEY ||
      cfg.SUPABASE_ANON_KEY ||
      cfg.SUPABASE_KEY ||
      cfg.anonKey ||
      cfg.supabase_anon_key ||
      cfg.supabaseAnonKey ||
      (cfg.supabase && (cfg.supabase.anonKey || cfg.supabase.anon_key)) ||
      null;

    if (url && !window.NXS_SUPABASE_URL) window.NXS_SUPABASE_URL = url;
    if (anon && !window.NXS_SUPABASE_ANON_KEY) window.NXS_SUPABASE_ANON_KEY = anon;

    // Back-compat aliases some pages/scripts might use
    if (url && !window.SUPABASE_URL) window.SUPABASE_URL = url;
    if (anon && !window.SUPABASE_ANON_KEY) window.SUPABASE_ANON_KEY = anon;
    if (anon && !window.SUPABASE_KEY) window.SUPABASE_KEY = anon;

    return !!(window.NXS_SUPABASE_URL && window.NXS_SUPABASE_ANON_KEY);
  }

  async function ensureSupabaseConfig() {
    // Already present?
    if (window.NXS_SUPABASE_URL && window.NXS_SUPABASE_ANON_KEY) return true;

    // 1) If a page embedded a config object, use it
    if (applyConfig(window.OAP_PUBLIC_CONFIG)) return true;
    if (applyConfig(window.NXS_PUBLIC_CONFIG)) return true;

    // 2) Try to fetch public runtime config (safe endpoint on your backend)
    //    Expected response examples:
    //    { "NXS_SUPABASE_URL": "...", "NXS_SUPABASE_ANON_KEY": "..." }
    //    or { "SUPABASE_URL": "...", "SUPABASE_ANON_KEY": "..." }
    try {
      const res = await fetch("/api/public-config", {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        headers: { "Accept": "application/json" }
      });

      if (!res.ok) return false;

      const cfg = await res.json();
      return applyConfig(cfg);
    } catch (e) {
      return false;
    }
  }

  window.ensureSupabaseConfig = ensureSupabaseConfig;
})();

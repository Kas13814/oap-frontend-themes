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
  // Source of truth for routes + auth requirements
  // (Your DB tables: page_catalog + user_page_access)
  const PAGE_MAP_TABLE = "page_catalog";

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
    // Joining aliases (pretty URLs)
    "/joining",
    "/joining/",
    "/joining.html",
    "/pages/auth/joining",        // ✅ ADDED: pretty-url without .html
    "/pages/auth/joining/",       // ✅ ADDED: trailing-slash variant
    // Auth pages
    "/pages/auth/joining.html",
    "/pages/auth/password.html",
        "/pages/auth/unauthorized.html",
    // Reset password (public)
    "/Reset_password.html",
    "/pages/auth/Reset_password.html",
    "/pages/auth/Reset_password.html/",
  ]);

  const PUBLIC_PREFIXES = [
    "/pages/email_approval/",
  ];

  // Safe defaults if DB columns are missing
  const DEFAULT_LOGIN = "/Login.html";
  const DEFAULT_UNAUTHORIZED = "/pages/auth/unauthorized.html";

  // ✅ ADDED: Permissions cache (prevents UI “all disabled” if RPC errors transiently)
  const ACCESS_CACHE_KEY = "OAP_ACCESS_CACHE_V1";
  const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  function nowMs() {
    return Date.now();
  }

  function readAccessCache() {
    try {
      const raw = localStorage.getItem(ACCESS_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      if (!obj.ts || !obj.map) return null;
      if ((nowMs() - Number(obj.ts)) > ACCESS_CACHE_TTL_MS) return null;
      return obj.map;
    } catch (_) {
      return null;
    }
  }

  function writeAccessCache(mapObj) {
    try {
      localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({ ts: nowMs(), map: mapObj }));
    } catch (_) {}
  }

  function mapToObject(map) {
    const obj = {};
    map.forEach((v, k) => { obj[String(k)] = !!v; });
    return obj;
  }

  // ---------------- Helpers ----------------
  function isPublicPath(pathname) {
    if (PUBLIC_PATHS.has(pathname)) return true;
    for (const p of PUBLIC_PREFIXES) {
      if (pathname.startsWith(p)) return true;
    }
    return false;
  }

  // Normalize paths to prevent "not found" bypass via trailing slash and case/alias differences.
  function normalizePath(pathname) {
    if (!pathname) return "/";
    if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
    return pathname;
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
    // ✅ Prefer page-level singleton if present (prevents multiple GoTrueClient instances / AbortError)
    if (typeof window.OAP_getSupabaseClient === "function") {
      try { return window.OAP_getSupabaseClient(); } catch (_) {}
    }

    // ✅ Global singleton (create once, reuse forever)
    if (window.__OAP_SUPABASE_CLIENT__) return window.__OAP_SUPABASE_CLIENT__;


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

    // ✅ Singleton: create once, reuse forever (prevents supabase-js AbortError locks)
if (window.__OAP_SUPABASE_CLIENT__) return window.__OAP_SUPABASE_CLIENT__;
window.__OAP_SUPABASE_CLIENT__ = window.supabase.createClient(url, anon);
return window.__OAP_SUPABASE_CLIENT__;

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

  // ✅ ADDED: Fetch permissions from DB via RPC + cache fallback
  async function getMyPageAccessMap(supabase, authUserId) {
    try {
      const { data, error } = await supabase.rpc("get_my_page_access");
      if (error) throw error;

      const map = new Map();
      (data || []).forEach((r) => {
        if (!r) return;
        const k = (r.permission_key ?? r.page_key ?? r.page ?? r.key);
        if (k == null) return;
        map.set(String(k).toLowerCase(), !!r.can_access);
      });

const obj = mapToObject(map);
      writeAccessCache(obj);

      // Expose for UI (optional)
      window.OAP_PAGE_ACCESS = obj;
      try { window.dispatchEvent(new CustomEvent("oap:access-updated", { detail: obj })); } catch (_) {}

      return map;
    } catch (e) {
      // Fallback: if RPC is missing/blocked, read from user_page_access directly.
      // This avoids false Unauthorized when RPC isn't available yet.
      try {
        if (authUserId) {
          const { data: rows, error: qErr } = await supabase
            .from("user_page_access")
            .select("page_key, can_access")
            .eq("auth_user_id", authUserId);

          if (!qErr && Array.isArray(rows)) {
            const map = new Map();
            rows.forEach((r) => {
              if (!r) return;
              if (r.page_key == null) return;
              map.set(String(r.page_key).toLowerCase(), !!r.can_access);
            });

            const obj = mapToObject(map);
            writeAccessCache(obj);
            window.OAP_PAGE_ACCESS = obj;
            try { window.dispatchEvent(new CustomEvent("oap:access-updated", { detail: obj })); } catch (_) {}
            return map;
          }
        }
      } catch (_) {
        // ignore and try cache
      }

      const cached = readAccessCache();
      if (cached) {
        window.OAP_PAGE_ACCESS = cached;
        try { window.dispatchEvent(new CustomEvent("oap:access-updated", { detail: cached })); } catch (_) {}
        return new Map(Object.entries(cached).map(([k, v]) => [k, !!v]));
      }

      // Last resort: return empty map (will deny protected pages).
      return new Map();
    }
  }

  // ---------------- Core Logic ----------------
  async function canAccessPath(pathname) {
    pathname = normalizePath(pathname);
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
    // If the route is not in the catalog, DO NOT auto-allow.
    // Missing catalog rows are a security hole (anyone can create a new page and bypass access).
    if (!row) {
      return {
        allow: false,
        redirect: DEFAULT_UNAUTHORIZED,
      };
    }

    if (row.is_active === false) {
      return {
        allow: false,
        redirect: row.redirect_if_forbidden || row.redirects || DEFAULT_UNAUTHORIZED,
      };
    }

    if (row.requires_auth === false) {
      return { allow: true };
    }

    // Permission key: page_catalog uses page_key (legacy tables used permission_key)
    const permKey = (row.page_key ?? row.permission_key);
    if (!permKey) {
      return {
        allow: false,
        redirect: row.redirect_if_forbidden || row.redirects || DEFAULT_UNAUTHORIZED,
      };
    }

    // ✅ CHANGED: permission check comes from DB (RPC) instead of auth metadata
    const accessMap = await getMyPageAccessMap(supabase, session?.user?.id);
    const allowed = accessMap.get(String(permKey).toLowerCase()) === true;

    if (!allowed) {
      return {
        allow: false,
        redirect: row.redirect_if_forbidden || row.redirects || DEFAULT_UNAUTHORIZED,
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

    // ✅ ADDED: safe helper for pages to read permissions (optional)
    async loadMyAccess() {
      await waitForSupabaseJs();
      await waitForSupabaseConfig();
      const supabase = getSupabaseClient();
      const { data: s } = await supabase.auth.getSession();
      const map = await getMyPageAccessMap(supabase, s?.session?.user?.id);
      return { mapObject: mapToObject(map) };
    },
  };

  window.OAP_Access = OAP_Access;

  // ---------------- Auto enforce ----------------
  (async function boot() {
    try {
      const pathname = window.location.pathname;

      // ✅ INIT: always build the shared Supabase client (needed for public pages like index.html)
      try {
        await waitForSupabaseJs();
        await waitForSupabaseConfig();
        getSupabaseClient();
      } catch (_) {
        // keep silent: public pages may still work without auth
      }

      // never enforce access logic on public paths (prevents login loop)
      if (isPublicPath(pathname)) return;

      await OAP_Access.ensure();
    } catch (err) {
      console.error("Access API Boot Error:", err);
    }
  })();
})();

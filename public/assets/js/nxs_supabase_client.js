// nxs_supabase_client.js
// NXS Supabase Unified Client — Stable, No Forced Redirects
// Patch v2: if config is missing, fetch it from GET /api/public-config (Cloudflare Function).
// - Safe: returns only Supabase URL + Anon key (public).
// - Always exposes window.NXS_Supabase.client when possible.

(function (global) {
  'use strict';

  function readFirstDefined(keys) {
    for (const k of keys) {
      if (typeof global[k] === 'string' && global[k].trim()) return global[k].trim();
    }
    return '';
  }

  function readFromLocalStorage(keys) {
    try {
      for (const k of keys) {
        const v = localStorage.getItem(k);
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    } catch (e) {}
    return '';
  }

  async function fetchPublicConfig() {
    try {
      const res = await fetch('/api/public-config', { method: 'GET', cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (data && data.ok && data.supabaseUrl && data.supabaseAnonKey) {
        return { url: String(data.supabaseUrl), anon: String(data.supabaseAnonKey) };
      }
    } catch (e) {}
    return null;
  }

  async function init() {
    let SUPABASE_URL =
      readFirstDefined(['NXS_SUPABASE_URL', 'SUPABASE_URL']) ||
      readFromLocalStorage(['NXS_SUPABASE_URL', 'SUPABASE_URL']);

    let SUPABASE_ANON_KEY =
      readFirstDefined(['NXS_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_KEY', 'NXS_SUPABASE_KEY']) ||
      readFromLocalStorage(['NXS_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_KEY', 'NXS_SUPABASE_KEY']);

    // If missing, fetch from backend (public config endpoint)
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      const cfg = await fetchPublicConfig();
      if (cfg) {
        SUPABASE_URL = cfg.url;
        SUPABASE_ANON_KEY = cfg.anon;
      }
    }

    // Ensure expected globals exist for other scripts
    if (SUPABASE_URL && !global.NXS_SUPABASE_URL) global.NXS_SUPABASE_URL = SUPABASE_URL;
    if (SUPABASE_ANON_KEY && !global.NXS_SUPABASE_ANON_KEY) global.NXS_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[NXS] Supabase config missing');
      return;
    }

    if (!global.supabase || !global.supabase.createClient) {
      console.error('[NXS] supabase-js not loaded');
      return;
    }

    const client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    async function getCurrentUser() {
      try {
        const { data, error } = await client.auth.getUser();
        if (error) return null;
        return data?.user || null;
      } catch (e) {
        return null;
      }
    }

    // -------- Auth + Permission Guard (v3) --------
    // Enforces:
    // - Public pages render without login
    // - Protected pages require login
    // - Protected pages require explicit permission via RPC: public.get_my_page_access()
    // Security: fail-closed on protected pages if permission RPC fails.

    const PUBLIC_PATHS = new Set([
      '/Login.html','/Login','/login','/login/',
      '/pages/auth/password.html',
      '/pages/auth/unauthorized.html',
      '/joining','/joining/','/joining.html'
    ]);

    function normalizePath(pathname){
      try{ return String(pathname || '/'); }catch(_){ return '/'; }
    }

    function isPublicPath(pathname){
      const p = normalizePath(pathname);
      if (PUBLIC_PATHS.has(p)) return true;
            return p.startsWith('/pages/email_approval/');
    }

    function pageKeyFromPath(pathname){
      const p = normalizePath(pathname);
      // Cloudflare Pages pretty URLs may hit without .html
      if (p === '/' || p === '/index' || p === '/index/' || p === '/index.html') return 'HOME';
      if (p === '/AI' || p === '/AI/' || p === '/AI.html') return 'AI';
      if (p === '/pages/Navigation%20panel.html' || p === '/pages/Navigation panel.html') return 'FORM';
      if (p === '/pages/auth/joining_admin.html') return 'JOINING_ADMIN';
      if (p === '/pages/auth/permissions_admin.html') return 'PERMISSIONS_ADMIN';
      return null;
    }

    function buildRedirect(basePath, returnTo){
      try{
        const u = new URL(basePath, window.location.origin);
        if (returnTo) u.searchParams.set('returnTo', returnTo);
        // Preserve theme if present
        try{
          const t = document.documentElement.getAttribute('data-theme');
          if (t && !u.searchParams.has('theme')) u.searchParams.set('theme', t);
        }catch(_){ }
        return u.pathname + u.search + u.hash;
      }catch(_){
        return basePath;
      }
    }

    function currentFullPath(){
      try{ return window.location.pathname + window.location.search + window.location.hash; }catch(_){ return '/'; }
    }

    async function getMyAccessMap(){
      const { data, error } = await client.rpc('get_my_page_access');
      if (error) throw error;
      const map = {};
      (data || []).forEach(r => {
        const k = String(r.page_key || '');
        map[k] = !!r.can_access;
      });
      return map;
    }

    async function requireAuth() {
      const pathname = window.location?.pathname || '';
      const search = window.location?.search || '';

      const isJoiningAdminInvite =
        pathname.endsWith('/joining_admin.html') &&
        new URLSearchParams(search).has('request_id');

      if (isJoiningAdminInvite) {
        return { allowed: true, user: null, reason: 'joining_admin_invite' };
      }

      // Public pages: no auth required
      if (isPublicPath(pathname)) {
        return { allowed: true, user: null, reason: 'public_page' };
      }

      // Determine page key (only for managed pages). Unknown pages: treat as protected.
      const pageKey = pageKeyFromPath(pathname);

      const user = await getCurrentUser();
      if (!user) {
        // Protected page -> go to login
        window.location.href = buildRedirect('/Login.html', currentFullPath());
        return { allowed: false, user: null, reason: 'not_authenticated' };
      }

      // HOME is public-by-design (even if user is logged in)
      if (pageKey === 'HOME') {
        return { allowed: true, user, reason: 'home_public' };
      }

      // If page is managed, enforce permission
      if (pageKey) {
        try {
          const access = await getMyAccessMap();
          const ok = !!access[pageKey];
          if (!ok) {
            window.location.href = buildRedirect('/pages/auth/unauthorized.html', currentFullPath());
            return { allowed: false, user, reason: 'no_permission' };
          }
        } catch (e) {
          console.error('[NXS] permission check failed', e);
          window.location.href = buildRedirect('/pages/auth/unauthorized.html', currentFullPath());
          return { allowed: false, user, reason: 'permission_check_failed' };
        }
      }

      return { allowed: true, user, reason: 'authenticated' };
    }


    global.NXS_Supabase = { client, getCurrentUser, requireAuth };

  }

  init();
})(window);

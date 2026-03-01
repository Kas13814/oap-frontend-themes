/* OAP auth.js (shim)
   Purpose: Compatibility shim for pages that reference /assets/js/auth.js.
   Security: No keys stored here; relies on public-config + existing Supabase loader.
*/

(function () {
  'use strict';

  // Mark as loaded
  window.OAP_AUTH_LOADED = true;

  // Reuse the same minimal helper used by auth pages
  window.OAP_Auth = window.OAP_Auth || {};
  window.OAP_Auth.getClient = function () {
    try {
      if (window.NXS_Supabase && window.NXS_Supabase.client) return window.NXS_Supabase.client;
      if (window.supabase && window.supabase.createClient) {
        const url = window.NXS_SUPABASE_URL || window.OAP_SUPABASE_URL || window.SUPABASE_URL || '';
        const anon = window.NXS_SUPABASE_ANON_KEY || window.OAP_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
        if (url && anon) return window.supabase.createClient(url, anon);
      }
    } catch (e) {}
    return null;
  };

  // Also expose under AuthPage namespace if needed
  window.OAP_AuthPage = window.OAP_AuthPage || {};
  if (!window.OAP_AuthPage.getClient) window.OAP_AuthPage.getClient = window.OAP_Auth.getClient;
})();

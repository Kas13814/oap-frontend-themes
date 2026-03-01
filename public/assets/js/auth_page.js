/* OAP auth_page.js
   Purpose: Shared, lightweight helpers for auth pages.
   This file exists to satisfy /assets/js/auth_page.js and prevent load failures.
   Security: No keys stored here; relies on oap_config.js and Supabase client already loaded.
*/

(function () {
  'use strict';

  // Mark as loaded (useful for diagnostics)
  window.OAP_AUTH_PAGE_LOADED = true;

  // Optional: tiny safe logger (disabled by default)
  function log() {
    // Uncomment for debugging:
    // console.log.apply(console, arguments);
  }

  // Provide a minimal namespace for future extensions
  window.OAP_AuthPage = window.OAP_AuthPage || {};

  // Convenience: get Supabase client if available (does not create new client)
  window.OAP_AuthPage.getClient = function () {
    try {
      if (window.NXS_Supabase && window.NXS_Supabase.client) return window.NXS_Supabase.client;
      if (window.supabase && window.supabase.createClient) {
        const url = window.NXS_SUPABASE_URL || window.OAP_SUPABASE_URL || window.SUPABASE_URL || '';
        const anon = window.NXS_SUPABASE_ANON_KEY || window.OAP_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
        if (url && anon) return window.supabase.createClient(url, anon);
      }
    } catch (e) {
      log('OAP_AuthPage.getClient failed', e);
    }
    return null;
  };

  // No automatic redirects here — keep auth behavior controlled by each page.
})(); 

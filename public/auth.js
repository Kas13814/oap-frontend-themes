/* public/auth.js
   Purpose: Root alias so any page that loads /auth.js works correctly.
   This file ONLY loads the real script located at /assets/js/auth.js.
   It does not change any existing logic or design.
*/
(function () {
  'use strict';

  // Avoid double-loading
  if (window.__OAP_AUTH_ROOT_LOADED__) return;
  window.__OAP_AUTH_ROOT_LOADED__ = true;

  var s = document.createElement('script');
  s.src = '/assets/js/auth.js';
  s.async = false; // keep execution order deterministic
  s.defer = false;
  document.head.appendChild(s);
})(); 

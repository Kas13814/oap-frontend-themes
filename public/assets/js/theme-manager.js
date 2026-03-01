/* OAP Theme Manager (global) */
(() => {
  const THEME_KEY = "oap_theme";
  const INK_KEY   = "oap_gradient_ink";

  const root = document.documentElement;

  function safeGet(key){
    try{ return localStorage.getItem(key); }catch(_){ return null; }
  }
  function safeSet(key, val){
    try{ localStorage.setItem(key, val); }catch(_){ /* ignore */ }
  }

  function getQueryParam(name){
    try{
      return new URLSearchParams(window.location.search).get(name);
    }catch(_){ return null; }
  }

  function applyTheme(theme){
    if (!theme) return;
    root.setAttribute("data-theme", theme);
    safeSet(THEME_KEY, theme);
  }

  function applyGradientInk(ink){
    if (!ink) return;
    // only meaningful for gradient, but harmless otherwise
    root.setAttribute("data-gradient-ink", ink);
    safeSet(INK_KEY, ink);
  }

  // Bootstrap: query param wins, then saved
  const qTheme = getQueryParam("theme");
  const savedTheme = safeGet(THEME_KEY);
  applyTheme(qTheme || savedTheme || root.getAttribute("data-theme") || "light");

  const qInk = getQueryParam("gink") || getQueryParam("gradientInk");
  const savedInk = safeGet(INK_KEY);
  if (qInk || savedInk) applyGradientInk(qInk || savedInk);

  // Expose API
  window.OAPTheme = {
    apply: applyTheme,
    setTheme: applyTheme,
    setGradientInk: applyGradientInk,
    getTheme: () => root.getAttribute("data-theme") || "light",
    getGradientInk: () => root.getAttribute("data-gradient-ink") || "white"
  };
})();

/* ******************************************************
 * File: chat_new.js
 * NXS AI — Frontend Bridge (Stable / PRO)
 * ----------------------------------------------------
 * - Runs in the browser (Client-side) next to AI.html
 * - Calls SAME-ORIGIN proxy endpoint: /api/chat
 * - Fetches Supabase JWT via supabase.auth.getSession()
 * - Renders text via window.renderMessage()
 * - Renders Plotly charts into #chartTarget (optional)
 * - Shows/hides thinking indicator if provided
 ****************************************************** */

(() => {
  "use strict";

  // ====== Configuration (edit ONLY if your IDs differ) ======
  const API_ENDPOINT = "/api/chat"; // Canonical, same-origin
  const REQUEST_TIMEOUT_MS = 45000; // Cloud Run + LLM can be slow

  // DOM targets for charts (optional)
  const DRAWER_ID = "nxsDashboardDrawer";
  const CHART_TARGET_ID = "nxsChartContainer"; // primary
const CHART_TARGET_ID_FALLBACK = "chartTarget";

  // Retry (helps with cold-start / transient network issues)
  const ENABLE_ONE_RETRY = true;
  const RETRY_DELAY_MS = 600;

  // ====== Safe helpers ======
  function safeCall(fnName, ...args) {
    try {
      const fn = window[fnName];
      if (typeof fn === "function") return fn(...args);
    } catch (_) {}
    return undefined;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function getSupabaseToken() {
    // Preferred: official session API (most reliable)
    try {
      if (window.supabase?.auth?.getSession) {
        const { data, error } = await window.supabase.auth.getSession();
        if (!error && data?.session?.access_token) return data.session.access_token;
      }
    } catch (_) {}

    // Fallback (best-effort): if session is stored in localStorage
    try {
      const keys = Object.keys(localStorage || {});
      const sbKey =
        keys.find((k) => k.endsWith("-auth-token")) ||
        keys.find((k) => k.includes("-auth-token"));
      if (sbKey) {
        const raw = localStorage.getItem(sbKey);
        const session = raw ? JSON.parse(raw) : null;
        if (session?.access_token) return session.access_token;
      }
    } catch (_) {}

    return "";
  }

  function renderChartIfAny(visualHint) {
    if (!visualHint || !window.Plotly) return;

    const drawer = document.getElementById(DRAWER_ID);
    const target = document.getElementById(CHART_TARGET_ID);
    if (!target) return;

    try {
      if (drawer) drawer.classList.add("open");
      window.Plotly.purge(target);
      window.Plotly.newPlot(
        target,
        visualHint.data || [],
        visualHint.layout || {},
        { responsive: true, displayModeBar: false, locale: "ar" }
      );
    } catch (e) {
      console.error("Plotly render error:", e);
    }
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function callApiOnce(userMessage, chatHistory, extraBody)
  {
    const token = await getSupabaseToken();

    const res = await fetchWithTimeout(
      API_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          message: userMessage,
          history: Array.isArray(chatHistory) ? chatHistory : [],
          ...(extraBody && typeof extraBody === "object" ? extraBody : {}),
        }),
      },
      REQUEST_TIMEOUT_MS
    );

    const contentType = res.headers.get("content-type") || "";
    let payload = null;

    if (contentType.includes("application/json")) {
      payload = await res.json().catch(() => null);
    } else {
      const text = await res.text().catch(() => "");
      payload = { status: "error", message: text || `HTTP ${res.status}` };
    }

    return { res, payload };
  }

  /**
   * Send a message to NXS Brain (Cloud Run via /api/chat proxy).
   * @param {string} userMessage
   * @param {Array} chatHistory
   * @returns {Promise<object>}
   */
  async function sendMessageToBrain(userMessage, chatHistory = []) {
    const msg = (userMessage ?? "").toString().trim();
    if (!msg) return { status: "error", message: "Empty message" };

    safeCall("showThinking");

    try {
      let attempt = 0;
      let last = null;

      while (true) {
        attempt += 1;

        try {
          last = await callApiOnce(msg, chatHistory, null);

          const statusOk = last.res.ok;
          const payloadStatus =
            last.payload && last.payload.status
              ? String(last.payload.status).toLowerCase()
              : "";

          // Retry once on typical transient gateway errors
          const shouldRetry =
            ENABLE_ONE_RETRY &&
            attempt === 1 &&
            (!statusOk || payloadStatus === "error") &&
            [502, 503, 504].includes(last.res.status);

          if (shouldRetry) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }

          break;
        } catch (netErr) {
          // Network/timeout errors: retry once if enabled
          const shouldRetry = ENABLE_ONE_RETRY && attempt === 1;
          if (shouldRetry) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          throw netErr;
        }
      }

      safeCall("hideThinking");

      const data = last?.payload || {};

      // --- Normalize new dashboard contract (visual_payload) into existing rendering paths ---
      try {
        if (!data.visual_hint && data.visual_payload && data.visual_payload.plotly && data.visual_payload.plotly.figure) {
          data.visual_hint = { figure: data.visual_payload.plotly.figure };
        }
        // If backend sends filter schema in visual_payload, render it (AI.html provides nxsRenderDashboardFilters)
        if (data.visual_payload && data.visual_payload.filters && data.visual_payload.filters.available && typeof window.nxsRenderDashboardFilters === "function") {
          window.nxsRenderDashboardFilters(data.visual_payload.filters.available);
        }
      } catch (_) {}
      if (data.request_id) console.log("NXS request_id:", data.request_id);

      // Prefer reply, else message
      const replyText = (data.reply ?? data.message ?? "").toString().trim();
      if (replyText) safeCall("renderMessage", replyText, "ai");

      // Chart
      if (data.visual_hint) renderChartIfAny(data.visual_hint);

    // --- Send visuals to Dashboard iframe (if present) ---
    try {
      const vp = data.visual_payload;
      if (vp && typeof window.nxsDashboardOpenAndSend === 'function') {
        window.nxsDashboardOpenAndSend(vp);
      } else if (data.visual_hint && data.visual_hint.plotly && data.visual_hint.plotly.figure && typeof window.nxsDashboardOpenAndSend === 'function') {
        // Fallback: wrap visual_hint into the dashboard widget format
        window.nxsDashboardOpenAndSend({
          widgets: [
            {
              id: "chart-1",
              kind: "chart",
              title: (data.visual_hint.title || "Chart"),
              width_cols: 12,
              plotly: { figure: data.visual_hint.plotly.figure }
            }
          ]
        });
      }
    } catch (e) {
      console.warn("Dashboard postMessage failed:", e);
    }


      return data;
    } catch (error) {
      console.error("NXS Bridge Error:", error);
      safeCall("hideThinking");
      safeCall(
        "renderMessage",
        "⚠️ حدث خطأ أثناء الاتصال بخادم NXS. يمكنك المحاولة مرة أخرى بعد لحظات.",
        "ai"
      );
      return { status: "error", message: String(error?.message || error) };
    }
  }

  // Export globally for AI.html

  // ====== Dashboard Filters: Apply/Clear (interactive) ======
  // AI.html dispatches: window.dispatchEvent(new CustomEvent("nxs:dashboardFiltersApply", { detail }))
  // We call the same backend endpoint, but WITHOUT rendering the reply into the main chat (chart-only update).
  async function sendDashboardQuery(promptText, filtersObj) {
    const prompt = (promptText ?? "").toString().trim();
    if (!prompt) return;

    safeCall("showThinking");

    try {
      const extra = {
        dashboard: {
          mode: "filters_apply",
          filters: (filtersObj && typeof filtersObj === "object") ? filtersObj : {}
        }
      };

      const last = await callApiOnce(prompt, [], extra);
      safeCall("hideThinking");

      const data = last?.payload || {};

      // Normalize visual_payload -> visual_hint for existing renderer
      try {
        if (!data.visual_hint && data.visual_payload && data.visual_payload.plotly && data.visual_payload.plotly.figure) {
          data.visual_hint = { figure: data.visual_payload.plotly.figure };
        }
      } catch (_) {}

      // Prefer AI.html's visual handler if available (it also opens the drawer)
      if (typeof window.nxsHandleVisualMeta === "function") {
        try { window.nxsHandleVisualMeta(data); } catch (_) {}
      }

      // Fallback: chart-only render
      if (data.visual_hint) renderChartIfAny(data.visual_hint);

    // --- Send visuals to Dashboard iframe (if present) ---
    try {
      const vp = data.visual_payload;
      if (vp && typeof window.nxsDashboardOpenAndSend === 'function') {
        window.nxsDashboardOpenAndSend(vp);
      } else if (data.visual_hint && data.visual_hint.plotly && data.visual_hint.plotly.figure && typeof window.nxsDashboardOpenAndSend === 'function') {
        // Fallback: wrap visual_hint into the dashboard widget format
        window.nxsDashboardOpenAndSend({
          widgets: [
            {
              id: "chart-1",
              kind: "chart",
              title: (data.visual_hint.title || "Chart"),
              width_cols: 12,
              plotly: { figure: data.visual_hint.plotly.figure }
            }
          ]
        });
      }
    } catch (e) {
      console.warn("Dashboard postMessage failed:", e);
    }


      return data;
    } catch (e) {
      console.error("Dashboard query error:", e);
      safeCall("hideThinking");
      return null;
    }
  }

  // Bind once
  if (!window.__nxs_dashboard_filters_bound) {
    window.__nxs_dashboard_filters_bound = true;

    window.addEventListener("nxs:dashboardFiltersApply", (ev) => {
      try {
        const filters = (ev && ev.detail) ? ev.detail : {};
        const promptEl = document.getElementById("nxsDashboardPrompt");
        const prompt = (promptEl && promptEl.value) ? promptEl.value : "";
        sendDashboardQuery(prompt, filters);
      } catch (_) {}
    });

    window.addEventListener("nxs:dashboardFiltersClear", () => {
      // No-op for backend (UI already clears). Kept for future sync.
    });
  }
  window.sendMessageToBrain = sendMessageToBrain;
})();

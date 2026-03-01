// chat_page_secure.js
// Patch v3 (Dashboard-ready):
// - Keeps original page logic
// - Sends scope to backend (if available) for SGS/TCC
// - Cleans markdown stars (*) from assistant reply
// - Pushes full payload to NXSDashboardRenderer.ingest() for charts/tables/KPIs

(function (global) {
  'use strict';

  async function waitForSupabaseClient(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const c = global.NXS_Supabase && global.NXS_Supabase.client;
      if (c && c.auth) return c;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  (async function boot() {
    const supa = await waitForSupabaseClient();
    if (!supa) {
      console.error('[NXS] Supabase client not found (window.NXS_Supabase.client).');
      return;
    }

    const CLOUD_RUN_CHAT_URL = global.NXS_BACKEND_CHAT_URL || '/api/chat';

    const chatBox =
      document.getElementById('chat-messages') ||
      document.getElementById('chatLog');

    const chatForm = document.getElementById('chat-form') || null;
    const chatInput =
      document.getElementById('chat-input') ||
      document.getElementById('messageInput') ||
      document.querySelector('textarea');

    const sendBtn =
      document.getElementById('sendBtn') ||
      document.getElementById('send-button') ||
      document.querySelector('[data-send]');

    function appendMessage(role, text, isoTime) {
      // Keep whatever existing DOM structure your page uses
      if (!chatBox) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'msg ' + role;

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = String(text || '');

      wrapper.appendChild(bubble);
      chatBox.appendChild(wrapper);
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    async function requireAuthSafe() {
      try {
        const { data } = await supa.auth.getUser();
        return data && data.user ? data.user : null;
      } catch (_) {
        return null;
      }
    }

    async function getAccessToken() {
      try {
        const { data } = await supa.auth.getSession();
        return data && data.session && data.session.access_token ? data.session.access_token : null;
      } catch (_) {
        return null;
      }
    }

    function getSelectedModelKey() {
      const v = global.NXS_CHAT_MODEL || global.NXS_SELECTED_MODEL || '';
      return (v === 'pro') ? 'pro' : 'flash';
    }

    function getScope() {
      return (
        global.NXS_SCOPE ||
        global.NXS_SELECTED_SCOPE ||
        global.nxsScope ||
        localStorage.getItem('nxs_scope') ||
        ''
      );
    }

    async function sendToBackend(text) {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('لا يوجد توكن Supabase (JWT) صالح.');

      const scope = getScope();

      // Send scope to backend (safe: backend can ignore unknown fields)
      const body = {
        message: text,
        model: getSelectedModelKey(),
        scope: scope,               // "SGS" or "TCC"
        prefer_visual: true,        // hint only
        prefer_dashboard: true      // hint only
      };

      const res = await fetch(CLOUD_RUN_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + accessToken,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + ' ' + txt);
      }

      const payload = await res.json().catch(() => ({}));
      return payload;
    }

    async function submitText(text) {
      const user = await requireAuthSafe();
      if (!user) return;

      appendMessage('user', text, new Date().toISOString());
      appendMessage('assistant', '... جارٍ التفكير ...', null);

      try {
        const payload = await sendToBackend(text);
        global.__last_ai_payload = payload; // debug-friendly

        // Push payload to Dashboard renderer
        try {
          const scope = getScope();
          if (global.NXSDashboardRenderer && typeof global.NXSDashboardRenderer.ingest === 'function') {
            global.NXSDashboardRenderer.ingest(payload, text, scope);
          } else if (global.dispatchEvent) {
            global.dispatchEvent(new CustomEvent('nxs:backend-payload', { detail: { payload, message: text, scope } }));
          }
        } catch (e) {
          console.warn('[NXS] dashboard ingest failed', e);
        }

        // Render assistant reply (cleaned)
        let reply = (payload && (payload.reply || payload.answer)) || '';
        try {
          if (global.NXSDashboardRenderer && typeof global.NXSDashboardRenderer.cleanReply === 'function') {
            reply = global.NXSDashboardRenderer.cleanReply(reply, text);
          } else {
            reply = String(reply || '')
              .replace(/```[\s\S]*?```/g, '')
              .replace(/\*/g, '')
              .replace(/^\s*[-•]\s*/gm, '')
              .trim();
          }
        } catch (_) {}

        if (chatBox && chatBox.lastChild) chatBox.removeChild(chatBox.lastChild);
        appendMessage('assistant', reply, new Date().toISOString());
      } catch (e) {
        console.error('[NXS] backend error', e);
        if (chatBox && chatBox.lastChild) {
          chatBox.lastChild.textContent = 'حدث خطأ أثناء الاتصال بنظام الذكاء الاصطناعي.';
        } else {
          appendMessage('assistant', 'حدث خطأ أثناء الاتصال بنظام الذكاء الاصطناعي.', null);
        }
      }
    }

    async function handleSubmit(event) {
      if (event) event.preventDefault();
      const text = (chatInput && chatInput.value || '').trim();
      if (!text) return;
      if (chatInput) chatInput.value = '';
      await submitText(text);
    }

    if (chatForm) chatForm.addEventListener('submit', handleSubmit);
    else if (sendBtn) sendBtn.addEventListener('click', handleSubmit);

  })();

})(window);

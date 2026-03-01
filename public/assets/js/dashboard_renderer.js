/* *****************************************************
 OAP / NXS Dashboard Renderer (Interactive + Theme-aware)
 File: public/assets/js/dashboard_renderer.js

 Goals (minimal + deterministic):
  1) Render charts/tables/KPIs inside the existing drawer in AI.html
  2) Work with explicit payloads ONLY:
       - payload.visual (stable contract)
       - payload.visual_payload (legacy widgets/plotly)
       - payload.reply contains an explicit JSON chart contract (```json {...}``` or raw JSON)
  3) Keep UI responsive + theme-aware; do not change page layout.

 Dashboard DOM (already in AI.html):
   Drawer:          #nxsDashboardDrawer
   Glow indicator:  #nxsDashboardGlow
   KPI grid:        #nxsKpiGrid
   Main chart:      #nxsChartContainer
   Secondary chart: #nxsChartSecondary
   Table:           #nxsTableContainer

 Filters (already in AI.html):
   #nxsFilterChartType  (auto | bar | line | pie)
   #nxsFilterSort       (none | asc | desc)
   #nxsFilterTopN       (all | 3 | 5 | 10)
   #nxsFilterPercent    (checkbox)
   #nxsDashReset        (button)
   #nxsDashExport       (button)

***************************************************** */
(function (global) {
  "use strict";

  const AR_RE = /[\u0600-\u06FF]/;

  function isArabic(s) {
    return AR_RE.test(String(s || ""));
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function pickEl(ids) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  }

  function getTextColor() {
    try {
      const cs = getComputedStyle(document.body);
      return cs.color || "#eaeaea";
    } catch (_) { return "#eaeaea"; }
  }

  function getBorderColor() {
    try {
      const drawer = document.getElementById("nxsDashboardDrawer");
      const cs = getComputedStyle(drawer || document.body);
      return cs.borderColor || "rgba(255,255,255,0.18)";
    } catch (_) { return "rgba(255,255,255,0.18)"; }
  }

  function getBgColor() {
    // keep Plotly transparent to match theme backgrounds
    return "rgba(0,0,0,0)";
  }

  function normalizeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function fmtNumber(n) {
    // keep compact, no commas for Arabic UI consistency
    const x = Math.round((Number(n) || 0) * 100) / 100;
    return String(x);
  }

  function fmtPercent(p) {
    const x = Math.round((Number(p) || 0) * 10) / 10;
    return String(x) + "%";
  }

  function fmtMinutesToHHMM(mins) {
    const m = Math.max(0, Math.round(Number(mins) || 0));
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    const h2 = String(hh).padStart(2, "0");
    const m2 = String(mm).padStart(2, "0");
    return h2 + ":" + m2;
  }

  function translateKnownLabelsIfArabic(labels, question) {
    if (!isArabic(question)) return labels;

    const map = {
      "Flynas": "فلاي ناس",
      "Saudia Airlines": "الخطوط السعودية",
      "Saudi Airlines": "الخطوط السعودية",
      "Saudia": "الخطوط السعودية",
      "Flyadeal": "فلاي أديل",
      "Foreign lines": "خطوط أجنبية",
      "Foreign Lines": "خطوط أجنبية",
      "Riyadh Airlines": "طيران الرياض",
      "Riyadh airline": "طيران الرياض",
    };

    return (labels || []).map((x) => {
      const s = String(x || "");
      return map[s] || s;
    });
  }

  function stripMarkdown(reply, question) {
    let s = String(reply || "");

    // remove fenced blocks (json/code)
    s = s.replace(/```[\s\S]*?```/g, "");

    // remove all asterisks and leading bullet markers (user asked to remove them)
    s = s.replace(/\*/g, "");
    s = s.replace(/^\s*[-•]\s*/gm, "");

    // mild cleanup
    s = s.replace(/[ \t]+\n/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n").trim();

    // localize common airline names in text when Arabic question
    if (isArabic(question)) {
      const repMap = [
        ["Flynas", "فلاي ناس"],
        ["Saudia Airlines", "الخطوط السعودية"],
        ["Saudi Airlines", "الخطوط السعودية"],
        ["Flyadeal", "فلاي أديل"],
        ["Foreign lines", "خطوط أجنبية"],
        ["Riyadh Airlines", "طيران الرياض"],
      ];
      repMap.forEach(([a, b]) => { s = s.split(a).join(b); });
    }
    return s;
  }

  // -------- Extract explicit JSON chart contract from reply --------
  function extractJsonChartContractFromReply(replyText) {
    const t = String(replyText || "");

    // 1) inside ```json ... ```
    let m = t.match(/```json\s*([\s\S]*?)```/i);
    if (m && m[1]) {
      const obj = tryParseJsonObject(m[1]);
      if (obj) return obj;
    }

    // 2) raw JSON object (first {...} that looks like chart contract)
    const raw = findFirstLikelyJsonObject(t);
    if (raw) {
      const obj = tryParseJsonObject(raw);
      if (obj) return obj;
    }

    return null;
  }

  function tryParseJsonObject(s) {
    try {
      const txt = String(s || "").trim();
      if (!txt.startsWith("{") || !txt.endsWith("}")) return null;
      const obj = JSON.parse(txt);
      if (!obj || typeof obj !== "object") return null;
      // accept common keys
      const hasLabels = Array.isArray(obj.labels);
      const hasValues = Array.isArray(obj.values) || (Array.isArray(obj.datasets) && obj.datasets.length);
      const hasType = !!(obj.chart_type || obj.type);
      if (hasLabels && hasValues && hasType) return obj;
      return null;
    } catch (_) { return null; }
  }

  function findFirstLikelyJsonObject(text) {
    // simple balanced-brace scan; picks first object that contains "labels"
    const s = String(text || "");
    let depth = 0, start = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        if (depth > 0) depth--;
        if (depth === 0 && start >= 0) {
          const cand = s.slice(start, i + 1);
          if (cand.includes('"labels"') || cand.includes("'labels'")) return cand;
          start = -1;
        }
      }
    }
    return null;
  }

  // -------- Normalize to our internal model --------
  function normalizeToModel(payload, question) {
    if (!payload || typeof payload !== "object") return null;

    // 0) Unified contract: payload.viz
    if (payload.viz && typeof payload.viz === "object") {
      return { kind: "viz", viz: payload.viz };
    }

    // A) Stable contract: payload.visual
    if (payload.visual && typeof payload.visual === "object") {
      const v = payload.visual;
      const kind = String(v.kind || "").toLowerCase();
      if (kind === "chart" && v.chart) {
        return {
          kind: "chart",
          chart: {
            type: String((v.chart.type || "bar")).toLowerCase(),
            title: String(v.chart.title || v.title || ""),
            labels: Array.isArray(v.chart.labels) ? v.chart.labels.map(String) : [],
            datasets: Array.isArray(v.chart.datasets) ? v.chart.datasets : []
          },
          notes: Array.isArray(v.notes) ? v.notes : []
        };
      }
      if (kind === "table" && v.table) {
        return {
          kind: "table",
          table: v.table
        };
      }
    }

    // B) Legacy plotly widgets: payload.visual_payload
    if (payload.visual_payload && typeof payload.visual_payload === "object") {
      return { kind: "plotly", visual_payload: payload.visual_payload };
    }

    // C) Some backends put it under context/meta
    const ctx = (payload.context && typeof payload.context === "object") ? payload.context : null;
    if (ctx) {
      if (ctx.viz && typeof ctx.viz === "object") {
        return { kind: "viz", viz: ctx.viz };
      }
      if (ctx.visual && typeof ctx.visual === "object") {
        return normalizeToModel({ visual: ctx.visual }, question);
      }
      if (ctx.visual_payload && typeof ctx.visual_payload === "object") {
        return { kind: "plotly", visual_payload: ctx.visual_payload };
      }
    }

    // D) Explicit JSON chart contract embedded in reply
    const reply = String(payload.reply || payload.answer || "");
    const obj = extractJsonChartContractFromReply(reply);
    if (obj) {
      const type = String(obj.chart_type || obj.type || "bar").toLowerCase();
      const title = String(obj.title || "");
      const labels = Array.isArray(obj.labels) ? obj.labels.map(String) : [];
      let datasets = [];

      if (Array.isArray(obj.datasets) && obj.datasets.length) {
        datasets = obj.datasets.map((d) => ({
          label: String(d.label || ""),
          data: Array.isArray(d.data) ? d.data.map(normalizeNumber) : [],
          unit: String(d.unit || "")
        }));
      } else if (Array.isArray(obj.values)) {
        datasets = [{ label: String(obj.unit || ""), data: obj.values.map(normalizeNumber), unit: String(obj.unit || "") }];
      }

      if (labels.length && datasets.length) {
        return {
          kind: "chart",
          chart: { type, title, labels, datasets },
          notes: []
        };
      }
    }

    return null;
  }

  // -------- Renderer --------

  // ---------- FREE DASHBOARD (dynamic layout: no fixed slots) ----------
  // Uses #nxsDashGrid when present. Legacy fixed slots are hidden via HTML/CSS (html.nxs-free-dashboard).
  const _freePlots = new Set();

  function _getFreeGrid() {
    const grid = document.getElementById('nxsDashGrid');
    if (!grid) return null;
    document.documentElement.classList.add('nxs-free-dashboard');
    grid.classList.remove('nxs-hidden');
    return grid;
  }

  function _purgeFreePlots() {
    if (!global.Plotly) {
      _freePlots.clear();
      return;
    }
    for (const el of _freePlots) {
      try { global.Plotly.purge(el); } catch (_) {}
    }
    _freePlots.clear();
  }

  function _clearFreeGrid(grid) {
    if (!grid) return;
    _purgeFreePlots();
    grid.innerHTML = '';
  }

  function _makeWidgetCard({ title, kind, span }) {
    const card = document.createElement('section');
    card.className = 'nxs-widget-card';
    card.dataset.kind = kind || 'widget';
    card.style.gridColumn = `span ${span || 12}`;

    const header = document.createElement('div');
    header.className = 'nxs-widget-header';

    const h = document.createElement('div');
    h.className = 'nxs-widget-title';
    h.textContent = title || '—';

    const actions = document.createElement('div');
    actions.className = 'nxs-widget-actions';

    const btnMax = document.createElement('button');
    btnMax.type = 'button';
    btnMax.className = 'nxs-widget-btn';
    btnMax.title = 'تكبير/تصغير';
    btnMax.textContent = '⤢';

    actions.appendChild(btnMax);
    header.appendChild(h);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'nxs-widget-body';

    card.appendChild(header);
    card.appendChild(body);

    btnMax.addEventListener('click', () => {
      card.classList.toggle('nxs-widget-max');
      // Resize Plotly inside this card after layout change
      if (global.Plotly) {
        const plot = body.querySelector('.nxs-plot');
        if (plot) {
          try { global.Plotly.Plots.resize(plot); } catch (_) {}
        }
      }
    });

    return { card, body };
  }

  function _renderFreeFromVisualPayload(vp) {
    const grid = _getFreeGrid();
    if (!grid) return false;

    const widgets = (vp && Array.isArray(vp.widgets)) ? vp.widgets : [];
    const charts = widgets.filter(w => w && w.kind === 'chart');
    const tables = widgets.filter(w => w && w.kind === 'table');
    const kpis = widgets.filter(w => w && w.kind === 'kpi');

    _clearFreeGrid(grid);

    // If nothing useful, keep grid hidden.
    if (!widgets.length) {
      grid.classList.add('nxs-hidden');
      return true;
    }

    // KPI block first (if present)
    for (const w of kpis) {
      const items = Array.isArray(w.items) ? w.items : [];
      if (!items.length) continue;
      const { card, body } = _makeWidgetCard({ title: w.title || 'KPIs', kind: 'kpi', span: 12 });

      const wrap = document.createElement('div');
      wrap.style.display = 'grid';
      wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
      wrap.style.gap = '12px';

      for (const it of items) {
        const k = document.createElement('div');
        k.className = 'nxs-kpi';
        k.innerHTML = `
          <div class="nxs-kpi-label">${escapeHtml(it.label || '—')}</div>
          <div class="nxs-kpi-value">${escapeHtml(String(it.value ?? '—'))}</div>
          ${it.sub ? `<div class="nxs-kpi-sub">${escapeHtml(it.sub)}</div>` : ''}
        `;
        wrap.appendChild(k);
      }

      body.appendChild(wrap);
      grid.appendChild(card);
    }

    // Charts
    const chartSpan = (charts.length === 1 && !tables.length) ? 12 : 6;
    for (const w of charts) {
      const { card, body } = _makeWidgetCard({
        title: w.title || 'رسم بياني',
        kind: 'chart',
        span: w.width_cols || chartSpan,
      });

      // Prevent scrollbars in Plotly area
      body.style.overflow = 'hidden';

      const plot = document.createElement('div');
      plot.className = 'nxs-plot';
      plot.style.width = '100%';
      plot.style.height = (w.height_px ? `${w.height_px}px` : '360px');
      body.appendChild(plot);
      grid.appendChild(card);

      const fig = w.figure;
      if (global.Plotly && fig && fig.data && fig.layout) {
        const config = Object.assign(
          { responsive: true, displaylogo: false, scrollZoom: false },
          w.plotly_config || {}
        );
        try {
          global.Plotly.react(plot, fig.data, fig.layout, config);
          _freePlots.add(plot);
        } catch (e) {
          plot.textContent = 'تعذر رسم المخطط.';
        }
      } else {
        plot.textContent = 'تعذر رسم المخطط.';
      }
    }

    // Tables
    for (const w of tables) {
      const { card, body } = _makeWidgetCard({ title: w.title || 'تفاصيل', kind: 'table', span: w.width_cols || 12 });
      body.innerHTML = w.html || '';
      // Ensure RTL friendliness and full-width table
      body.setAttribute('dir', 'rtl');
      const t = body.querySelector('table');
      if (t) t.style.width = '100%';
      grid.appendChild(card);
    }

    // Final: resize Plotly after DOM is painted
    if (global.Plotly) {
      setTimeout(() => {
        for (const el of _freePlots) {
          try { global.Plotly.Plots.resize(el); } catch (_) {}
        }
      }, 30);
    }

    return true;
  }

  function _vizToVisualPayload(viz) {
    if (!viz || typeof viz !== 'object') return null;
    const widgets = [];

    if (viz.kpis && Array.isArray(viz.kpis) && viz.kpis.length) {
      // If already in widget-like format
      widgets.push({ kind: 'kpi', title: 'KPIs', items: viz.kpis });
    }

    if (viz.charts && Array.isArray(viz.charts)) {
      for (const ch of viz.charts) {
        const fig = ch && ch.plotly && ch.plotly.figure;
        if (fig) {
          widgets.push({ kind: 'chart', title: ch.title || 'رسم بياني', figure: fig });
        }
      }
    }

    if (viz.tables && Array.isArray(viz.tables)) {
      for (const tb of viz.tables) {
        const html = tb && tb.html;
        if (html) {
          widgets.push({ kind: 'table', title: tb.title || 'تفاصيل', html });
        }
      }
    }

    return widgets.length ? { intent: 'dashboard', widgets } : null;
  }


  const Renderer = {
    _bound: false,
    _lastPayload: null,
    _lastQuestion: "",
    _lastScope: "",
    _lastModel: null,

    ingest(payload, question, scope) {
      this._lastPayload = payload || null;
      this._lastQuestion = String(question || "");
      this._lastScope = String(scope || "");

      // Always clear first to avoid stale visuals
      this.clear();

      const model = normalizeToModel(payload, this._lastQuestion);
      this._lastModel = model;

      const analytic = this.isAnalyticQuestion(this._lastQuestion);
      const wantsChart = this.userExplicitlyAskedForChart(this._lastQuestion);

      if (model) {
        // open dashboard automatically when we have visuals
        this.openDrawer();
        this.render(model, wantsChart);
      } else {
        // If question is analytical but no visual came from backend => show minimal notice
        if (analytic) {
          this.openDrawer();
          this.renderEmptyNotice();
        } else {
          this.hideGlow();
        }
      }
      return !!model;
    },

    cleanReply(reply, question) {
      return stripMarkdown(reply, question);
    },

    isAnalyticQuestion(q) {
      const s = String(q || "").toLowerCase();
      // Arabic + English minimal
      const kws = [
        "حلل", "تحليل", "إجمالي", "حسب", "مقارنة", "رسم", "بياني", "تقرير", "أظهر", "اعرض",
        "analyze", "analysis", "chart", "graph", "plot", "report", "by", "compare", "trend"
      ];
      return kws.some(k => s.includes(k.toLowerCase()));
    },

    userExplicitlyAskedForChart(q) {
      const s = String(q || "").toLowerCase();
      const kws = ["رسم", "بياني", "chart", "graph", "plot"];
      return kws.some(k => s.includes(k));
    },

    bindOnce() {
      if (this._bound) return;
      this._bound = true;

      const onChange = () => { this.applyFiltersAndRerender(); };

      const elType = document.getElementById("nxsFilterChartType");
      const elSort = document.getElementById("nxsFilterSort");
      const elTopN = document.getElementById("nxsFilterTopN");
      const elPct  = document.getElementById("nxsFilterPercent");

      if (elType) elType.addEventListener("change", onChange);
      if (elSort) elSort.addEventListener("change", onChange);
      if (elTopN) elTopN.addEventListener("change", onChange);
      if (elPct)  elPct.addEventListener("change", onChange);

      const btnReset = document.getElementById("nxsDashReset");
      if (btnReset) btnReset.addEventListener("click", () => {
        if (elType) elType.value = "auto";
        if (elSort) elSort.value = "none";
        if (elTopN) elTopN.value = "all";
        if (elPct)  elPct.checked = false;
        this.applyFiltersAndRerender();
      });

      const btnExport = document.getElementById("nxsDashExport");
      if (btnExport) btnExport.addEventListener("click", () => {
        this.exportCurrent();
      });

      // Compatibility: event-based payload delivery
      global.addEventListener("nxs:backend-payload", (ev) => {
        try {
          const d = ev && ev.detail ? ev.detail : {};
          this.ingest(d.payload, d.message, d.scope);
        } catch (_) {}
      });
    },

    openDrawer() {
      this.bindOnce();

      try {
        if (typeof global.openOapDashboardDrawer === "function") {
          global.openOapDashboardDrawer();
          return;
        }
      } catch (_) {}

      const drawer = document.getElementById("nxsDashboardDrawer");
      if (!drawer) return;
      drawer.classList.remove("nxs-hidden");
      document.body.classList.add("nxs-drawer-open");
    },

    clear() {
      const kpi = document.getElementById("nxsKpiGrid");
      const c1 = document.getElementById("nxsChartContainer");
      const c2 = document.getElementById("nxsChartSecondary");
      const t  = document.getElementById("nxsTableContainer");

      // Remove any dynamic chart cards created in previous renders
      const grid = document.querySelector(".nxs-charts-grid");
      if (grid) {
        const dyn = grid.querySelectorAll(".nxs-chart-card.nxs-chart-card-dynamic");
        dyn.forEach(el => { try { el.remove(); } catch (_) {} });
      }

      // Purge Plotly plots (prevents ghost charts / memory leaks)
      if (global.Plotly) {
        try { if (c1) global.Plotly.purge(c1); } catch (_) {}
        try { if (c2) global.Plotly.purge(c2); } catch (_) {}
      }

      if (kpi) kpi.innerHTML = "";
      if (c1) c1.innerHTML = "";
      if (c2) c2.innerHTML = "";
      if (t)  t.innerHTML = "";

      // Reset titles
      const pT = document.getElementById("nxsPrimaryTitle");
      const pM = document.getElementById("nxsPrimaryMeta");
      const sT = document.getElementById("nxsSecondaryTitle");
      const sM = document.getElementById("nxsSecondaryMeta");
      const tt = document.getElementById("nxsTableTitle");
      const ts = document.getElementById("nxsDashSummary");
      if (pT) pT.textContent = "—";
      if (pM) pM.textContent = "—";
      if (sT) sT.textContent = "—";
      if (sM) sM.textContent = "—";
      if (tt) tt.textContent = "—";
      if (ts) ts.textContent = "—";

      this.hideGlow();
    },

    renderEmptyNotice() {
      const c1 = document.getElementById("nxsChartContainer");
      if (!c1) return;
      c1.style.minHeight = "340px";
      c1.innerHTML = '<div style="opacity:.75;padding:18px;font-size:14px;">لا توجد بيانات رسم بياني لهذا السؤال (الخادم لم يُرجع بيانات visual).</div>';
    },

    exportCurrent() {
      const c1 = document.getElementById("nxsChartContainer");
      if (global.Plotly && c1 && c1.data) {
        try {
          global.Plotly.downloadImage(c1, { format: "png", filename: "oap_dashboard_chart" });
          return;
        } catch (_) {}
      }

      // fallback: export table as CSV
      const t = document.getElementById("nxsTableContainer");
      if (!t) return;
      const table = t.querySelector("table");
      if (!table) return;

      const rows = Array.from(table.querySelectorAll("tr")).map(tr =>
        Array.from(tr.querySelectorAll("th,td")).map(td => (td.textContent || "").replace(/\s+/g, " ").trim())
      );

      const csv = rows.map(r => r.map(x => '"' + x.replace(/"/g, '""') + '"').join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "oap_dashboard_table.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    applyFiltersAndRerender() {
      if (!this._lastModel) return;
      this.clear();
      this.openDrawer();
      this.render(this._lastModel, this.userExplicitlyAskedForChart(this._lastQuestion));
    },

    render(model, wantsChart) {
      this.bindOnce();

      // Rainbow glow if chart exists but user didn't ask explicitly
      if (!wantsChart) this.showGlow();
      else this.hideGlow();

      if (!model) return;

      if (model.kind === "viz") {
        this.renderFromViz(model.viz);
        return;
      }

      if (model.kind === "plotly") {
        this.renderFromVisualPayload(model.visual_payload);
        return;
      }

      if (model.kind === "table") {
        this.renderTable(model.table, null);
        return;
      }

      if (model.kind === "chart") {
        this.renderChart(model.chart);
        return;
      }
    },

    renderFromViz(vizObj) {
      const vpFree = _vizToVisualPayload(vizObj);
      if (vpFree && _renderFreeFromVisualPayload(vpFree)) return;
      // Adapter: unified viz -> legacy visual_payload widgets
      const viz = (vizObj && typeof vizObj === "object") ? vizObj : {};
      const vp = { widgets: [] };

      // KPIs
      const kpis = Array.isArray(viz.kpis) ? viz.kpis : [];
      if (kpis.length) {
        vp.widgets.push({
          id: "kpi-1",
          kind: "kpi",
          title: "KPIs",
          width_cols: 12,
          items: kpis.slice(0, 6).map((k) => ({
            label: String(k.title || k.label || k.name || "KPI"),
            value: (k.value ?? k.v ?? k.number ?? ""),
            unit: String(k.unit || "")
          }))
        });
      }

      // Charts
      const charts = Array.isArray(viz.charts) ? viz.charts : [];
      charts.forEach((c, i) => {
        if (!c || typeof c !== "object") return;
        const fig = (c.plotly && c.plotly.figure) ? c.plotly.figure : (c.figure && c.figure.data ? c.figure : null);
        if (!fig || !fig.data) return;
        vp.widgets.push({
          id: String(c.id || ("chart-" + (i + 1))),
          kind: "chart",
          title: String(c.title || c.name || ""),
          width_cols: Number(c.width_cols || 12),
          plotly: { figure: fig },
          meta: (c.meta && typeof c.meta === "object") ? c.meta : {}
        });
      });

      // Tables
      const tables = Array.isArray(viz.tables) ? viz.tables : [];
      tables.forEach((tb, i) => {
        if (!tb || typeof tb !== "object") return;
        let html = "";
        if (tb.html) html = String(tb.html);
        else if (tb.table_html) html = String(tb.table_html);
        else if (Array.isArray(tb.columns) && Array.isArray(tb.rows)) {
          try { html = buildTableHtml(tb.columns, tb.rows); } catch (_) { html = ""; }
        }
        if (!html) return;
        vp.widgets.push({
          id: String(tb.id || ("table-" + (i + 1))),
          kind: "table",
          title: String(tb.title || tb.name || "—"),
          width_cols: Number(tb.width_cols || 12),
          html,
          meta: (tb.meta && typeof tb.meta === "object") ? tb.meta : {}
        });
      });

      // Carry insights/actions (optional)
      if (viz.insights) vp.insights = viz.insights;
      if (viz.actions) vp.actions = viz.actions;

      // Render using existing pipeline
      this.renderFromVisualPayload(vp);

      // Summary line (existing DOM slot)
      const sumEl = document.getElementById("nxsDashSummary");
      if (sumEl) {
        const ins = Array.isArray(viz.insights) ? viz.insights : [];
        const act = Array.isArray(viz.actions) ? viz.actions : [];
        const insText = ins.slice(0, 2).map(x => (typeof x === "string") ? x : String((x && (x.text || x.title)) || "")).filter(Boolean).join(" • ");
        const actText = act.slice(0, 2).map(x => (typeof x === "string") ? x : String((x && (x.label || x.title || x.text)) || "")).filter(Boolean).join(" • ");
        const parts = [];
        if (insText) parts.push(insText);
        if (actText) parts.push(actText);
        sumEl.textContent = parts.length ? parts.join(" | ") : "—";
      }
    },

    renderFromVisualPayload(vp) {
      // Prefer free dashboard grid (dynamic layout) when available
      if (_renderFreeFromVisualPayload(vp)) return;
      // Reset dynamic cards (if any) to keep UI clean between questions
      const grid = document.querySelector(".nxs-charts-grid");
      if (grid) {
        const dyn = grid.querySelectorAll(".nxs-chart-card.nxs-chart-card-dynamic");
        dyn.forEach(el => { try { el.remove(); } catch (_) {} });
      }

      const widgets = (vp && Array.isArray(vp.widgets)) ? vp.widgets : [];
      const charts = [];
      const tables = [];
      const kpiItems = [];

      // Collect widgets
      for (const w of widgets) {
        if (!w || typeof w !== "object") continue;
        const kind = String(w.kind || w.type || "").toLowerCase();

        // KPI widget
        if ((kind === "kpi" || kind === "card") && Array.isArray(w.items)) {
          for (const it of w.items) {
            if (!it || typeof it !== "object") continue;
            kpiItems.push({ label: String(it.label || it.k || ""), value: (it.value ?? it.v ?? "") });
          }
          continue;
        }

        // Table widget
        if ((kind === "table" || kind === "data") && w.html) {
          tables.push({ title: String(w.title || "—"), html: String(w.html) });
          continue;
        }

        // Chart/Plotly widget
        if (kind === "chart" || kind === "plotly" || kind === "graph") {
          const fig = (w.plotly && w.plotly.figure) ? w.plotly.figure : (w.figure || (w.plotly && w.plotly.data ? w.plotly : null));
          if (fig && fig.data) {
            charts.push({
              title: String(w.title || w.name || ""),
              meta: w.meta || {},
              fig
            });
          }
        }
      }

      // Fallbacks (single-figure legacy)
      if (charts.length === 0) {
        let fig = null;
        if (vp && vp.plotly && vp.plotly.figure) fig = vp.plotly.figure;
        if (!fig && vp && vp.figure && vp.figure.data) fig = vp.figure;
        if (fig && fig.data) charts.push({ title: String(vp.title || ""), meta: vp.meta || {}, fig });
      }
      if (tables.length === 0 && vp && vp.table_html) {
        tables.push({ title: String(vp.table_title || "—"), html: String(vp.table_html) });
      }

      // Render KPIs
      const kpiGrid = document.getElementById("nxsKpiGrid");
      if (kpiGrid) {
        if (kpiItems.length) {
          kpiGrid.innerHTML = kpiItems.slice(0, 6).map(it => (
            '<div class="nxs-kpi-card">' +
              '<div class="nxs-kpi-title">' + escapeHtml(String(it.label || "—")) + '</div>' +
              '<div class="nxs-kpi-value">' + escapeHtml(String(it.value ?? "—")) + '</div>' +
            '</div>'
          )).join("");
        } else {
          kpiGrid.innerHTML = "";
        }
      }

      // Render charts (primary + secondary + extra dynamic)
      const targets = [
        { id: "nxsChartContainer", titleId: "nxsPrimaryTitle", metaId: "nxsPrimaryMeta" },
        { id: "nxsChartSecondary", titleId: "nxsSecondaryTitle", metaId: "nxsSecondaryMeta" }
      ];

      const setCardVisible = (targetId, visible) => {
        const el = document.getElementById(targetId);
        if (!el) return;
        const card = el.closest ? el.closest(".nxs-chart-card") : null;
        if (card) card.style.display = visible ? "" : "none";
      };

      // show/hide built-in cards based on chart count
      setCardVisible("nxsChartContainer", charts.length > 0);
      setCardVisible("nxsChartSecondary", charts.length > 1);

      const setHead = (titleId, metaId, title, metaObj) => {
        const t = document.getElementById(titleId);
        const m = document.getElementById(metaId);
        if (t) t.textContent = title || "—";
        if (m) {
          const rows = metaObj && (metaObj.rows || metaObj.n || metaObj.count);
          const ct = metaObj && (metaObj.chart_type || metaObj.type);
          const parts = [];
          if (ct) parts.push(String(ct));
          if (rows != null) parts.push("rows: " + String(rows));
          m.textContent = parts.length ? parts.join(" • ") : "—";
        }
      };

      // purge + render base targets
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const el = document.getElementById(target.id);
        if (global.Plotly && el) {
          try { global.Plotly.purge(el); } catch (_) {}
        }
        if (!charts[i]) continue;
        setHead(target.titleId, target.metaId, charts[i].title, charts[i].meta);
        this.plotly(target.id, charts[i].fig);
      }

      // Render extra charts dynamically (3+)
      if (grid && charts.length > 2) {
        for (let i = 2; i < charts.length; i++) {
          const cid = "nxsChartExtra_" + (i - 1);
          const card = document.createElement("div");
          card.className = "nxs-chart-card nxs-chart-card-dynamic";
          card.innerHTML =
            '<div class="nxs-chart-card-head">' +
              '<div class="nxs-chart-card-title">' + escapeHtml(charts[i].title || ("Chart " + (i + 1))) + '</div>' +
              '<div class="nxs-chart-card-meta">—</div>' +
            '</div>' +
            '<div id="' + cid + '" class="nxs-chart-area"></div>';
          grid.appendChild(card);
          this.plotly(cid, charts[i].fig);
        }
      }

      // Render table (first)
      const tableTitleEl = document.getElementById("nxsTableTitle");
      const tableEl = document.getElementById("nxsTableContainer");
      if (tables.length && tableEl) {
        if (tableTitleEl) tableTitleEl.textContent = tables[0].title || "—";
        tableEl.innerHTML = tables[0].html || "";
      } else if (tableEl) {
        if (tableTitleEl) tableTitleEl.textContent = "—";
        tableEl.innerHTML = "";
      }
    },

    renderChart(chart) {
      const elType = document.getElementById("nxsFilterChartType");
      const elSort = document.getElementById("nxsFilterSort");
      const elTopN = document.getElementById("nxsFilterTopN");
      const elPct  = document.getElementById("nxsFilterPercent");

      const forcedType = elType ? String(elType.value || "auto") : "auto";
      const sortMode   = elSort ? String(elSort.value || "none") : "none";
      const topNVal    = elTopN ? String(elTopN.value || "all") : "all";
      const showPct    = !!(elPct && elPct.checked);

      let type = String((chart.type || "bar")).toLowerCase();
      if (forcedType !== "auto") type = forcedType;

      let labels = Array.isArray(chart.labels) ? chart.labels.map(String) : [];
      labels = translateKnownLabelsIfArabic(labels, this._lastQuestion);

      let ds = Array.isArray(chart.datasets) ? chart.datasets : [];
      if (!ds.length) ds = [{ label: "", data: [] }];

      // Use first dataset for filtering & table (simple, fast)
      const base = ds[0];
      let values = Array.isArray(base.data) ? base.data.map(normalizeNumber) : [];

      // Build rows
      const rows = labels.map((lab, i) => ({ label: lab, value: values[i] ?? 0 }));
      const total = rows.reduce((a, r) => a + (Number(r.value) || 0), 0);

      // Sort
      if (sortMode === "asc") rows.sort((a,b) => a.value - b.value);
      if (sortMode === "desc") rows.sort((a,b) => b.value - a.value);

      // Top N
      const n = (topNVal === "all") ? rows.length : clamp(parseInt(topNVal,10) || rows.length, 1, rows.length);
      const sliced = rows.slice(0, n);

      const x = sliced.map(r => r.label);
      const yRaw = sliced.map(r => r.value);

      const y = showPct && total > 0 ? yRaw.map(v => (v * 100) / total) : yRaw;
      const text = showPct && total > 0 ? yRaw.map(v => fmtPercent((v*100)/total)) : yRaw.map(v => fmtNumber(v));

      // KPI cards
      this.renderKpis({ total, rows: sliced, unit: base.unit || "" }, showPct);

      // Primary chart
      const title = String(chart.title || "تحليل البيانات");
      const fig = this.buildFigure(type, title, x, y, text, showPct);
      this.plotly("nxsChartContainer", fig);

      // Secondary: if not pie, show pie distribution; if pie, show bar
      const secType = (type === "pie") ? "bar" : "pie";
      const secFig = this.buildSecondary(secType, title, x, yRaw, total);
      if (secFig) this.plotly("nxsChartSecondary", secFig);

      // Table under charts
      this.renderTableFromSeries(x, yRaw, total, base.unit || "");
    },

    buildFigure(type, title, x, y, text, showPct) {
      const tc = getTextColor();
      const grid = getBorderColor();
      const bg = getBgColor();

      if (type === "pie") {
        return {
          data: [{
            type: "pie",
            labels: x,
            values: y,
            textinfo: "label+percent",
            hoverinfo: "label+value+percent"
          }],
          layout: {
            title: { text: title, font: { color: tc } },
            paper_bgcolor: bg,
            plot_bgcolor: bg,
            font: { color: tc },
            margin: { t: 55, r: 20, l: 20, b: 20 },
            height: 380
          }
        };
      }

      const trace = (type === "line")
        ? { type: "scatter", mode: "lines+markers+text", x, y, text, textposition: "top center" }
        : { type: "bar", x, y, text, textposition: "outside", cliponaxis: false };

      return {
        data: [trace],
        layout: {
          title: { text: title, font: { color: tc } },
          paper_bgcolor: bg,
          plot_bgcolor: bg,
          font: { color: tc },
          margin: { t: 55, r: 20, l: 55, b: 80 },
          height: 420,
          xaxis: { tickangle: -20, gridcolor: grid, linecolor: grid, zerolinecolor: grid, automargin: true },
          yaxis: { gridcolor: grid, linecolor: grid, zerolinecolor: grid, automargin: true, ticksuffix: showPct ? "%" : "" }
        }
      };
    },

    buildSecondary(type, title, x, yRaw, total) {
      const tc = getTextColor();
      const bg = getBgColor();

      if (!x.length) return null;

      if (type === "pie") {
        return {
          data: [{
            type: "pie",
            labels: x,
            values: yRaw,
            textinfo: "label+percent",
            hoverinfo: "label+value+percent"
          }],
          layout: {
            title: { text: "التوزيع النسبي", font: { color: tc } },
            paper_bgcolor: bg,
            plot_bgcolor: bg,
            font: { color: tc },
            margin: { t: 55, r: 20, l: 20, b: 20 },
            height: 380
          }
        };
      }

      // bar secondary
      return {
        data: [{
          type: "bar",
          x,
          y: yRaw,
          text: yRaw.map(v => fmtNumber(v)),
          textposition: "outside",
          cliponaxis: false
        }],
        layout: {
          title: { text: "القيم الفعلية", font: { color: tc } },
          paper_bgcolor: bg,
          plot_bgcolor: bg,
          font: { color: tc },
          margin: { t: 55, r: 20, l: 55, b: 80 },
          height: 420
        }
      };
    },

    plotly(targetId, fig) {
      const el = document.getElementById(targetId);
      if (!el) return;

      el.style.minHeight = "340px";

      if (!global.Plotly) {
        el.innerHTML = '<div style="opacity:.75;padding:18px;font-size:14px;">Plotly غير محمّل في الصفحة.</div>';
        return;
      }

      const cfg = { responsive: true, displayModeBar: false };
      try {
        global.Plotly.newPlot(el, fig.data || [], fig.layout || {}, cfg);
      } catch (e) {
        console.error("Plotly render error", e);
        el.innerHTML = '<div style="opacity:.75;padding:18px;font-size:14px;">تعذر عرض الرسم البياني.</div>';
      }
    },

    renderKpis(info, showPct) {
      const grid = document.getElementById("nxsKpiGrid");
      if (!grid) return;

      const total = Number(info.total) || 0;
      const rows = Array.isArray(info.rows) ? info.rows : [];
      const unit = String(info.unit || "");

      let maxRow = null;
      rows.forEach(r => {
        if (!maxRow || (Number(r.value)||0) > (Number(maxRow.value)||0)) maxRow = r;
      });

      const avg = rows.length ? (total / rows.length) : 0;

      const cards = [
        { k: "الإجمالي", v: fmtNumber(total) },
        { k: "المتوسط", v: fmtNumber(avg) },
        { k: "الأعلى", v: maxRow ? (maxRow.label + " • " + fmtNumber(maxRow.value)) : "—" },
        { k: "عدد العناصر", v: String(rows.length) }
      ];

      // If unit is minutes, show hh:mm hint in total card (deterministic: only if unit mentions minutes)
      const u = unit.toLowerCase();
      if (u.includes("min") || u.includes("دقيقة") || u.includes("minute")) {
        cards[0].v = fmtNumber(total) + " دقيقة • " + fmtMinutesToHHMM(total);
      }

      grid.innerHTML = cards.map(c => (
        '<div class="nxs-kpi-card">' +
          '<div class="nxs-kpi-title">' + escapeHtml(c.k) + '</div>' +
          '<div class="nxs-kpi-value">' + escapeHtml(c.v) + '</div>' +
        '</div>'
      )).join("");
    },

    renderTableFromSeries(labels, values, total, unit) {
      const t = document.getElementById("nxsTableContainer");
      if (!t) return;

      const showPct = !!(document.getElementById("nxsFilterPercent") && document.getElementById("nxsFilterPercent").checked);
      const isMin = String(unit || "").toLowerCase().includes("min") || String(unit || "").includes("دقيقة");

      const rows = labels.map((lab, i) => {
        const v = Number(values[i] || 0);
        const pct = total > 0 ? (v * 100) / total : 0;
        const valText = isMin ? (fmtNumber(v) + " • " + fmtMinutesToHHMM(v)) : fmtNumber(v);
        return [lab, valText, fmtPercent(pct)];
      });

      const head = ['الفئة', 'القيمة', 'النسبة'];
      t.innerHTML = buildTableHtml(head, rows);
    },

    renderTable(tableObj, fallback) {
      const t = document.getElementById("nxsTableContainer");
      if (!t) return;

      if (tableObj && tableObj.html) {
        t.innerHTML = String(tableObj.html);
        return;
      }
      const cols = (tableObj && Array.isArray(tableObj.columns)) ? tableObj.columns : ["—"];
      const rows = (tableObj && Array.isArray(tableObj.rows)) ? tableObj.rows : [];
      t.innerHTML = buildTableHtml(cols, rows);
    },

    showGlow() {
      const g = document.getElementById("nxsDashboardGlow");
      if (!g) return;
      g.classList.add("nxs-glow-on");
      g.style.display = "block";
    },

    hideGlow() {
      const g = document.getElementById("nxsDashboardGlow");
      if (!g) return;
      g.classList.remove("nxs-glow-on");
      g.style.display = "none";
    }
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function buildTableHtml(columns, rows) {
    const tc = getTextColor();
    const border = getBorderColor();

    const cols = (columns || []).map(c => '<th style="text-align:right;padding:10px;border-bottom:1px solid '+border+';">'+escapeHtml(c)+'</th>').join("");
    const body = (rows || []).map(r => {
      const cells = (r || []).map(c => '<td style="text-align:right;padding:10px;border-bottom:1px solid '+border+';opacity:.95;">'+escapeHtml(c)+'</td>').join("");
      return "<tr>" + cells + "</tr>";
    }).join("");

    return (
      '<div style="overflow:auto;max-height:420px;">' +
        '<table style="width:100%;border-collapse:collapse;color:'+tc+';font-size:13px;">' +
          "<thead><tr>" + cols + "</tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</div>"
    );
  }

  // Expose
  global.NXSDashboardRenderer = Renderer;

})(window);

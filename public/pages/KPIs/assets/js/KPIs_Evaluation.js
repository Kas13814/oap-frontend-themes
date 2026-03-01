// KPIs Evaluation — Professional UI (Results Drawer on the right)
(() => {
  "use strict";

  const API_BASE = (window.OAP_EVAL_API_BASE || "").replace(/\/+$/, "");
  const apiUrl = (path) => (API_BASE ? `${API_BASE}${path}` : path);

  const $ = (id) => document.getElementById(id);

  const state = {
    lastResult: null,
    roleValuesCacheKey: "",
  };

  const normalizeId = (s) => String(s || "").trim().replace(/[^\d]/g, "");

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");

  // ---------------- Theme ----------------
  function setTheme(theme){
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("KPIs_THEME", theme);
    const btn = $("btnTheme");
    if(btn){
      btn.querySelector(".icon").textContent = theme === "dark" ? "☀️" : "🌙";
      btn.title = theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن";
    }
  }
  function initTheme(){
    const saved = localStorage.getItem("KPIs_THEME");
    setTheme(saved === "light" ? "light" : "dark");
  }

  // ---------------- Overlay + Drawers ----------------
  let openDrawerName = null; // "settings" | "results"

  function openOverlay(){
    $("overlay").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeOverlay(){
    $("overlay").hidden = true;
    document.body.style.overflow = "";
  }

  function openSettings(){
    openDrawerName = "settings";
    $("drawer").classList.add("is-open");
    $("drawer").setAttribute("aria-hidden","false");
    $("resultsDrawer").classList.remove("is-open");
    $("resultsDrawer").setAttribute("aria-hidden","true");
    openOverlay();
  }
  function closeSettings(){
    $("drawer").classList.remove("is-open");
    $("drawer").setAttribute("aria-hidden","true");
    if(openDrawerName === "settings"){
      openDrawerName = null;
      closeOverlay();
    }
  }

  function openResults(){
    openDrawerName = "results";
    $("resultsDrawer").classList.add("is-open");
    $("resultsDrawer").setAttribute("aria-hidden","false");
    $("drawer").classList.remove("is-open");
    $("drawer").setAttribute("aria-hidden","true");
    openOverlay();
  }
  function closeResults(){
    $("resultsDrawer").classList.remove("is-open");
    $("resultsDrawer").setAttribute("aria-hidden","true");
    if(openDrawerName === "results"){
      openDrawerName = null;
      closeOverlay();
    }
  }

  function closeAnyDrawer(){
    closeSettings();
    closeResults();
  }

  // ---------------- Quotas ----------------
  function setHint(){
    const e = +$("pctE").value || 0;
    const m = +$("pctM").value || 0;
    const p = +$("pctP").value || 0;
    const i = +$("pctI").value || 0;
    const sum = e+m+p+i;
    const ok = sum === 100;
    $("pctHint").textContent = ok ? `مجموع النسب = ${sum}% ✅` : `مجموع النسب = ${sum}% (يجب = 100%)`;
    $("pctHint").style.color = ok ? "rgba(46,229,157,.95)" : "rgba(255,90,90,.95)";
    return ok;
  }

  // ---------------- Period ----------------
  function fillPeriodValue(){
    const t = $("periodType").value;
    const sel = $("periodValue");
    sel.innerHTML = "";
    const wrap = $("periodValueWrap");

    if(t === "quarter"){
      $("periodValueLabel").textContent = "Quarter";
      wrap.style.display = "block";
      ["Q1","Q2","Q3","Q4"].forEach((q, idx) => {
        const o = document.createElement("option");
        o.value = String(idx+1);
        o.textContent = q;
        sel.appendChild(o);
      });
    } else if(t === "half"){
      $("periodValueLabel").textContent = "Half";
      wrap.style.display = "block";
      ["H1 (Jan–Jun)","H2 (Jul–Dec)"].forEach((h, idx) => {
        const o = document.createElement("option");
        o.value = String(idx+1);
        o.textContent = h;
        sel.appendChild(o);
      });
    } else {
      wrap.style.display = "none";
    }
  }

  // ---------------- Roles ----------------
  function selectedRoles(){
    const items = document.querySelectorAll("#roleList input[type=checkbox]");
    const out = [];
    items.forEach(ch => { if(ch.checked) out.push(ch.value); });
    return out;
  }

  function renderRoleList(values){
    const list = $("roleList");
    list.innerHTML = "";
    const q = $("roleSearch").value.trim().toLowerCase();
    values
      .filter(v => String(v||"").toLowerCase().includes(q))
      .forEach(v => {
        const row = document.createElement("label");
        row.className = "role-item";
        row.innerHTML = `<input type="checkbox" value="${escapeHtml(v)}" checked /><span>${escapeHtml(v)}</span>`;
        list.appendChild(row);
      });
  }

  async function fetchRoleValues(force=false){
    const roleField = $("roleField").value;
    const key = `roleField:${roleField}`;
    if(!force && state.roleValuesCacheKey === key && $("roleList").children.length){
      return;
    }
    state.roleValuesCacheKey = key;

    $("btnRoleRefresh").disabled = true;
    try{
      const r = await fetch(apiUrl(`/api/eval/options?role_field=${encodeURIComponent(roleField)}`), { credentials:"include" });
      const j = await r.json();
      if(!r.ok) throw new Error(j?.detail || "Failed to load role values");
      renderRoleList(j.values || []);
    } finally {
      $("btnRoleRefresh").disabled = false;
    }
  }

  // ---------------- Results render ----------------
  function setButtonsEnabled(){
    const has = !!state.lastResult;
    $("btnApprove").disabled = !has;
    $("btnPrint").disabled = !has;
    $("btnAsk").disabled = !has;
    $("roleDropdown").disabled = !has;
    $("btnStartResults").disabled = !has;
  }

  function fillRoleDropdownFromResults(rows){
    const sel = $("roleDropdown");
    const roles = new Set();
    rows.forEach(r => roles.add(r.role_value || "—"));
    const arr = Array.from(roles).sort((a,b)=>String(a).localeCompare(String(b)));
    sel.innerHTML = `<option value="">كل المسميات</option>` +
      arr.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  }

  function fillTable(bucket, rows){
    const tbody = document.querySelector(`#table${bucket} tbody`);
    tbody.innerHTML = "";
    rows.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(r.employee_id)}</td>
        <td>${escapeHtml(r.employee_name)}</td>
        <td>${escapeHtml(r.role_value)}</td>
        <td>${escapeHtml(r.kpis?.absences ?? 0)}</td>
        <td>${escapeHtml(r.kpis?.delay_minutes ?? 0)}</td>
        <td>${escapeHtml(r.kpis?.flight_incidents ?? 0)}</td>
        <td>${escapeHtml(r.kpis?.sick_days ?? 0)}</td>
        <td>${escapeHtml(r.kpis?.overtime_hours ?? 0)}</td>
        <td>${escapeHtml(r.kpis?.operational_events ?? 0)}</td>
        <td>${escapeHtml((r.score ?? 0).toFixed ? r.score.toFixed(3) : r.score)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderTables(rows){
    const buckets = { E:[], M:[], P:[], I:[] };
    rows.forEach(r => { buckets[r.rating]?.push(r); });
    for(const k of Object.keys(buckets)){
      buckets[k].sort((a,b) => (b.score ?? 0) - (a.score ?? 0));
    }
    fillTable("E", buckets.E);
    fillTable("M", buckets.M);
    fillTable("P", buckets.P);
    fillTable("I", buckets.I);

    $("countE").textContent = `عدد الموظفين: ${buckets.E.length}`;
    $("countM").textContent = `عدد الموظفين: ${buckets.M.length}`;
    $("countP").textContent = `عدد الموظفين: ${buckets.P.length}`;
    $("countI").textContent = `عدد الموظفين: ${buckets.I.length}`;
  }

  function applyFiltersAndRender(){
    if(!state.lastResult) return;
    const rows = state.lastResult.rows || [];
    const roleFilter = $("roleDropdown").value;
    const empFilter = normalizeId($("empSearch").value);

    const filtered = rows.filter(r => {
      const okRole = !roleFilter || (String(r.role_value||"") === roleFilter);
      const okEmp  = !empFilter  || normalizeId(r.employee_id) === empFilter;
      return okRole && okEmp;
    });

    renderTables(filtered);
  }

  function buildRequestPayload(){
    const year = +$("year").value;
    const period_type = $("periodType").value;
    const period_value = (period_type === "year") ? null : +$("periodValue").value;
    const role_field = $("roleField").value;
    const roles = selectedRoles();
    const quotas = { E:+$("pctE").value, M:+$("pctM").value, P:+$("pctP").value, I:+$("pctI").value };
    return { year, period_type, period_value, role_field, roles, quotas };
  }

  // ---------------- Actions ----------------
  async function calc(){
    if(!setHint()) return alert("مجموع النسب يجب أن يساوي 100%");
    const payload = buildRequestPayload();

    $("btnCalc").disabled = true;
    $("askReply").textContent = "—";
    try{
      const r = await fetch(apiUrl("/api/eval/calc"), {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        credentials:"include",
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j?.detail || "Calculation failed");

      state.lastResult = j;
      setButtonsEnabled();
      fillRoleDropdownFromResults(j.rows || []);
      applyFiltersAndRender();

      // Update meta line in results drawer
      const meta = j.meta || {};
      const period = meta.period_label ?? "—";
      const total = meta.total_employees ?? "—";
      const batch = meta.batch_id ? ` • Batch: ${meta.batch_id}` : "";
      $("resultsMeta").textContent = `Period: ${period} • Total: ${total}${batch}`;

      // hide empty state
      $("emptyState").style.display = "none";

      // open results panel (right)
      openResults();
    } catch(err){
      console.error(err);
      alert(String(err.message || err));
    } finally {
      $("btnCalc").disabled = false;
    }
  }

  async function approve(){
    if(!state.lastResult) return;
    const payload = buildRequestPayload();

    $("btnApprove").disabled = true;
    try{
      const r = await fetch(apiUrl("/api/eval/approve"), {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        credentials:"include",
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j?.detail || "Approve failed");

      state.lastResult = j;
      setButtonsEnabled();
      fillRoleDropdownFromResults(j.rows || []);
      applyFiltersAndRender();
      alert("تم اعتماد وحفظ التقييمات ✅");
    } catch(err){
      console.error(err);
      alert(String(err.message || err));
    } finally {
      $("btnApprove").disabled = false;
    }
  }

  async function ask(){
    const q = $("askText").value.trim();
    if(!q) return;

    if(!state.lastResult){
      $("askReply").textContent = "افتح الإعدادات ثم ولّد التقييم أولاً، بعدها اسأل عن الأسباب.";
      return;
    }

    $("btnAsk").disabled = true;
    $("askReply").textContent = "جارٍ التحليل…";
    try{
      const payload = {
        question: q,
        meta: state.lastResult.meta || {},
        sample: (state.lastResult.rows || []).slice(0, 250)
      };
      const r = await fetch(apiUrl("/api/eval/ask"), {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        credentials:"include",
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j?.detail || "Ask failed");
      $("askReply").textContent = j.reply || "—";
    } catch(err){
      console.error(err);
      $("askReply").textContent = "حدث خطأ.";
      alert(String(err.message || err));
    } finally {
      $("btnAsk").disabled = false;
    }
  }

  // ---------------- Init ----------------
  function init(){
    initTheme();

    $("year").value = String(new Date().getFullYear());
    setHint();
    fillPeriodValue();
    fetchRoleValues(true).catch(console.error);
    setButtonsEnabled();

    // Theme
    $("btnTheme").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      setTheme(cur === "dark" ? "light" : "dark");
    });

    // Openers
    $("btnOpenDrawer").addEventListener("click", openSettings);
    $("btnOpenDrawer2").addEventListener("click", openSettings);
    $("btnStart").addEventListener("click", openSettings);

    $("btnOpenResults").addEventListener("click", () => {
      if(state.lastResult) openResults();
    });
    $("btnStartResults").addEventListener("click", () => {
      if(state.lastResult) openResults();
    });

    // Closers
    $("btnCloseDrawer").addEventListener("click", closeSettings);
    $("btnCloseResults").addEventListener("click", closeResults);

    $("overlay").addEventListener("click", closeAnyDrawer);
    document.addEventListener("keydown", (e) => { if(e.key === "Escape") closeAnyDrawer(); });

    // Quotas
    ["pctE","pctM","pctP","pctI"].forEach(id => $(id).addEventListener("input", setHint));

    // Period
    $("periodType").addEventListener("change", fillPeriodValue);

    // Role values
    $("roleField").addEventListener("change", () => fetchRoleValues(true));
    $("roleSearch").addEventListener("input", () => fetchRoleValues(false).catch(console.error));
    $("btnRoleRefresh").addEventListener("click", () => fetchRoleValues(true));
    $("btnRoleAll").addEventListener("click", () => document.querySelectorAll("#roleList input[type=checkbox]").forEach(ch => ch.checked = true));
    $("btnRoleNone").addEventListener("click", () => document.querySelectorAll("#roleList input[type=checkbox]").forEach(ch => ch.checked = false));

    // Actions
    $("btnCalc").addEventListener("click", calc);
    $("btnApprove").addEventListener("click", approve);
    $("btnPrint").addEventListener("click", () => window.print());

    // Ask
    $("btnAsk").addEventListener("click", ask);

    // Filters
    $("roleDropdown").addEventListener("change", applyFiltersAndRender);
    $("empSearch").addEventListener("input", applyFiltersAndRender);
  }

  document.addEventListener("DOMContentLoaded", init);
})();

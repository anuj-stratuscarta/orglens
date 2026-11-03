// OrgLens — Home + Live Logs page
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const st = Object.assign(
    { tab: document.body.dataset.tab || 'home', f: { q: '', status: '', user: '', op: '', minDur: '', range: '' }, sort: { k: 'start', dir: -1 } },
    vscode.getState() || {}
  );
  let S = null;
  let built = false;
  const checked = new Set();
  const seenRows = new Set();
  const post = (m) => vscode.postMessage(m);
  const save = () => vscode.setState(st);
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const size = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(1) + ' KB');
  const dur = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : ms + ' ms');
  const when = (iso) => {
    const d = new Date(iso);
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    const today = d.toDateString() === new Date().toDateString();
    return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const I = {
    logo: '<svg viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="3" rx="1" fill="#5b8def"/><rect x="2" y="6.5" width="8" height="3" rx="1" fill="#3fb27f"/><rect x="11" y="6.5" width="3.5" height="3" rx="1" fill="#e3a73b"/><rect x="3" y="11" width="4" height="3" rx="1" fill="#e26d5a"/></svg>',
    live: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="7" r="1.6" fill="currentColor"/><path d="M5.2 4.2a4 4 0 0 0 0 5.6M10.8 4.2a4 4 0 0 1 0 5.6M3.3 2.3a6.7 6.7 0 0 0 0 9.4M12.7 2.3a6.7 6.7 0 0 1 0 9.4M8 9v5.5"/></svg>',
    refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>',
    filter: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 3h12l-4.5 5.5V13l-3 1.5v-6z"/></svg>',
    record: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>',
    play: '<svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>',
    file: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z"/><path d="M9.5 1.5V5H13M5.5 8.5h5M5.5 11h3"/></svg>',
    trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v5M9.2 6.5v5"/></svg>',
    cloud: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4.5 12.5h7.2a3 3 0 0 0 .3-6 4 4 0 0 0-7.7-.9A3.4 3.4 0 0 0 4.5 12.5z"/></svg>',
    user: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="6.5" cy="5" r="2.7"/><path d="M1.5 14c.5-2.8 2.5-4.3 5-4.3s4.5 1.5 5 4.3M13 5v4M11 7h4"/></svg>',
    home: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 7.5 8 2.5l6 5M3.5 6.5v7h3.5v-4h2v4h3.5v-7"/></svg>',
    list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.5" cy="4" r=".8" fill="currentColor"/><circle cx="2.5" cy="8" r=".8" fill="currentColor"/><circle cx="2.5" cy="12" r=".8" fill="currentColor"/></svg>',
    graph: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="3" rx="1"/><rect x="2" y="6.5" width="7" height="3" rx="1"/><rect x="10" y="6.5" width="4" height="3" rx="1"/><rect x="3" y="11" width="3" height="3" rx="1"/></svg>',
    raw: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 3.5h11M2.5 6.5h8M2.5 9.5h11M2.5 12.5h6"/></svg>',
    help: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.2a1.9 1.9 0 0 1 3.7.5c0 1.3-1.9 1.6-1.9 2.8"/><circle cx="8" cy="11.6" r=".5" fill="currentColor"/></svg>',
    db: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><ellipse cx="8" cy="3.8" rx="5.5" ry="2.2"/><path d="M2.5 3.8v8.4c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V3.8M2.5 8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2"/></svg>',
    gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
    clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',
    bot: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="5" width="11" height="8" rx="2"/><path d="M8 2.5V5M5.5 9h.01M10.5 9h.01" stroke-linecap="round" stroke-width="2"/></svg>',
    code: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4"/></svg>',
    download: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11"/></svg>',
    copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>',
    star: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>',
    ext: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h3.5"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5 5 11.5 10 5M8 11.5l.5.5L14 5"/></svg>',
  };

  const TIPS = {
    'Live tail': 'Turns on the background watcher: every few seconds it checks the org for new debug logs, adds them to Live Logs with a NEW tag and notifies you. Needs an active trace flag to produce logs.',
    'Stop live tail': 'Stop the background watcher. Logs already listed stay; use Refresh to update the list manually.',
    'Live Logs': 'Open the list of debug logs. Search, filter by status/user/operation/time/duration, sort columns, multi-select. Click a row to analyze it, Ctrl+click for the raw log.',
    'Refresh': 'Fetch the latest list of logs from the org once (does not turn on live tail).',
    'Start tracing': 'Create a trace flag for your own user so Salesforce starts writing debug logs. You choose the debug level (Analysis is best for performance) and duration (max 24 h).',
    'Stop tracing': 'Remove your trace flag. Salesforce stops writing new logs for you; existing logs are kept.',
    'Trace flags': 'Manage logging for anyone: other users, Automated Process (platform events, async flows), guest/site users, integration users, or specific Apex classes and triggers. Also create and edit debug levels.',
    'SOQL explorer': 'Salesforce Inspector-style query tool: object & field browser, autocomplete, Ctrl+Enter to run, results grid with record view, CSV/JSON export, history and saved queries.',
    'Org setup': 'See which Setup settings are enabled or disabled (searchable across all settings pages), org limits, installed packages, licenses, your permission sets and the setup audit trail.',
    'Filter logs': 'Jump to Live Logs with the search box focused. Combine text search with status, user, operation, time-range and minimum-duration filters.',
    'Search inside logs': 'Full-text (or /regex/) search through the contents of the listed logs — e.g. an exception message or record Id — then jump straight to the matching line.',
    'Execute anonymous': 'Run Apex (selected code, a .apex file, or typed in) against the org and open its debug log in the analyzer immediately. Shortcut: Ctrl+Alt+E in an Apex editor.',
    'Analyze local file': 'Open any Apex debug log saved on disk (e.g. downloaded from Setup or shared by a colleague) in the analyzer.',
    'REST explorer': 'Postman/Workbench-style tester for any Salesforce REST endpoint: choose method and path, add headers and a JSON body, send with Ctrl+Enter, and read the response as a collapsible JSON tree, raw text or headers. History, saved requests and copy-as-cURL included.',
    'Delete logs': 'Bulk-delete debug logs from the org: just yours, the ones currently shown, or all logs. Asks for confirmation first.',
  };

  // floating help tips for anything with data-tip
  const tipEl = document.createElement('div');
  tipEl.className = 'htip';
  document.body.appendChild(tipEl);
  let tipTimer;
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t || !t.dataset.tip) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tipEl.textContent = t.dataset.tip;
      tipEl.classList.add('show');
      const r = t.getBoundingClientRect();
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - 8) top = r.top - h - 8;
      tipEl.style.left = left + 'px';
      tipEl.style.top = top + 'px';
    }, 350);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t && !t.contains(e.relatedTarget)) { clearTimeout(tipTimer); tipEl.classList.remove('show'); }
  });
  document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tipEl.classList.remove('show'); });

  // request/response channel to the extension
  let reqSeq = 0;
  const pending = new Map();
  const call = (op, args) =>
    new Promise((res, rej) => {
      const reqId = ++reqSeq;
      pending.set(reqId, { res, rej });
      post({ cmd: 'api', reqId, op, args });
    });

  let toastTimer;
  function toast(msg, kind = 'info') {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.className = 'toast show ' + kind;
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 7000 : 3000);
  }

  const pages = {};
  const pageBuilt = {};
  const stateHooks = [];
  window.SFLS = { call, post, esc, I, toast, pages, onState: (fn) => stateHooks.push(fn), getState: () => S, run: (id, args) => post({ cmd: 'run', id, args }), when, setTab: (t) => setTab(t) };

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      S = m.state;
      render();
      stateHooks.forEach((fn) => { try { fn(S); } catch (err) { console.error(err); } });
    } else if (m.type === 'tab') setTab(m.tab);
    else if (m.type === 'api') {
      const p = pending.get(m.reqId);
      if (!p) return;
      pending.delete(m.reqId);
      m.error ? p.rej(new Error(m.error)) : p.res(m.result);
    }
  });
  // wait until trace.js / soql.js have registered their pages
  if (document.readyState === 'complete') setTimeout(() => post({ cmd: 'ready' }), 0);
  else window.addEventListener('load', () => post({ cmd: 'ready' }));

  const run = (id, args) => post({ cmd: 'run', id, args });

  function setTab(t) {
    if (!document.getElementById('p-' + t)) t = 'home';
    st.tab = t;
    save();
    document.querySelectorAll('.s-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'p-' + t));
    const pageEl = document.getElementById('p-' + t);
    if (pages[t] && !pageBuilt[t]) {
      if (S && (S.org || pages[t].noOrg)) {
        pageBuilt[t] = true;
        pages[t].build(pageEl);
      } else {
        pageEl.innerHTML = `<div class="empty">${S && S.connecting ? `<span class="spinner sm"></span> Connecting to ${esc(S.connecting)}…` : 'Select an org first.'}</div>`;
      }
    } else if (pages[t] && pages[t].shown) pages[t].shown();
  }

  function buildShell() {
    app.innerHTML = `
      <div class="s-hdr">
        <div class="brand">${I.logo}OrgLens</div>
        <button class="pill" id="orgPill" data-tip="The Salesforce org you're connected to. Click to switch to another org authorized in the sf CLI."></button>
        <button class="pill" id="tracePill" data-tip="Debug logging status for your user. Salesforce only writes logs while a trace flag is active. Click to start, extend or change it."></button>
        <button class="pill" id="livePill" data-tip="Live tail status. When Live, the extension checks the org every few seconds and adds new logs to Live Logs automatically. Click to toggle."></button>
        <div style="flex:1"></div>
        <nav class="s-tabs">
          <button data-tab="home" data-tip="Dashboard: org & tracing status, quick actions, latest logs and failures.">${I.home}Home</button>
          <button data-tab="logs" data-tip="The full list of debug logs — search, filter, sort, select. Updates by itself while live tail is on.">${I.list}Live Logs <span class="count" id="logCount">0</span></button>
          <button data-tab="trace" data-tip="Who gets logged and at what detail: trace flags for users, Automated Process, guests, Apex classes; debug levels.">${I.record}Trace Flags</button>
          <button data-tab="soql" data-tip="Inspector-style query tool: browse objects & fields, run SOQL with autocomplete, view and export records.">${I.db}SOQL</button>
          <button data-tab="rest" data-tip="Call any Salesforce REST API (GET/POST/PATCH/PUT/DELETE) with a JSON body and see the response as a collapsible JSON tree, raw text and headers.">${I.ext}REST</button>
          <button data-tab="org" data-tip="Read-only view of org settings (enabled/disabled), limits, packages, licenses, your access and the audit trail.">${I.gear}Org Setup</button>
          <button data-tab="guide" data-tip="How to use OrgLens: features, workflows, shortcuts and troubleshooting.">${I.help}Guide</button>
        </nav>
      </div>
      <div class="page" id="p-home"></div>
      <div class="page" id="p-org"></div>
      <div class="page" id="p-guide"></div>
      <div class="page" id="p-rest"></div>
      <div class="page" id="p-trace"></div>
      <div class="page" id="p-soql"></div>
      <div class="page" id="p-logs">
        <div class="lt-bar">
          <button class="btn" id="ltLive"></button>
          <button class="btn" id="ltRefresh" title="Refresh">${I.refresh}</button>
          <input class="search" id="fq" placeholder="Search operation, user, request, id…">
          <select id="fstatus"><option value="">All statuses</option><option value="ok">Success</option><option value="bad">Failed</option></select>
          <select id="fuser"><option value="">All users</option></select>
          <select id="fop"><option value="">All operations</option></select>
          <select id="frange"><option value="">Any time</option><option value="15">Last 15 min</option><option value="60">Last hour</option><option value="1440">Last 24 h</option></select>
          <input type="number" id="fmin" min="0" placeholder="Min ms" style="width:84px">
          <label class="muted" style="display:flex;gap:5px;align-items:center;font-size:12px"><input type="checkbox" id="fmine">Only mine</label>
          <button class="btn sm" id="fclear">Clear</button>
        </div>
        <div class="lt-sub">
          <span id="ltCount"></span>
          <span class="sel-acts" id="selActs"><b id="selN"></b> selected
            <button class="btn sm" id="selOpen">${I.graph} Analyze</button>
            <button class="btn sm" id="selDel">${I.trash} Delete</button>
            <button class="btn sm" id="selNone">Clear selection</button></span>
          <span style="flex:1"></span>
          <span>Click a row to analyze · <span class="kbd">Ctrl</span>+click for raw log</span>
        </div>
        <div class="lt-wrap" id="ltWrap"></div>
      </div>`;
    $('.s-tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };
    $('#orgPill').onclick = () => run('orglens.selectOrg');
    $('#tracePill').onclick = () => run(S.tracing ? 'orglens.startTrace' : 'orglens.startTrace');
    $('#livePill').onclick = toggleLive;
    $('#ltLive').onclick = toggleLive;
    $('#ltRefresh').onclick = () => run('orglens.refresh');
    const bind = (id, key, ev = 'input') => {
      const el = $(id);
      el.value = st.f[key] || '';
      el.addEventListener(ev, () => { st.f[key] = el.value; save(); drawTable(); });
    };
    bind('#fq', 'q');
    bind('#fstatus', 'status', 'change');
    bind('#fuser', 'user', 'change');
    bind('#fop', 'op', 'change');
    bind('#frange', 'range', 'change');
    bind('#fmin', 'minDur');
    $('#fmine').onchange = (e) => post({ cmd: 'serverFilter', filter: { mineOnly: e.target.checked } });
    $('#fclear').onclick = () => {
      st.f = { q: '', status: '', user: '', op: '', minDur: '', range: '' };
      save();
      ['#fq', '#fstatus', '#fuser', '#fop', '#frange', '#fmin'].forEach((s) => ($(s).value = ''));
      if (S.filter.mineOnly) post({ cmd: 'serverFilter', filter: { mineOnly: false } });
      drawTable();
    };
    $('#selOpen').onclick = () => [...checked].slice(0, 5).forEach((id) => post({ cmd: 'open', id, mode: 'analyze' }));
    $('#selDel').onclick = () => post({ cmd: 'delete', ids: [...checked] });
    $('#selNone').onclick = () => { checked.clear(); drawTable(); };
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && st.tab === 'logs') { e.preventDefault(); $('#fq').focus(); }
    });
    built = true;
    setTab(st.tab);
  }

  function toggleLive() { run(S.tailing ? 'orglens.stopTail' : 'orglens.startTail'); }

  function render() {
    if (!built) buildShell();
    const o = S.org;
    $('#orgPill').innerHTML = o ? `${I.cloud}${esc(o.alias)}` : S.connecting ? `<span class="spinner sm"></span>${esc(S.connecting)}` : `${I.cloud}Select org`;
    const mins = S.traceExp ? Math.max(0, Math.round((S.traceExp - Date.now()) / 60000)) : 0;
    const tp = $('#tracePill');
    tp.className = 'pill ' + (S.tracing ? 'ok' : o ? 'warn' : '');
    tp.innerHTML = S.tracing ? `<span class="dot"></span>Tracing · ${mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm'} left` : `${I.record}Not tracing`;
    tp.dataset.tip = S.tracing ? 'Debug logging is ON for your user. Click to extend it or change the debug level. Manage other users on the Trace Flags tab.' : 'Debug logging is OFF — Salesforce will not write new logs for you. Click to start tracing.';
    tp.style.display = o ? '' : 'none';
    const lp = $('#livePill');
    lp.className = 'pill ' + (S.tailing ? 'live' : '');
    lp.innerHTML = `<span class="dot"></span>${S.tailing ? 'Live' : 'Paused'}`;
    lp.dataset.tip = S.tailing ? 'Live tail is ON: checking the org for new logs every few seconds. Click to pause.' : 'Live tail is paused: the log list only changes when you refresh. Click to go live.';
    lp.style.display = o ? '' : 'none';
    $('#ltLive').className = 'btn ' + (S.tailing ? 'live' : '');
    $('#ltLive').innerHTML = `${S.tailing ? I.stop : I.live}${S.tailing ? 'Stop live' : 'Go live'}`;
    $('#logCount').textContent = S.logs.length;
    $('#fmine').checked = !!S.filter.mineOnly;
    fillSelect('#fuser', 'All users', [...new Set(S.logs.map((l) => l.user).filter(Boolean))].sort(), st.f.user);
    fillSelect('#fop', 'All operations', [...new Set(S.logs.map((l) => l.op))].sort(), st.f.op);
    drawHome();
    drawTable();
    if (pages[st.tab] && !pageBuilt[st.tab]) setTab(st.tab); // build once the org is connected
  }

  function fillSelect(sel, label, vals, cur) {
    const el = $(sel);
    const html = `<option value="">${label}</option>` + vals.map((v) => `<option ${v === cur ? 'selected' : ''} value="${esc(v)}">${esc(v.length > 60 ? v.slice(0, 60) + '…' : v)}</option>`).join('');
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
  }

  // ---------- Home ----------
  function drawHome() {
    const el = $('#p-home');
    const o = S.org;
    if (!o && S.connecting) {
      el.innerHTML = `<div class="connect"><div class="spinner" style="width:34px;height:34px;margin:0 auto 14px"></div><h2>Connecting to ${esc(S.connecting)}…</h2>
        <p class="muted">Signing in with your Salesforce CLI session. The first connection can take a few seconds; later ones reuse a cached session.</p></div>`;
      return;
    }
    if (!o) {
      el.innerHTML = `<div class="connect">${I.cloud}<h2>Connect to an org</h2>
        <p class="muted">OrgLens uses orgs you have authorized with the Salesforce CLI (<code>sf org login web</code>).</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:16px"><button class="btn primary" data-run="orglens.selectOrg">${I.cloud} Select org</button><button class="btn" data-run="orglens.analyzeFile">${I.file} Analyze a local log</button></div></div>`;
      el.onclick = homeClick;
      return;
    }
    const logs = S.logs;
    const failed = logs.filter((l) => l.status !== 'Success');
    const today = logs.filter((l) => new Date(l.start).toDateString() === new Date().toDateString());
    const avg = logs.length ? Math.round(logs.reduce((s, l) => s + l.dur, 0) / logs.length) : 0;
    const biggest = logs.reduce((m, l) => Math.max(m, l.size), 0);
    const pct = S.traceExp && S.traceStart ? Math.max(0, Math.min(100, ((S.traceExp - Date.now()) / (S.traceExp - S.traceStart)) * 100)) : 0;
    const mins = S.traceExp ? Math.max(0, Math.round((S.traceExp - Date.now()) / 60000)) : 0;
    const A = (icon, color, title, sub, attrs, on) => `<button class="act ${on ? 'on' : ''}" ${attrs} data-tip="${esc(TIPS[title] || '')}"><div class="ico" style="background:${color}">${icon}</div><b>${title}</b><span>${sub}</span></button>`;
    const item = (l) => `<div class="it" data-open="${l.id}"><span class="sd ${l.status !== 'Success' ? 'bad' : ''}"></span><span class="op" title="${esc(l.op)}">${esc(l.op)} <span class="muted">· ${esc(l.user || '')}</span></span><span class="muted">${when(l.start)}</span></div>`;
    el.innerHTML = `<div class="home">
      <div class="hero">
        <div class="card"><h4>${I.cloud} ${esc(o.alias)}</h4><div class="sub">${esc(o.username)}<br>${esc(o.instanceUrl)}</div>
          <div class="row"><button class="btn sm" data-run="orglens.selectOrg">Switch org</button><button class="btn sm" data-run="orglens.refresh">${I.refresh} Refresh</button></div></div>
        <div class="card"><h4>${S.tracing ? `<span class="sd"></span> Debug logging is on` : `<span class="sd bad"></span> Debug logging is off`}</h4>
          <div class="sub">${S.tracing ? `Logs are captured for ${esc(o.userName || 'you')} for the next ${mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + ' min'}${S.traceLevel ? ' · level <b>' + esc(S.traceLevel.replace('OrgLens_', '')) + '</b>' : ''}.` : 'Salesforce only writes debug logs while a trace flag is active. Start one to capture logs.'}</div>
          ${S.tracing ? `<div class="trace-meter"><i style="width:${pct}%"></i></div>` : ''}
          <div class="row">${S.tracing ? `<button class="btn sm" data-run="orglens.startTrace">Extend / change</button><button class="btn sm" data-run="orglens.stopTrace">${I.stop} Stop</button>` : `<button class="btn sm primary" data-run="orglens.startTrace">${I.record} Start tracing</button>`}<button class="btn sm" data-tab="trace">${I.user} Manage all trace flags</button></div></div>
      </div>
      <div><div class="sec-title">Actions</div><div class="actions">
        ${A(S.tailing ? I.stop : I.live, '#e26d5a', S.tailing ? 'Stop live tail' : 'Live tail', S.tailing ? 'Watching for new logs' : 'Stream new logs as they arrive', 'data-live', S.tailing)}
        ${A(I.list, '#5b8def', 'Live Logs', `Browse, search & filter ${logs.length} logs`, 'data-tab="logs"')}
        ${A(I.refresh, '#2bb5c4', 'Refresh', 'Fetch the latest logs now', 'data-run="orglens.refresh"')}
        ${A(S.tracing ? I.stop : I.record, '#3fb27f', S.tracing ? 'Stop tracing' : 'Start tracing', S.tracing ? 'Turn off debug logging' : 'Set a trace flag for yourself', S.tracing ? 'data-run="orglens.stopTrace"' : 'data-run="orglens.startTrace"')}
        ${A(I.user, '#a371f7', 'Trace flags', 'Users, Automated Process, guests, classes · debug levels', 'data-tab="trace"')}
        ${A(I.db, '#5b8def', 'SOQL explorer', 'Browse objects & fields, run queries, export', 'data-tab="soql"')}
        ${A(I.ext, '#2bb5c4', 'REST explorer', 'Test REST APIs, JSON body, pretty & raw response', 'data-tab="rest"')}
        ${A(I.gear, '#6e7781', 'Org setup', 'Settings on/off, limits, packages, licenses, audit trail', 'data-tab="org"')}
        ${A(I.filter, '#d16ba5', 'Filter logs', 'Status, user, operation, duration', 'data-tab="logs" data-focus="1"')}
        ${A(I.search, '#e3a73b', 'Search inside logs', 'Text or /regex/ across log bodies', 'data-run="orglens.searchLogs"')}
        ${A(I.play, '#3fb27f', 'Execute anonymous', 'Run Apex and analyze its log', 'data-run="orglens.executeAnonymous"')}
        ${A(I.file, '#6e7781', 'Analyze local file', 'Open any .log from disk', 'data-run="orglens.analyzeFile"')}
        ${A(I.trash, '#f85149', 'Delete logs', 'Mine, shown, or all', 'data-run="orglens.deleteAll"')}
      </div></div>
      ${logs.length ? `<div><div class="sec-title">At a glance</div><div class="grid">
        <div class="kpi link" data-tab="logs"><div class="v">${logs.length}</div><div class="l">Logs listed</div></div>
        <div class="kpi link ${failed.length ? 'bad' : ''}" data-tab="logs" data-status="bad"><div class="v">${failed.length}</div><div class="l">Failed</div></div>
        <div class="kpi"><div class="v">${today.length}</div><div class="l">Today</div></div>
        <div class="kpi"><div class="v">${dur(avg)}</div><div class="l">Avg duration</div></div>
        <div class="kpi"><div class="v">${size(biggest)}</div><div class="l">Largest log</div></div>
        <div class="kpi"><div class="v">${new Set(logs.map((l) => l.user)).size}</div><div class="l">Users</div></div>
      </div></div>
      ${insightsHtml(logs, failed, item)}` : emptyHtml()}
      <div><div class="sec-title pulse-title">Org pulse <span class="muted" id="pulseAge"></span><button class="btn sm ghost" data-pulse-refresh data-tip="Re-read limits, jobs and recent changes from the org">${I.refresh}</button></div>
        <div id="pulse">${pulseHtml()}</div></div>
      </div>`;
    el.onclick = homeClick;
    loadPulse(false);
  }

  // ----- Home: no-logs guide -----
  function emptyHtml() {
    const step = (n, title, text, btn) => `<div class="g-step"><div class="g-n">${n}</div><div><b>${title}</b><div class="muted">${text}</div>${btn}</div></div>`;
    return `<div class="card empty-guide"><h4>No debug logs yet</h4>
      <div class="sub">Salesforce writes logs only while a trace flag is active and something runs. Three ways to get one:</div>
      <div class="g-steps">
        ${S.tracing
          ? step(1, 'Do something in the org', 'Tracing is on, so open a record, save a quote or run a flow and its log will appear here. Live tail streams new logs as they arrive.', `<button class="btn sm" data-live>${I.live} ${S.tailing ? 'Live tail is on' : 'Start live tail'}</button>`)
          : step(1, 'Start tracing', 'Capture everything you do in the org for the next 30 minutes, then turn on live tail.', `<button class="btn sm primary" data-run="orglens.startTrace">${I.record} Start tracing</button>`)}
        ${step(2, 'Run anonymous Apex', 'Execute a snippet and open its log in the analyzer straight away.', `<button class="btn sm" data-run="orglens.executeAnonymous">${I.play} Execute anonymous</button>`)}
        ${step(3, 'Analyze a saved log', 'Open any .log file from disk — no org needed.', `<button class="btn sm" data-run="orglens.analyzeFile">${I.file} Open .log file</button>`)}
      </div></div>`;
  }

  // ----- Home: log insights (from list metadata only, no extra API calls) -----
  function insightsHtml(logs, failed, item) {
    // activity: pick a bucket size so the span fits in <= 36 bars
    const times = logs.map((l) => +new Date(l.start));
    const end = Date.now();
    const span = Math.max(60000, end - Math.min(...times));
    const STEPS = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3, 6 * 3600e3, 86400e3];
    const step = STEPS.find((s) => span / s <= 36) || 86400e3;
    const n = Math.min(36, Math.ceil(span / step));
    const ok = new Array(n).fill(0), bad = new Array(n).fill(0);
    logs.forEach((l) => {
      const i = n - 1 - Math.floor((end - new Date(l.start)) / step);
      if (i >= 0 && i < n) (l.status !== 'Success' ? bad : ok)[i]++;
    });
    const peak = Math.max(1, ...ok.map((v, i) => v + bad[i]));
    const W = 100 / n;
    const bars = ok.map((v, i) => {
      const h1 = (v / peak) * 100, h2 = (bad[i] / peak) * 100;
      const t0 = new Date(end - (n - i) * step);
      const tip = `${t0.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${v + bad[i]} log${v + bad[i] === 1 ? '' : 's'}${bad[i] ? `, ${bad[i]} failed` : ''}`;
      return `<g><title>${esc(tip)}</title><rect x="${i * W + W * 0.12}" y="${100 - h1 - h2}" width="${W * 0.76}" height="${h2}" class="sp-bad"/><rect x="${i * W + W * 0.12}" y="${100 - h1}" width="${W * 0.76}" height="${h1}" class="sp-ok"/></g>`;
    }).join('');
    const unit = { 60e3: '1 min', 300e3: '5 min', 900e3: '15 min', 3600e3: '1 hour', 21600e3: '6 hours', 86400e3: '1 day' }[step];

    // top operations by count, with total time
    const g = new Map();
    logs.forEach((l) => { const o = g.get(l.op) || { op: l.op, n: 0, t: 0, bad: 0 }; o.n++; o.t += l.dur || 0; if (l.status !== 'Success') o.bad++; g.set(l.op, o); });
    const top = [...g.values()].sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 6);
    const topMax = Math.max(1, ...top.map((o) => o.n));
    const slow = [...logs].sort((a, b) => b.dur - a.dur).slice(0, 5);
    const slowMax = Math.max(1, ...slow.map((l) => l.dur));
    const hbar = (pct, cls = '') => `<span class="hb"><i class="${cls}" style="width:${Math.max(2, pct)}%"></i></span>`;

    return `<div class="ins">
      <div class="card ins-wide"><h4>Activity <span class="muted fw">· ${logs.length} logs, one bar per ${unit}</span></h4>
        <svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none">${bars}</svg>
        <div class="spark-ax muted"><span>${when(new Date(end - n * step).toISOString())}</span><span>now</span></div></div>
      <div class="card"><h4>Top operations</h4><div class="rank">
        ${top.map((o) => `<div class="rk" data-tab="logs" data-op="${esc(o.op)}" title="Show only ${esc(o.op)} logs"><span class="op">${esc(o.op)}</span>${hbar((o.n / topMax) * 100, o.bad ? 'warn' : '')}<span class="muted num">×${o.n} · ${dur(o.t)}</span></div>`).join('')}
      </div></div>
      <div class="card"><h4>Slowest logs</h4><div class="rank">
        ${slow.map((l) => `<div class="rk" data-open="${l.id}" title="Analyze this log"><span class="op">${esc(l.op)} <span class="muted">· ${esc(l.user || '')}</span></span>${hbar((l.dur / slowMax) * 100, l.status !== 'Success' ? 'bad' : 'slow')}<span class="num">${dur(l.dur)}</span></div>`).join('')}
      </div></div>
      <div class="card"><h4>Latest logs</h4><div class="mini-list">${logs.slice(0, 6).map(item).join('')}</div></div>
      <div class="card"><h4 style="${failed.length ? 'color:var(--err)' : ''}">Recent failures</h4><div class="mini-list">${failed.slice(0, 6).map(item).join('') || '<div class="muted" style="padding:8px 0">✓ No failed logs in this list.</div>'}</div></div>
    </div>`;
  }

  // ----- Home: org pulse (fetched after first paint, cached 5 min per org) -----
  const P = { data: null, org: null, loading: false, err: null };
  function loadPulse(force) {
    const org = S.org && S.org.username;
    if (!org || P.loading) return;
    if (!force && P.org === org && (P.data || P.err) && Date.now() - ((P.data && P.data.at) || P.errAt || 0) < 5 * 60000) return;
    if (P.org !== org) P.data = null;
    P.org = org; P.loading = true; P.err = null;
    paintPulse();
    call('homePulse', { force })
      .then((d) => { if (P.org === org) P.data = d; })
      .catch((e) => { if (P.org === org) { P.err = e.message; P.errAt = Date.now(); } })
      .finally(() => { if (P.org === org) { P.loading = false; paintPulse(); } });
  }
  function paintPulse() {
    const box = document.getElementById('pulse');
    if (box) box.innerHTML = pulseHtml();
    const age = document.getElementById('pulseAge');
    if (age) age.textContent = P.loading ? '· updating…' : P.data ? '· as of ' + new Date(P.data.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  }
  function pulseHtml() {
    const d = P.data;
    if (!d) return P.err ? `<div class="card err">${esc(P.err)}</div>` : `<div class="card pulse-wait"><div class="spinner"></div><span class="muted">Reading limits, background jobs and recent changes…</span></div>`;
    const fmt = (v, mb) => (mb ? (v >= 1024 ? (v / 1024).toFixed(1) + ' GB' : v + ' MB') : v.toLocaleString());
    const meter = (label, pct, text, cls, tip) => `<div class="lm" title="${esc(tip || '')}"><div class="lm-h"><span>${label}</span><span class="muted">${text}</span></div><div class="lm-b"><i class="${cls}" style="width:${Math.min(100, Math.max(1, pct))}%"></i></div></div>`;
    const lev = (p) => (p >= 90 ? 'bad' : p >= 70 ? 'warn' : '');
    const none = (msg) => `<div class="muted pad-empty">${msg}</div>`;
    const errNote = (e) => `<div class="muted pad-empty" title="${esc(e)}">Not available — ${esc(e.length > 90 ? e.slice(0, 90) + '…' : e)}</div>`;

    let limits = d.limits ? d.limits.map((l) => { const p = (l.used / l.max) * 100; return meter(l.label, p, `${fmt(l.used, l.mb)} / ${fmt(l.max, l.mb)} · ${Math.round(p)}%`, lev(p)); }).join('') : errNote(d.limitsErr || 'no access');
    if (d.coverage != null) limits += meter('Apex code coverage (org-wide)', d.coverage, d.coverage ? `${d.coverage}% · deploy needs 75%` : '0% · run all tests to calculate', d.coverage < 75 ? 'bad' : 'good', 'From the last test run in this org');

    const jobs = d.jobs ? (d.jobs.length ? d.jobs.map((j) => `<div class="it" data-path="/lightning/setup/AsyncApexJobs/home" title="${esc(j.msg || '')}"><span class="sd bad"></span><span class="op"><b>${esc(j.cls)}</b> <span class="muted">· ${esc(j.type)}${j.errors ? ` · ${j.errors}/${j.items || '?'} batches failed` : ''}</span>${j.msg ? `<div class="jmsg">${esc(j.msg)}</div>` : ''}</span><span class="muted">${when(j.at)}</span></div>`).join('') : none('✓ No failed batch, queueable or future jobs in the last 24 hours.')) : errNote(d.jobsErr || 'no access');

    const chg = d.changedErr ? errNote(d.changedErr) : d.changed.length ? d.changed.map((c) => {
      const path = c.flowId ? `/builder_platform_interaction/flowBuilder.app?flowDefId=${c.flowId}` : `/lightning/setup/${c.kind === 'Trigger' ? 'ApexTriggers' : 'ApexClasses'}/page?address=%2F${c.id}`;
      return `<div class="it" data-path="${esc(path)}" title="Open in Salesforce"><span class="kd k-${c.kind.split(' ')[0].toLowerCase()}">${esc(c.kind.replace(' flow', ''))}</span><span class="op">${esc(c.name)} <span class="muted">· ${esc(c.by || '')}</span></span><span class="muted">${when(c.at)}</span></div>`;
    }).join('') : none('No Apex or Flow changes in the last 7 days.');

    const cron = d.crons ? (d.crons.length ? d.crons.map((c) => `<div class="it" data-path="/lightning/setup/ScheduledJobs/home" title="${esc(c.type)}${c.prev ? ' · last ran ' + new Date(c.prev).toLocaleString() : ''}"><span class="sd ${c.state === 'WAITING' || c.state === 'ACQUIRED' || c.state === 'EXECUTING' ? '' : 'idle'}"></span><span class="op">${esc(c.name || '(unnamed)')} <span class="muted">· ${esc(c.type)}</span></span><span class="muted">${untilTxt(c.next)}</span></div>`).join('') : none('Nothing scheduled.')) : errNote(d.cronsErr || 'no access');

    const nj = d.jobs && d.jobs.length;
    return `<div class="pulse">
      <div class="card"><h4>Org limits</h4><div class="lms">${limits}</div></div>
      <div class="card"><h4 style="${nj ? 'color:var(--err)' : ''}">Failed background jobs <span class="muted fw">· last 24h</span></h4><div class="mini-list">${jobs}</div></div>
      <div class="card"><h4>What changed <span class="muted fw">· Apex & Flow, last 7 days</span></h4><div class="mini-list">${chg}</div></div>
      <div class="card"><h4>Coming up <span class="muted fw">· scheduled jobs</span></h4><div class="mini-list">${cron}</div></div>
    </div>`;
  }
  function untilTxt(iso) {
    const s = (new Date(iso) - Date.now()) / 1000;
    if (s < 60) return 'any moment';
    if (s < 3600) return 'in ' + Math.round(s / 60) + 'm';
    if (s < 86400) return 'in ' + Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function homeClick(e) {
    const r = e.target.closest('[data-run]');
    if (r) return run(r.dataset.run);
    if (e.target.closest('[data-live]')) return toggleLive();
    if (e.target.closest('[data-pulse-refresh]')) return loadPulse(true);
    const pth = e.target.closest('[data-path]');
    if (pth) { toast('Opening in Salesforce…'); return call('openPath', { path: pth.dataset.path }).catch((err) => toast(err.message, 'error')); }
    const op = e.target.closest('[data-open]');
    if (op) return post({ cmd: 'open', id: op.dataset.open, mode: e.ctrlKey || e.metaKey ? 'raw' : 'analyze' });
    const t = e.target.closest('[data-tab]');
    if (t) {
      if (t.dataset.status) { st.f.status = t.dataset.status; $('#fstatus').value = t.dataset.status; save(); drawTable(); }
      if (t.dataset.op) { st.f.op = t.dataset.op; save(); drawTable(); $('#fop').value = t.dataset.op; }
      setTab(t.dataset.tab);
      if (t.dataset.focus) $('#fq').focus();
    }
  }

  // ---------- Live logs table ----------
  const COLS = [
    { k: 'chk', label: '<input type="checkbox" id="chkAll">', nosort: true },
    { k: 'status', label: '' },
    { k: 'start', label: 'Time' },
    { k: 'op', label: 'Operation' },
    { k: 'user', label: 'User' },
    { k: 'dur', label: 'Duration', num: true },
    { k: 'size', label: 'Size', num: true },
    { k: 'request', label: 'Request' },
    { k: 'act', label: '', nosort: true },
  ];
  function filtered() {
    const f = st.f;
    const q = (f.q || '').toLowerCase();
    const since = f.range ? Date.now() - Number(f.range) * 60000 : 0;
    const min = Number(f.minDur) || 0;
    return S.logs.filter((l) =>
      (!f.status || (f.status === 'bad' ? l.status !== 'Success' : l.status === 'Success')) &&
      (!f.user || l.user === f.user) &&
      (!f.op || l.op === f.op) &&
      (!since || new Date(l.start).getTime() >= since) &&
      (!min || l.dur >= min) &&
      (!q || `${l.op} ${l.user} ${l.status} ${l.request} ${l.app} ${l.location} ${l.id}`.toLowerCase().includes(q))
    );
  }
  function drawTable() {
    if (!S) return;
    const wrap = $('#ltWrap');
    if (!S.org) { wrap.innerHTML = S.connecting ? `<div class="empty"><span class="spinner sm"></span> Connecting to ${esc(S.connecting)}…</div>` : '<div class="empty">Select an org to see its logs.</div>'; return; }
    let rows = filtered();
    const { k, dir } = st.sort;
    rows.sort((a, b) => {
      const A = k === 'start' ? a.start : a[k], B = k === 'start' ? b.start : b[k];
      return (A > B ? 1 : A < B ? -1 : 0) * dir;
    });
    for (const id of [...checked]) if (!S.logs.some((l) => l.id === id)) checked.delete(id);
    const maxDur = Math.max(1, ...rows.map((r) => r.dur));
    $('#ltCount').textContent = `${rows.length} of ${S.logs.length} logs${S.error ? ' · ⚠ ' + S.error : ''}`;
    $('#selActs').classList.toggle('show', checked.size > 0);
    $('#selN').textContent = checked.size;
    const isNew = new Set(S.newIds);
    const head = COLS.map((c) => `<th class="${c.num ? 'num' : ''}" ${c.nosort ? '' : `data-k="${c.k}"`}>${c.label}${st.sort.k === c.k ? (st.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = rows.map((l) => {
      const bad = l.status !== 'Success';
      const fresh = isNew.has(l.id) && !seenRows.has(l.id);
      return `<tr data-id="${l.id}" class="${checked.has(l.id) ? 'checked' : ''} ${fresh ? 'fresh' : ''}">
        <td><input type="checkbox" class="chk" ${checked.has(l.id) ? 'checked' : ''}></td>
        <td><span class="st ${bad ? 'bad' : ''}" title="${esc(l.status)}"><span class="sd ${bad ? 'bad' : ''}"></span></span></td>
        <td title="${esc(new Date(l.start).toLocaleString())}">${when(l.start)}</td>
        <td class="op" title="${esc(l.op)}">${isNew.has(l.id) ? '<span class="newtag">NEW</span>' : ''}${esc(l.op)}${bad ? ` <span class="badge err">${esc(l.status.length > 40 ? l.status.slice(0, 40) + '…' : l.status)}</span>` : ''}</td>
        <td>${esc(l.user)}</td>
        <td class="dur"><div class="durbar"><span>${dur(l.dur)}</span><div class="b"><i class="${l.dur > 5000 ? 'slow' : ''}" style="width:${(l.dur / maxDur) * 100}%"></i></div></div></td>
        <td class="num">${size(l.size)}</td>
        <td class="muted">${esc(l.request)} · ${esc(l.location)}</td>
        <td><div class="rowacts"><button data-a="analyze" title="Analyze">${I.graph}</button><button data-a="raw" title="Open raw log">${I.raw}</button><button data-a="del" title="Delete">${I.trash}</button></div></td></tr>`;
    }).join('');
    rows.forEach((l) => isNew.has(l.id) && seenRows.add(l.id));
    wrap.innerHTML = rows.length
      ? `<table class="lt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
      : `<div class="empty">${S.logs.length ? 'No logs match these filters.' : S.tracing ? 'Waiting for logs… run something in the org.' : 'No logs yet. Start tracing, then run something in the org.'}</div>`;
    const all = $('#chkAll');
    if (all) {
      all.checked = rows.length > 0 && rows.every((r) => checked.has(r.id));
      all.onclick = (e) => { e.stopPropagation(); rows.forEach((r) => (all.checked ? checked.add(r.id) : checked.delete(r.id))); drawTable(); };
    }
    const th = wrap.querySelector('thead');
    if (th) th.onclick = (e) => {
      const h = e.target.closest('th[data-k]');
      if (!h) return;
      st.sort = st.sort.k === h.dataset.k ? { k: h.dataset.k, dir: -st.sort.dir } : { k: h.dataset.k, dir: h.dataset.k === 'op' || h.dataset.k === 'user' ? 1 : -1 };
      save();
      drawTable();
    };
    const tb = wrap.querySelector('tbody');
    if (tb) tb.onclick = (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.classList.contains('chk')) { e.target.checked ? checked.add(id) : checked.delete(id); drawTable(); return; }
      const a = e.target.closest('[data-a]');
      if (a) {
        if (a.dataset.a === 'del') post({ cmd: 'delete', ids: [id] });
        else post({ cmd: 'open', id, mode: a.dataset.a });
        return;
      }
      if (e.shiftKey) { checked.has(id) ? checked.delete(id) : checked.add(id); drawTable(); return; }
      post({ cmd: 'open', id, mode: e.ctrlKey || e.metaKey ? 'raw' : 'analyze' });
    };
  }

  // keep relative times fresh
  setInterval(() => S && render(), 30000);
})();

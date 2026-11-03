// OrgLens — analyzer webview
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const saved = vscode.getState() || {};

  let D = null;
  const byId = new Map();
  const parentOf = new Map();
  let all = [];
  let selId = null;
  let rootDur = 1;

  const TYPES = ['CODE_UNIT', 'METHOD', 'SOQL', 'DML', 'CALLOUT', 'FLOW', 'WORKFLOW', 'SYSTEM', 'EXECUTION', 'DEBUG', 'EXCEPTION', 'FATAL'];
  const LABEL = { CODE_UNIT: 'UNIT', METHOD: 'METHOD', SOQL: 'SOQL', DML: 'DML', CALLOUT: 'HTTP', FLOW: 'FLOW', WORKFLOW: 'WF', SYSTEM: 'SYS', EXECUTION: 'EXEC', DEBUG: 'DEBUG', EXCEPTION: 'EXC', FATAL: 'FATAL', ROOT: 'LOG' };
  const NICE = { CODE_UNIT: 'Code unit', METHOD: 'Method', SOQL: 'SOQL', DML: 'DML', CALLOUT: 'Callout', FLOW: 'Flow', WORKFLOW: 'Workflow', SYSTEM: 'System', EXECUTION: 'Execution', DEBUG: 'Debug', EXCEPTION: 'Exception', FATAL: 'Fatal' };
  const LEAF = new Set(['DEBUG', 'EXCEPTION', 'FATAL']);
  const DARK_TEXT = new Set(['SOQL', 'FLOW', 'METHOD', 'SYSTEM']);
  const css = getComputedStyle(document.documentElement);
  const COLOR = Object.fromEntries(TYPES.map((t) => [t, css.getPropertyValue('--c-' + t).trim() || '#888']));

  // ---------- utils ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (ns) => {
    const ms = (ns || 0) / 1e6;
    if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s';
    if (ms >= 100) return ms.toFixed(0) + ' ms';
    if (ms >= 1) return ms.toFixed(1) + ' ms';
    if (ms > 0) return ms.toFixed(2) + ' ms';
    return '0 ms';
  };
  const n0 = (n) => (n || 0).toLocaleString();
  const bytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? (b / 1024).toFixed(0) + ' KB' : b + ' B');
  const typeTag = (t) => `<span class="type" style="background:${COLOR[t] || '#888'};color:${DARK_TEXT.has(t) ? '#111' : '#fff'}">${LABEL[t] || t}</span>`;
  const post = (m) => vscode.postMessage(m);
  const $ = (s, el = document) => el.querySelector(s);
  const save = (patch) => { Object.assign(saved, patch); vscode.setState(saved); };

  const ICON = {
    overview: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h6v6H1zM9 1h6v6H9zM1 9h6v6H1zM9 9h6v6H9z" opacity=".85"/></svg>',
    timeline: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="3" rx="1"/><rect x="2" y="6.5" width="7" height="3" rx="1"/><rect x="10" y="6.5" width="4" height="3" rx="1"/><rect x="3" y="11" width="3" height="3" rx="1"/></svg>',
    tree: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="3" rx="1"/><rect x="5" y="6.5" width="8" height="3" rx="1"/><rect x="5" y="12" width="10" height="3" rx="1"/><path d="M3 4v10h2v-1H4V8h1V7H4V4z"/></svg>',
    analysis: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="9" width="3" height="6" rx="1"/><rect x="6" y="5" width="3" height="10" rx="1"/><rect x="11" y="1" width="3" height="14" rx="1"/></svg>',
    database: '<svg viewBox="0 0 16 16" fill="currentColor"><ellipse cx="8" cy="3.5" rx="6" ry="2.5"/><path d="M2 5.5v3c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-3c0 1.4-2.7 2.5-6 2.5S2 6.9 2 5.5zm0 4.5v2.5C2 13.9 4.7 15 8 15s6-1.1 6-2.5V10c0 1.4-2.7 2.5-6 2.5S2 11.4 2 10z"/></svg>',
    debug: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v2H2zm0 4h9v2H2zm0 4h12v2H2z"/></svg>',
    perf: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 12a5.5 5.5 0 1 1 11 0"/><path d="M8 12l3-4"/><circle cx="8" cy="12" r="1" fill="currentColor"/></svg>',
    log: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 3h2M6.5 3h7M4.5 6.5h2M8.5 6.5h5M4.5 10h2M8.5 10h5M2.5 13.5h2M6.5 13.5h7"/></svg>',
  };

  // ---------- bootstrap ----------
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'data') {
      D = m.data;
      index();
      render();
    } else if (m.type === 'plan') onPlan(m);
  });
  post({ cmd: 'ready' });

  function index() {
    rootDur = Math.max(1, D.root.end - D.root.start);
    (function walk(n, depth) {
      byId.set(n.id, n);
      n.depth = depth;
      if (n.type !== 'ROOT') all.push(n);
      for (const c of n.children) {
        parentOf.set(c.id, n);
        walk(c, depth + 1);
      }
    })(D.root, -1);
  }
  const ancestors = (id) => {
    const out = [];
    let p = parentOf.get(id);
    while (p && p.type !== 'ROOT') { out.unshift(p); p = parentOf.get(p.id); }
    return out;
  };
  const enclosingFrame = (id) => {
    let p = parentOf.get(id);
    while (p && !['METHOD', 'CODE_UNIT'].includes(p.type)) p = parentOf.get(p.id);
    return p;
  };

  // ---------- shell ----------
  const VIEWS = [
    ['overview', 'Overview'],
    ['perf', 'Performance'],
    ['log', 'Log Viewer'],
    ['timeline', 'Timeline'],
    ['tree', 'Call Tree'],
    ['analysis', 'Analysis'],
    ['database', 'Database'],
    ['debug', 'Debug & Errors'],
  ];
  const built = {};
  let active = null;

  function render() {
    const s = D.stats;
    const m = D.meta;
    const bad = s.exceptions > 0 || (m.status && m.status !== 'Success');
    const counts = { database: s.soql + s.dml, debug: s.debugs + s.exceptions, analysis: D.hotspots.length };
    app.innerHTML = `
      <div class="hdr">
        <div class="title"><span class="dot ${bad ? 'bad' : ''}"></span><span class="t" title="${esc(m.title)}">${esc(m.operation || m.title)}</span></div>
        <div class="chips">
          ${m.user ? `<span class="chip">👤 ${esc(m.user)}</span>` : ''}
          ${m.status ? `<span class="chip" ${m.status !== 'Success' ? 'style="background:var(--err);color:#fff"' : ''}>${esc(m.status)}</span>` : ''}
          <span class="chip">⏱ ${fmt(s.duration)}</span>
          <span class="chip">${bytes(m.size)}</span>
          <span class="chip">${n0(s.lines)} lines</span>
          ${D.header.apiVersion ? `<span class="chip">API ${esc(D.header.apiVersion)}</span>` : ''}
          ${m.startTime ? `<span class="chip">${esc(new Date(m.startTime).toLocaleString())}</span>` : ''}
        </div>
        <div class="spacer"></div>
        <button class="btn" id="copySummary" title="Copy a Markdown summary">⧉ Summary</button>
        <button class="btn primary" id="openRaw">Open raw log</button>
      </div>
      <div class="tabs">${VIEWS.map(([k, l]) => {
        const c = counts[k];
        const isBad = k === 'debug' && s.exceptions > 0;
        return `<button class="tab" data-v="${k}">${ICON[k]}${l}${c ? `<span class="count ${isBad ? 'bad' : ''}">${n0(c)}</span>` : ''}</button>`;
      }).join('')}</div>
      <div class="main">${VIEWS.map(([k]) => `<div class="view" id="v-${k}"></div>`).join('')}</div>
      <div class="drawer" id="drawer"></div>
      <div class="tip" id="tip"></div>`;
    $('#openRaw').onclick = () => post({ cmd: 'openRaw' });
    $('#copySummary').onclick = () => post({ cmd: 'copy', text: summaryMarkdown() });
    $('.tabs').onclick = (e) => {
      const b = e.target.closest('.tab');
      if (b) show(b.dataset.v);
    };
    show(saved.view || 'overview');
  }

  function show(v) {
    active = v;
    save({ view: v });
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.v === v));
    document.querySelectorAll('.view').forEach((t) => t.classList.toggle('active', t.id === 'v-' + v));
    const el = $('#v-' + v);
    if (!built[v]) {
      built[v] = true;
      ({ overview: buildOverview, perf: buildPerf, log: buildLog, timeline: buildTimeline, tree: buildTree, analysis: buildAnalysis, database: buildDatabase, debug: buildDebug })[v](el);
    } else if (v === 'timeline') TL.draw();
    else if (v === 'tree') TREE.paint();
    else if (v === 'log') LOGV.paint();
  }

  // ---------- selection / drawer ----------
  function select(id, opts = {}) {
    selId = id;
    const n = byId.get(id);
    const dr = $('#drawer');
    if (!n) { dr.classList.remove('open'); return; }
    const anc = ancestors(id);
    const frame = ['METHOD', 'CODE_UNIT'].includes(n.type) ? n : enclosingFrame(id);
    dr.innerHTML = `
      <button class="btn sm x" data-a="close">✕</button>
      <div class="crumbs">${anc.slice(-6).map((a) => `<a data-id="${a.id}" title="${esc(a.name)}">${esc(a.name)}</a> ›`).join(' ')}</div>
      <div>${typeTag(n.type)}<span class="muted" style="font-size:11px">${NICE[n.type] || n.type}${n.level ? ' · ' + esc(n.level) : ''}</span></div>
      <div class="dn">${esc(n.name)}${n.detail ? '\n' + esc(n.detail) : ''}</div>
      <div class="dstats">
        ${LEAF.has(n.type) ? '' : `<span>Duration <b>${fmt(n.dur)}</b></span><span>Self <b>${fmt(n.self)}</b></span>`}
        <span>Start <b>+${fmt(n.start - D.root.start)}</b></span>
        ${n.soql ? `<span>SOQL <b>${n.soql}</b></span>` : ''}${n.dml ? `<span>DML <b>${n.dml}</b></span>` : ''}
        ${n.totalRows ? `<span>Rows <b>${n0(n.totalRows)}</b></span>` : ''}
        <span>Log line <b>${n.line + 1}</b></span>${n.srcLine ? `<span>Source line <b>${n.srcLine}</b></span>` : ''}
      </div>
      <div class="acts">
        <button class="btn sm primary" data-a="logv">Show in log viewer</button>
        <button class="btn sm" data-a="log">↗ Open in editor</button>
        ${frame ? `<button class="btn sm" data-a="src">{ } Open source</button>` : ''}
        ${active !== 'timeline' && !LEAF.has(n.type) ? '<button class="btn sm" data-a="tl">Show in timeline</button>' : ''}
        ${active !== 'tree' ? '<button class="btn sm" data-a="tree">Show in call tree</button>' : ''}
        <button class="btn sm" data-a="copy">Copy</button>
      </div>`;
    dr.classList.add('open');
    dr.onclick = (e) => {
      const crumb = e.target.closest('a[data-id]');
      if (crumb) return select(+crumb.dataset.id);
      const a = e.target.closest('[data-a]');
      if (!a) return;
      const act = a.dataset.a;
      if (act === 'close') { dr.classList.remove('open'); selId = null; TL.draw && built.timeline && TL.draw(); }
      if (act === 'log') post({ cmd: 'reveal', line: n.line });
      if (act === 'logv') { show('log'); LOGV.goto(n.line); }
      if (act === 'src') post({ cmd: 'openSource', name: frame.name, line: n.srcLine || frame.srcLine });
      if (act === 'tl') { show('timeline'); TL.zoomTo(n); }
      if (act === 'tree') { show('tree'); TREE.reveal(n.id); }
      if (act === 'copy') post({ cmd: 'copy', text: n.name + (n.detail ? '\n' + n.detail : '') });
    };
    if (!opts.silent) {
      if (built.tree) TREE.paint();
      if (built.timeline) TL.draw();
    }
  }

  // ---------- generic sortable table ----------
  function table(el, cols, rows, opt = {}) {
    let sort = opt.sort || null;
    let shown = [];
    function draw() {
      let r = rows.slice();
      if (sort) {
        const c = cols.find((x) => x.k === sort.k);
        const v = c.sv || ((x) => x[c.k]);
        r.sort((a, b) => {
          const A = v(a), B = v(b);
          return (A > B ? 1 : A < B ? -1 : 0) * sort.dir;
        });
      }
      const cap = r.length > 3000;
      shown = r.slice(0, 3000);
      el.innerHTML = `<table class="t"><thead><tr>${cols
        .map((c) => `<th class="${c.num ? 'num' : ''}" data-k="${c.k}" style="${c.w ? 'width:' + c.w : ''}">${c.label}${sort && sort.k === c.k ? ` <span class="arr">${sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`)
        .join('')}</tr></thead><tbody>${shown
        .map((row, i) => `<tr data-i="${i}" class="${row.id != null && row.id === selId ? 'sel' : ''}">${cols.map((c) => `<td class="${c.num ? 'num ' : ''}${c.cls || ''}">${c.fmt ? c.fmt(row) : esc(row[c.k])}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>${cap ? `<div class="muted pad">Showing 3,000 of ${n0(r.length)} rows — refine the filter.</div>` : ''}${!r.length ? `<div class="empty">${opt.empty || 'Nothing to show'}</div>` : ''}`;
      $('thead', el).onclick = (e) => {
        const th = e.target.closest('th');
        if (!th) return;
        const k = th.dataset.k;
        const c = cols.find((x) => x.k === k);
        sort = sort && sort.k === k ? { k, dir: -sort.dir } : { k, dir: c.num ? -1 : 1 };
        draw();
      };
      $('tbody', el).onclick = (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        el.querySelectorAll('tr.sel').forEach((x) => x.classList.remove('sel'));
        tr.classList.add('sel');
        opt.onClick && opt.onClick(shown[+tr.dataset.i], e, tr);
      };
      if (opt.onDbl) $('tbody', el).ondblclick = (e) => { const tr = e.target.closest('tr'); if (tr) opt.onDbl(shown[+tr.dataset.i]); };
    }
    draw();
    return { draw, set(r) { rows = r; draw(); } };
  }

  function legend(el, set, types, onChange) {
    el.innerHTML = types.map((t) => `<button class="lg ${set.has(t) ? 'off' : ''}" data-t="${t}"><i style="background:${COLOR[t]}"></i>${NICE[t]}</button>`).join('');
    el.onclick = (e) => {
      const b = e.target.closest('.lg');
      if (!b) return;
      const t = b.dataset.t;
      set.has(t) ? set.delete(t) : set.add(t);
      b.classList.toggle('off', set.has(t));
      onChange();
    };
  }
  const presentTypes = () => TYPES.filter((t) => all.some((n) => n.type === t));

  // ---------- Overview ----------
  function buildOverview(el) {
    const s = D.stats;
    const kpi = (v, l, sub, cls = '', go = '') => `<div class="kpi ${cls} ${go ? 'link' : ''}" ${go ? `data-go="${go}"` : ''}><div class="v">${v}</div><div class="l">${l}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    const units = D.root.children.flatMap((c) => (c.type === 'EXECUTION' ? c.children : [c])).filter((c) => !LEAF.has(c.type));
    const lim = D.limits.filter((l) => l.used > 0 || ['Number of SOQL queries', 'Number of DML statements', 'Maximum CPU time', 'Maximum heap size'].includes(l.name));
    const limHtml = lim.length
      ? lim.sort((a, b) => b.pct - a.pct).map((l) => `<div class="limit"><span>${esc(l.name)}${l.ns !== '(default)' ? ` <span class="muted">· ${esc(l.ns)}</span>` : ''}</span><span class="num">${n0(l.used)} / ${n0(l.max)}</span><div class="bar"><i class="${l.pct >= 80 ? 'err' : l.pct >= 50 ? 'warn' : ''}" style="width:${Math.min(100, Math.max(l.pct, l.used ? 1 : 0))}%"></i></div></div>`).join('')
      : '<div class="muted">No limit usage in this log (enable APEX_PROFILING ≥ INFO).</div>';
    el.innerHTML = `<div class="pad">
      <div class="grid">
        ${kpi(fmt(s.duration), 'Total time', `${n0(s.codeUnits)} code units`, '', 'timeline')}
        ${kpi(n0(s.soql), 'SOQL queries', `${n0(s.soqlRows)} rows`, '', 'database')}
        ${kpi(n0(s.dml), 'DML statements', `${n0(s.dmlRows)} rows`, '', 'database')}
        ${kpi(n0(s.methods), 'Method calls', `${n0(D.hotspots.length)} distinct`, '', 'analysis')}
        ${kpi(n0(s.callouts), 'Callouts', '')}
        ${kpi(n0(s.flows), 'Flow interviews', '')}
        ${kpi(n0(s.debugs), 'Debug lines', '', '', 'debug')}
        ${kpi(n0(s.exceptions), 'Exceptions', '', s.exceptions ? 'bad' : '', 'debug')}
      </div>
      <div class="cols">
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
          <div class="panel"><h3>Insights</h3>${D.insights.length
            ? D.insights.map((i, k) => `<div class="insight" data-k="${k}"><div class="ic ${i.sev}">${i.sev === 'error' ? '!' : i.sev === 'warn' ? '▲' : 'i'}</div><div style="min-width:0"><div class="t">${esc(i.title)}</div>${i.detail ? `<div class="d">${esc(i.detail)}</div>` : ''}</div></div>`).join('')
            : '<div class="ok-state">✓ No problems detected.</div>'}</div>
          <div class="panel"><h3>Code units</h3><div class="body waterfall">${units.length
            ? units.slice(0, 60).map((u) => `<div class="wf" data-id="${u.id}" title="${esc(u.name)}"><span class="nm">${typeTag(u.type)}${esc(u.name)}</span><div class="track"><i style="left:${((u.start - D.root.start) / rootDur) * 100}%;width:${(u.dur / rootDur) * 100}%;background:${COLOR[u.type]}"></i></div><span class="num muted">${fmt(u.dur)}</span></div>`).join('')
            : '<div class="muted">No code units.</div>'}</div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px;min-width:0">
          <div class="panel"><h3>Governor limits</h3><div class="body">${limHtml}</div></div>
          <div class="panel"><h3>Log levels</h3><div class="body levels">${D.header.levels.map((l) => `<span class="chip">${esc(l.category)} <b>${esc(l.level)}</b></span>`).join('') || '<span class="muted">Unknown</span>'}</div></div>
          <div class="panel"><h3>Top events</h3><div class="body" id="ev"></div></div>
        </div>
      </div></div>`;
    table($('#ev', el), [{ k: 0, label: 'Event', cls: 'mono' }, { k: 1, label: 'Count', num: true, fmt: (r) => n0(r[1]) }], D.eventCounts.slice(0, 15));
    el.onclick = (e) => {
      const go = e.target.closest('[data-go]');
      if (go) return show(go.dataset.go);
      const ins = e.target.closest('.insight');
      if (ins) {
        const i = D.insights[+ins.dataset.k];
        if (i.id != null) { select(i.id); show('tree'); TREE.reveal(i.id); }
        return;
      }
      const wf = e.target.closest('.wf');
      if (wf) { const n = byId.get(+wf.dataset.id); show('timeline'); TL.zoomTo(n); select(n.id); }
    };
  }

  // ---------- Timeline (flame chart) ----------
  const TL = { draw() {}, zoomTo() {} };
  function buildTimeline(el) {
    const ROW = 20, AXIS = 22;
    const hidden = new Set(saved.tlHidden || []);
    let q = '';
    const byDepth = [];
    const markers = [];
    (function walk(n, d) {
      for (const c of n.children) {
        if (LEAF.has(c.type)) { markers.push(c); continue; }
        (byDepth[d] = byDepth[d] || []).push(c);
        walk(c, d + 1);
      }
    })(D.root, 0);
    const maxDepth = byDepth.length;
    let v0 = D.root.start, v1 = D.root.end || D.root.start + 1;

    el.innerHTML = `
      <div class="toolbar">
        <input class="search" id="tlq" placeholder="Highlight… (name, SOQL text)">
        <div class="legend" id="tllg"></div>
        <div class="spacer" style="flex:1"></div>
        <span class="muted" style="font-size:11px">Scroll = zoom · drag = pan · double-click = zoom to frame · W/S/A/D</span>
        <button class="btn sm" id="tlreset">Reset zoom</button>
      </div>
      <div class="tl-wrap"><div class="tl-mini" id="mini"><canvas></canvas><div class="win" id="win"></div></div>
      <div class="tl-canvas" id="tlc"><canvas id="cv"></canvas></div></div>`;
    const wrap = $('#tlc', el), cv = $('#cv', el), ctx = cv.getContext('2d');
    const mini = $('#mini', el), mcv = $('canvas', mini), mctx = mcv.getContext('2d'), win = $('#win', el);
    const tip = $('#tip');
    legend($('#tllg', el), hidden, presentTypes().filter((t) => !LEAF.has(t)), () => { save({ tlHidden: [...hidden] }); draw(); });
    $('#tlq', el).oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
    $('#tlreset', el).onclick = () => { v0 = D.root.start; v1 = D.root.end || v0 + 1; draw(); };
    const font = `11px ${css.getPropertyValue('--vscode-font-family') || 'sans-serif'}`;
    const accent = css.getPropertyValue('--vscode-focusBorder').trim() || '#3b82f6';
    const fg = css.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';
    const muted = css.getPropertyValue('--vscode-descriptionForeground').trim() || '#888';
    const border = 'rgba(128,128,128,.25)';

    function niceStep(span, px) {
      const raw = span / Math.max(1, px / 110);
      const p = Math.pow(10, Math.floor(Math.log10(raw)));
      return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || raw;
    }
    function lowerBound(arr, t) {
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].end < t) lo = m + 1; else hi = m; }
      return lo;
    }
    function draw() {
      if (active !== 'timeline') return;
      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth;
      const H = AXIS + maxDepth * ROW + 12;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.font = font;
      const span = Math.max(1, v1 - v0), k = W / span;
      // axis
      const step = niceStep(span, W);
      ctx.fillStyle = muted; ctx.strokeStyle = border; ctx.lineWidth = 1;
      for (let t = Math.ceil((v0 - D.root.start) / step) * step + D.root.start; t <= v1; t += step) {
        const x = Math.round((t - v0) * k) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, AXIS - 4); ctx.lineTo(x, H); ctx.stroke();
        ctx.fillText(fmt(t - D.root.start), x + 3, 12);
      }
      // markers (debug + exceptions)
      for (const m of markers) {
        if (m.start < v0 || m.start > v1) continue;
        const x = (m.start - v0) * k;
        ctx.fillStyle = COLOR[m.type];
        if (m.type === 'DEBUG') ctx.fillRect(x, AXIS - 6, 1.5, 5);
        else { ctx.beginPath(); ctx.moveTo(x, AXIS - 1); ctx.lineTo(x - 4, AXIS - 8); ctx.lineTo(x + 4, AXIS - 8); ctx.fill(); }
      }
      let selRect = null;
      for (let d = 0; d < maxDepth; d++) {
        const arr = byDepth[d];
        const y = AXIS + d * ROW;
        for (let i = lowerBound(arr, v0); i < arr.length; i++) {
          const n = arr[i];
          if (n.start > v1) break;
          if (hidden.has(n.type)) continue;
          const x0 = (n.start - v0) * k, x1 = (n.end - v0) * k;
          const w = Math.max(x1 - x0, 1);
          if (x1 - x0 < 0.3 && n.id !== selId) continue;
          const dim = q && !n.name.toLowerCase().includes(q);
          ctx.globalAlpha = dim ? 0.18 : 1;
          ctx.fillStyle = COLOR[n.type] || '#888';
          ctx.fillRect(x0, y, w - (w > 3 ? 1 : 0), ROW - 2);
          if (w > 30) {
            const cx = Math.max(x0, 0) + 4, room = Math.min(x1, W) - cx - 3;
            const maxC = Math.floor(room / 6.1);
            if (maxC > 2) {
              const label = n.name.length > maxC ? n.name.slice(0, maxC - 1) + '…' : n.name;
              ctx.fillStyle = DARK_TEXT.has(n.type) ? '#111' : '#fff';
              ctx.fillText(label, cx, y + 13);
            }
          }
          if (n.id === selId) selRect = [x0, y, w, ROW - 2];
        }
      }
      ctx.globalAlpha = 1;
      if (selRect) {
        ctx.lineWidth = 2; ctx.strokeStyle = fg;
        ctx.strokeRect(selRect[0] - 1, selRect[1] - 1, selRect[2] + 2, selRect[3] + 2);
      }
      drawMini();
    }
    let miniDrawn = false;
    function drawMini() {
      const W = mini.clientWidth, H = mini.clientHeight, dpr = window.devicePixelRatio || 1;
      if (!miniDrawn || mcv.width !== W * dpr) {
        mcv.width = W * dpr; mcv.height = H * dpr;
        mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mctx.clearRect(0, 0, W, H);
        const k = W / rootDur, rows = Math.min(maxDepth, 8), rh = (H - 4) / Math.max(rows, 1);
        for (let d = 0; d < rows; d++) for (const n of byDepth[d]) {
          const w = n.dur * k; if (w < 0.3) continue;
          mctx.fillStyle = COLOR[n.type]; mctx.globalAlpha = 0.85;
          mctx.fillRect((n.start - D.root.start) * k, 2 + d * rh, Math.max(w, 1), rh - 0.5);
        }
        miniDrawn = true;
      }
      win.style.left = ((v0 - D.root.start) / rootDur) * 100 + '%';
      win.style.width = Math.max(0.3, ((v1 - v0) / rootDur) * 100) + '%';
    }
    function hit(ev) {
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const d = Math.floor((y - AXIS) / ROW);
      if (d < 0 || d >= maxDepth) return null;
      const t = v0 + (x / r.width) * (v1 - v0);
      const arr = byDepth[d];
      const tol = (2 / r.width) * (v1 - v0);
      for (let i = lowerBound(arr, t - tol); i < arr.length && arr[i].start <= t + tol; i++)
        if (!hidden.has(arr[i].type) && arr[i].start - tol <= t && arr[i].end + tol >= t) return arr[i];
      return null;
    }
    function zoomAt(factor, t) {
      const span = Math.min(rootDur * 1.05, Math.max(1000, (v1 - v0) * factor));
      const f = (t - v0) / (v1 - v0);
      v0 = t - f * span; v1 = v0 + span;
      clamp(); draw();
    }
    function clamp() {
      const span = v1 - v0;
      if (v0 < D.root.start - rootDur * 0.02) { v0 = D.root.start - rootDur * 0.02; v1 = v0 + span; }
      if (v1 > D.root.end + rootDur * 0.02) { v1 = D.root.end + rootDur * 0.02; v0 = v1 - span; }
    }
    cv.addEventListener('wheel', (e) => {
      if (e.shiftKey) return; // vertical scroll
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dt = (e.deltaX / r.width) * (v1 - v0); v0 += dt; v1 += dt; clamp(); draw(); return;
      }
      zoomAt(Math.exp(e.deltaY * 0.0018), v0 + ((e.clientX - r.left) / r.width) * (v1 - v0));
    }, { passive: false });
    let drag = null;
    cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, v0, v1, st: wrap.scrollTop, moved: false }; cv.classList.add('drag'); });
    window.addEventListener('mouseup', (e) => {
      if (!drag) return;
      cv.classList.remove('drag');
      if (!drag.moved && e.target === cv) { const n = hit(e); if (n) select(n.id); }
      drag = null;
    });
    window.addEventListener('mousemove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        const dt = (dx / cv.clientWidth) * (drag.v1 - drag.v0);
        v0 = drag.v0 - dt; v1 = drag.v1 - dt; clamp();
        wrap.scrollTop = drag.st - dy;
        draw(); tip.style.display = 'none'; return;
      }
    });
    cv.addEventListener('mousemove', (e) => {
      if (drag) return;
      const n = hit(e);
      if (!n) { tip.style.display = 'none'; return; }
      tip.innerHTML = `<div class="tn">${typeTag(n.type)}${esc(n.name.length > 400 ? n.name.slice(0, 400) + '…' : n.name)}</div>
        <div class="tr"><span>Total <b>${fmt(n.dur)}</b></span><span>Self <b>${fmt(n.self)}</b></span><span>At +${fmt(n.start - D.root.start)}</span></div>
        ${n.soql || n.dml || n.totalRows ? `<div class="tr"><span>SOQL ${n.soql}</span><span>DML ${n.dml}</span><span>Rows ${n0(n.totalRows)}</span></div>` : ''}`;
      tip.style.display = 'block';
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tw - 8) + 'px';
      tip.style.top = (e.clientY + 16 + th > window.innerHeight ? e.clientY - th - 10 : e.clientY + 16) + 'px';
    });
    cv.addEventListener('mouseleave', () => (tip.style.display = 'none'));
    cv.addEventListener('dblclick', (e) => { const n = hit(e); if (n) zoomTo(n); });
    function setFromMini(e) {
      const r = mini.getBoundingClientRect();
      const t = D.root.start + ((e.clientX - r.left) / r.width) * rootDur;
      const span = v1 - v0; v0 = t - span / 2; v1 = v0 + span; clamp(); draw();
    }
    let miniDrag = false;
    mini.addEventListener('mousedown', (e) => { miniDrag = true; setFromMini(e); });
    window.addEventListener('mousemove', (e) => miniDrag && setFromMini(e));
    window.addEventListener('mouseup', () => (miniDrag = false));
    document.addEventListener('keydown', (e) => {
      if (active !== 'timeline' || e.target.tagName === 'INPUT') return;
      const span = v1 - v0, mid = v0 + span / 2;
      if (e.key === 'w') zoomAt(0.75, mid);
      else if (e.key === 's') zoomAt(1.33, mid);
      else if (e.key === 'a') { v0 -= span * 0.15; v1 -= span * 0.15; clamp(); draw(); }
      else if (e.key === 'd') { v0 += span * 0.15; v1 += span * 0.15; clamp(); draw(); }
    });
    function zoomTo(n) {
      const pad = Math.max(n.dur * 0.08, 1000);
      v0 = n.start - pad; v1 = (n.end || n.start) + pad; clamp();
      select(n.id, { silent: true });
      requestAnimationFrame(() => {
        draw();
        const d = n.depth;
        const y = AXIS + d * ROW;
        if (y < wrap.scrollTop || y > wrap.scrollTop + wrap.clientHeight - ROW) wrap.scrollTop = y - wrap.clientHeight / 3;
      });
    }
    new ResizeObserver(() => { miniDrawn = false; draw(); }).observe(wrap);
    TL.draw = draw;
    TL.zoomTo = zoomTo;
    requestAnimationFrame(draw);
  }

  // ---------- Call tree (virtualized) ----------
  const TREE = { paint() {}, reveal() {} };
  function buildTree(el) {
    const ROW = 24;
    const expanded = new Set();
    const hidden = new Set(saved.treeHidden || []);
    let q = '', minDur = 0, rows = [];
    for (const n of all) if (n.depth < 2 && n.children.length && n.children.length < 300) expanded.add(n.id);
    el.innerHTML = `
      <div class="toolbar">
        <input class="search" id="tq" placeholder="Filter frames… (name, query, message)">
        <label>Min duration <input id="tmin" type="number" min="0" step="1" style="width:70px" placeholder="ms"></label>
        <div class="legend" id="tlg"></div>
        <div style="flex:1"></div>
        <button class="btn sm" id="texp">Expand all</button><button class="btn sm" id="tcol">Collapse all</button>
      </div>
      <div class="tree-wrap">
        <div class="tree-head"><div>Frame</div><div class="num">Total</div><div class="num">Self</div><div class="num">SOQL</div><div class="num">DML</div><div class="num">Rows</div><div></div></div>
        <div class="tree-scroll" id="ts" tabindex="0"><div id="tin" style="position:relative"></div></div>
      </div>`;
    const sc = $('#ts', el), inner = $('#tin', el);
    legend($('#tlg', el), hidden, presentTypes(), () => { save({ treeHidden: [...hidden] }); compute(); });
    $('#tq', el).oninput = (e) => { q = e.target.value.trim().toLowerCase(); compute(); };
    $('#tmin', el).oninput = (e) => { minDur = (parseFloat(e.target.value) || 0) * 1e6; compute(); };
    $('#texp', el).onclick = () => { all.forEach((n) => n.children.length && expanded.add(n.id)); compute(); };
    $('#tcol', el).onclick = () => { expanded.clear(); compute(); };

    function compute() {
      rows = [];
      let keep = null;
      if (q) {
        keep = new Set();
        for (const n of all) {
          if (!n.name.toLowerCase().includes(q)) continue;
          keep.add(n.id);
          let p = parentOf.get(n.id);
          while (p && !keep.has(p.id)) { keep.add(p.id); p = parentOf.get(p.id); }
        }
      }
      (function visit(n, depth) {
        for (const c of n.children) {
          if (hidden.has(c.type)) { if (!LEAF.has(c.type)) visit(c, depth); continue; }
          if (keep && !keep.has(c.id)) continue;
          if (minDur && !LEAF.has(c.type) && c.dur < minDur && !keep) continue;
          if (minDur && LEAF.has(c.type) && !keep) continue;
          rows.push({ n: c, depth });
          if (c.children.length && (keep || expanded.has(c.id))) visit(c, depth + 1);
        }
      })(D.root, 0);
      inner.style.height = rows.length * ROW + 'px';
      paint();
    }
    function paint() {
      if (active !== 'tree') return;
      const top = sc.scrollTop, h = sc.clientHeight || 600;
      const a = Math.max(0, Math.floor(top / ROW) - 15), b = Math.min(rows.length, Math.ceil((top + h) / ROW) + 15);
      let html = '';
      for (let i = a; i < b; i++) {
        const { n, depth } = rows[i];
        const has = n.children.length > 0;
        const open = q || expanded.has(n.id);
        const pct = Math.min(100, (n.dur / rootDur) * 100);
        const match = q && n.name.toLowerCase().includes(q);
        const leaf = LEAF.has(n.type);
        html += `<div class="tree-row ${n.id === selId ? 'sel' : ''} ${match ? 'match' : ''}" data-i="${i}" style="top:${i * ROW}px">
          <div class="name" style="padding-left:${8 + depth * 14}px" title="${esc(n.name.slice(0, 600))}"><span class="tw">${has ? (open ? '▾' : '▸') : ''}</span>${typeTag(n.type)}<span class="nm" ${n.type === 'EXCEPTION' || n.type === 'FATAL' ? 'style="color:var(--err)"' : ''}>${esc(n.name.slice(0, 300))}</span></div>
          <div class="durcell">${leaf ? '' : `<span>${fmt(n.dur)}</span><div class="db"><i style="width:${pct}%"></i></div>`}</div>
          <div class="num muted">${leaf ? '' : fmt(n.self)}</div>
          <div class="num">${n.soql || ''}</div><div class="num">${n.dml || ''}</div><div class="num">${n.totalRows ? n0(n.totalRows) : ''}</div>
          <div class="acts"><button class="ib" data-a="log" title="Show in log">↗</button></div>
        </div>`;
      }
      inner.innerHTML = html || (rows.length ? '' : '<div class="empty">No frames match.</div>');
    }
    sc.addEventListener('scroll', () => requestAnimationFrame(paint));
    new ResizeObserver(() => paint()).observe(sc);
    sc.addEventListener('click', (e) => {
      const r = e.target.closest('.tree-row');
      if (!r) return;
      const { n } = rows[+r.dataset.i];
      if (e.target.closest('.tw') && n.children.length) { expanded.has(n.id) ? expanded.delete(n.id) : expanded.add(n.id); compute(); return; }
      if (e.target.closest('[data-a="log"]')) { post({ cmd: 'reveal', line: n.line }); return; }
      select(n.id);
      sc.focus();
    });
    sc.addEventListener('dblclick', (e) => {
      const r = e.target.closest('.tree-row');
      if (!r || e.target.closest('.tw')) return;
      const { n } = rows[+r.dataset.i];
      if (n.children.length && !q) { expanded.has(n.id) ? expanded.delete(n.id) : expanded.add(n.id); compute(); }
      else post({ cmd: 'reveal', line: n.line });
    });
    sc.addEventListener('keydown', (e) => {
      const i = rows.findIndex((r) => r.n.id === selId);
      if (i < 0) return;
      const n = rows[i].n;
      let ni = i;
      if (e.key === 'ArrowDown') ni = Math.min(rows.length - 1, i + 1);
      else if (e.key === 'ArrowUp') ni = Math.max(0, i - 1);
      else if (e.key === 'ArrowRight' && n.children.length) { expanded.add(n.id); compute(); }
      else if (e.key === 'ArrowLeft') {
        if (expanded.has(n.id)) { expanded.delete(n.id); compute(); }
        else { const p = parentOf.get(n.id); if (p && p.type !== 'ROOT') { ni = rows.findIndex((r) => r.n.id === p.id); } }
      } else if (e.key === 'Enter') { post({ cmd: 'reveal', line: n.line }); }
      else return;
      e.preventDefault();
      if (ni !== i && ni >= 0) { select(rows[ni].n.id); ensureVisible(ni); }
    });
    function ensureVisible(i) {
      const y = i * ROW;
      if (y < sc.scrollTop) sc.scrollTop = y;
      else if (y + ROW > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + ROW - sc.clientHeight;
    }
    function reveal(id) {
      for (const a of ancestors(id)) expanded.add(a.id);
      const n = byId.get(id);
      if (n && hidden.has(n.type)) { hidden.delete(n.type); legend($('#tlg', el), hidden, presentTypes(), () => compute()); }
      if (q && !n.name.toLowerCase().includes(q)) { q = ''; $('#tq', el).value = ''; }
      minDur = 0; $('#tmin', el).value = '';
      compute();
      const i = rows.findIndex((r) => r.n.id === id);
      select(id, { silent: true });
      requestAnimationFrame(() => { if (i >= 0) sc.scrollTop = Math.max(0, i * ROW - sc.clientHeight / 3); paint(); });
    }
    TREE.paint = paint;
    TREE.reveal = reveal;
    compute();
  }

  // ---------- Analysis (aggregated) ----------
  function buildAnalysis(el) {
    const hidden = new Set();
    let q = '', groupBy = 'name';
    el.innerHTML = `
      <div class="toolbar">
        <input class="search" id="aq" placeholder="Filter by name…">
        <label>Group by <select id="ag"><option value="name">Frame name</option><option value="type">Type</option><option value="cls">Class / namespace</option></select></label>
        <div class="legend" id="alg"></div>
      </div><div style="flex:1;overflow:auto" id="at"></div>`;
    const cols = [
      { k: 'name', label: 'Name', cls: 'q', fmt: (r) => `<span class="clip">${r.type ? typeTag(r.type) : ''}${esc(r.name)}</span>` },
      { k: 'count', label: 'Count', num: true, fmt: (r) => n0(r.count) },
      { k: 'total', label: 'Total', num: true, fmt: (r) => fmt(r.total) },
      { k: 'self', label: 'Self', num: true, fmt: (r) => `<b>${fmt(r.self)}</b>` },
      { k: 'avg', label: 'Avg', num: true, sv: (r) => r.total / r.count, fmt: (r) => fmt(r.total / r.count) },
      { k: 'pct', label: '% self', num: true, sv: (r) => r.self, fmt: (r) => ((r.self / rootDur) * 100).toFixed(1) + '%' },
      { k: 'soql', label: 'SOQL', num: true },
      { k: 'dml', label: 'DML', num: true },
    ];
    const t = table($('#at', el), cols, [], {
      sort: { k: 'self', dir: -1 },
      empty: 'No method timing in this log — set APEX_CODE to FINE or higher.',
      onClick: (r) => r.firstId != null && select(r.firstId),
      onDbl: (r) => { if (r.firstId != null) { show('tree'); TREE.reveal(r.firstId); } },
    });
    function rowsFor() {
      let src = D.hotspots.filter((h) => !hidden.has(h.type) && (!q || h.name.toLowerCase().includes(q)));
      if (groupBy === 'name') return src;
      const g = new Map();
      for (const h of src) {
        const key = groupBy === 'type' ? NICE[h.type] : clsOf(h.name);
        const a = g.get(key) || { name: key, type: groupBy === 'type' ? h.type : null, count: 0, total: 0, self: 0, soql: 0, dml: 0, firstId: h.firstId };
        a.count += h.count; a.total += h.total; a.self += h.self; a.soql += h.soql; a.dml += h.dml;
        g.set(key, a);
      }
      return [...g.values()];
    }
    const clsOf = (name) => {
      const base = name.replace(/^new /, '').split('(')[0];
      const p = base.split('.');
      return p.length > 1 ? p.slice(0, -1).join('.') : base;
    };
    const refresh = () => t.set(rowsFor());
    legend($('#alg', el), hidden, ['CODE_UNIT', 'METHOD', 'FLOW', 'WORKFLOW', 'SYSTEM'].filter((x) => D.hotspots.some((h) => h.type === x)), refresh);
    $('#aq', el).oninput = (e) => { q = e.target.value.toLowerCase(); refresh(); };
    $('#ag', el).onchange = (e) => { groupBy = e.target.value; refresh(); };
    refresh();
  }

  // ---------- Database ----------
  const planTargets = new Map();
  function buildDatabase(el) {
    let mode = 'soql', grouped = false, q = '';
    el.innerHTML = `
      <div class="toolbar">
        <div class="subtabs"><button class="btn sm on" data-m="soql">SOQL (${D.soql.length})</button><button class="btn sm" data-m="dml">DML (${D.dml.length})</button></div>
        <input class="search" id="dq" placeholder="Filter…">
        <label><input type="checkbox" id="dg"> Group identical</label>
        <div style="flex:1"></div>
        <span class="muted" style="font-size:11px">${n0(D.stats.soqlRows)} query rows · ${n0(D.stats.dmlRows)} DML rows</span>
      </div><div style="flex:1;overflow:auto" id="dt"></div>`;
    const host = $('#dt', el);
    el.querySelector('.subtabs').onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      mode = b.dataset.m;
      el.querySelectorAll('.subtabs .btn').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    };
    $('#dg', el).onchange = (e) => { grouped = e.target.checked; draw(); };
    $('#dq', el).oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
    const from = (r) => `<span class="muted">${esc(r.from || '')}${r.srcLine ? ` <b>:${r.srcLine}</b>` : ''}</span>`;
    const rep = (r) => (r.repeats > 1 ? `<span class="badge ${r.repeats >= 3 ? 'warn' : ''}">×${r.repeats}</span>` : '');
    function draw() {
      if (mode === 'soql') {
        const rows = D.soql.filter((r) => !q || r.query.toLowerCase().includes(q) || (r.from || '').toLowerCase().includes(q));
        if (grouped) {
          const g = new Map();
          for (const r of rows) {
            const a = g.get(r.norm) || { query: r.norm, count: 0, rows: 0, dur: 0, locs: new Set(), id: r.id, sample: r.query };
            a.count++; a.rows += r.rows; a.dur += r.dur; a.locs.add((r.from || '?') + (r.srcLine ? ':' + r.srcLine : ''));
            g.set(r.norm, a);
          }
          table(host, [
            { k: 'query', label: 'Query (normalized)', cls: 'q', fmt: (r) => `<div class="clip">${esc(r.query)}</div><div class="plan-host" data-pid="${r.id}"></div>` },
            { k: 'count', label: 'Executions', num: true, fmt: (r) => `<span class="badge ${r.count >= 3 ? 'warn' : ''}">${r.count}</span>` },
            { k: 'rows', label: 'Rows', num: true, fmt: (r) => n0(r.rows) },
            { k: 'dur', label: 'Total time', num: true, fmt: (r) => fmt(r.dur) },
            { k: 'locs', label: 'Called from', sv: (r) => r.locs.size, fmt: (r) => `<span class="muted">${[...r.locs].slice(0, 4).map(esc).join('<br>')}</span>` },
            { k: 'x', label: '', fmt: (r) => `<button class="btn sm" data-plan="${r.id}">Plan</button>` },
          ], [...g.values()], { sort: { k: 'dur', dir: -1 }, onClick: dbClick, empty: 'No SOQL in this log.' });
        } else {
          table(host, [
            { k: 'id', label: '#', num: true, sv: (r) => r.line, fmt: (r) => `<span class="muted">${D.soql.indexOf(r) + 1}</span>` },
            { k: 'query', label: 'Query', cls: 'q', fmt: (r) => `<div class="clip">${esc(r.query)}</div><div class="plan-host" data-pid="${r.id}"></div>` },
            { k: 'rows', label: 'Rows', num: true, fmt: (r) => n0(r.rows) },
            { k: 'dur', label: 'Time', num: true, fmt: (r) => fmt(r.dur) },
            { k: 'repeats', label: 'Repeats', num: true, fmt: rep },
            { k: 'from', label: 'Called from', fmt: from },
            { k: 'x', label: '', fmt: (r) => `<button class="btn sm" data-plan="${r.id}">Plan</button>` },
          ], rows, { onClick: dbClick, onDbl: (r) => post({ cmd: 'reveal', line: r.line }), empty: 'No SOQL in this log.' });
        }
      } else {
        const rows = D.dml.filter((r) => !q || r.op.toLowerCase().includes(q) || (r.from || '').toLowerCase().includes(q));
        if (grouped) {
          const g = new Map();
          for (const r of rows) {
            const a = g.get(r.op) || { op: r.op, count: 0, rows: 0, dur: 0, id: r.id };
            a.count++; a.rows += r.rows; a.dur += r.dur;
            g.set(r.op, a);
          }
          table(host, [
            { k: 'op', label: 'Operation', cls: 'q' },
            { k: 'count', label: 'Executions', num: true, fmt: (r) => `<span class="badge ${r.count >= 3 ? 'warn' : ''}">${r.count}</span>` },
            { k: 'rows', label: 'Rows', num: true, fmt: (r) => n0(r.rows) },
            { k: 'dur', label: 'Total time', num: true, fmt: (r) => fmt(r.dur) },
          ], [...g.values()], { sort: { k: 'dur', dir: -1 }, onClick: dbClick, empty: 'No DML in this log.' });
        } else {
          table(host, [
            { k: 'id', label: '#', num: true, sv: (r) => r.line, fmt: (r) => `<span class="muted">${D.dml.indexOf(r) + 1}</span>` },
            { k: 'op', label: 'Operation', cls: 'q' },
            { k: 'rows', label: 'Rows', num: true, fmt: (r) => n0(r.rows) },
            { k: 'dur', label: 'Time (incl. triggers)', num: true, fmt: (r) => fmt(r.dur) },
            { k: 'repeats', label: 'Repeats', num: true, fmt: rep },
            { k: 'from', label: 'Called from', fmt: from },
          ], rows, { onClick: dbClick, onDbl: (r) => post({ cmd: 'reveal', line: r.line }), empty: 'No DML in this log.' });
        }
      }
    }
    function dbClick(r, e) {
      const pb = e.target.closest('[data-plan]');
      if (pb) {
        const id = +pb.dataset.plan;
        const n = byId.get(id);
        const hostEl = host.querySelector(`.plan-host[data-pid="${id}"]`);
        planTargets.set(id, hostEl);
        hostEl.innerHTML = '<div class="plan muted">Fetching query plan…</div>';
        post({ cmd: 'explain', id, query: n.name });
        return;
      }
      if (r.id != null) select(r.id);
    }
    draw();
  }
  function onPlan(m) {
    const el = planTargets.get(m.id);
    if (!el) return;
    if (m.error) { el.innerHTML = `<div class="plan"><span class="bad">Plan unavailable:</span> ${esc(m.error)}</div>`; return; }
    if (!m.plans.length) { el.innerHTML = '<div class="plan muted">No plan returned.</div>'; return; }
    el.innerHTML = `<div class="plan">${m.plans.map((p, i) => `
      <div class="row">${i === 0 ? '<b>Best plan</b>' : `<span class="muted">Alt ${i}</span>`}
        <span>${esc(p.leadingOperationType)}${(p.fields || p.relevantFields || []).length ? ' on ' + esc((p.fields || p.relevantFields).join(', ')) : ''}</span>
        <span>Cost <span class="${p.relativeCost < 1 ? 'good' : 'bad'}">${(+p.relativeCost).toFixed(2)} ${p.relativeCost < 1 ? '(selective)' : '(non-selective)'}</span></span>
        <span class="muted">~${n0(p.cardinality)} of ${n0(p.sobjectCardinality)} ${esc(p.sobjectType || '')} rows</span></div>
      ${(p.notes || []).map((n) => `<div class="muted">• ${esc(n.description)}${n.fields ? ' (' + esc(n.fields.join(', ')) + ')' : ''}</div>`).join('')}`).join('')}</div>`;
  }

  // ---------- Debug & errors ----------
  function buildDebug(el) {
    const levels = [...new Set(D.debugs.map((d) => d.level).filter(Boolean))];
    let q = '', lv = '', excOnly = false;
    el.innerHTML = `
      <div class="toolbar">
        <input class="search" id="gq" placeholder="Search messages… (supports /regex/)">
        <label>Level <select id="gl"><option value="">All</option>${levels.map((l) => `<option>${esc(l)}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="ge"> Exceptions only</label>
        <div style="flex:1"></div><span class="muted" id="gc" style="font-size:11px"></span>
      </div><div style="flex:1;overflow:auto" id="gl2"></div>`;
    const host = $('#gl2', el);
    const items = [
      ...D.debugs.map((d) => ({ ...d, kind: 'DEBUG' })),
      ...D.exceptions.map((x) => ({ ...x, kind: x.type, level: x.type === 'FATAL' ? 'FATAL' : 'EXCEPTION', ts: byId.get(x.id).start - D.root.start })),
    ].sort((a, b) => a.line - b.line);
    function draw() {
      let re = null;
      const m = /^\/(.+)\/(\w*)$/.exec(q);
      if (m) try { re = new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i'); } catch { re = null; }
      const ql = q.toLowerCase();
      const list = items.filter((d) => (!excOnly || d.kind !== 'DEBUG') && (!lv || d.level === lv) && (!q || (re ? re.test(d.msg) : d.msg.toLowerCase().includes(ql))));
      $('#gc', el).textContent = `${n0(list.length)} of ${n0(items.length)}`;
      host.innerHTML = list.slice(0, 2000).map((d) => `
        <div class="dbg ${d.kind !== 'DEBUG' ? 'exc' : ''}" data-id="${d.id}">
          <div class="muted mono">+${fmt(d.ts)}</div>
          <div class="lv lv-${esc(d.level)}">${d.kind !== 'DEBUG' ? typeTag(d.kind) : esc(d.level || '')}</div>
          <div style="min-width:0"><pre>${esc(d.msg)}</pre><div class="from">${esc(d.from || '')}${d.srcLine ? ' · line ' + d.srcLine : ''} · log line ${d.line + 1}</div></div>
        </div>`).join('') || '<div class="empty">No debug statements. Add System.debug() calls or raise APEX_CODE to DEBUG.</div>';
    }
    host.onclick = (e) => { const r = e.target.closest('.dbg'); if (r) select(+r.dataset.id); };
    host.ondblclick = (e) => { const r = e.target.closest('.dbg'); if (r) post({ cmd: 'reveal', line: byId.get(+r.dataset.id).line }); };
    $('#gq', el).oninput = (e) => { q = e.target.value.trim(); draw(); };
    $('#gl', el).onchange = (e) => { lv = e.target.value; draw(); };
    $('#ge', el).onchange = (e) => { excOnly = e.target.checked; draw(); };
    if (D.stats.exceptions && !D.stats.debugs) { excOnly = true; $('#ge', el).checked = true; }
    draw();
  }

  // ---------- Performance ----------
  function buildPerf(el) {
    const P = D.perf || { breakdown: {}, criticalPath: [], slowest: [], units: [] };
    const B = P.breakdown;
    const total = rootDur;
    const pct = (v) => (total ? (v / total) * 100 : 0);
    const segs = [
      ['Apex code', B.apex, COLOR.METHOD],
      ['SOQL', B.soql, COLOR.SOQL],
      ['DML (excl. triggers)', B.dml, COLOR.DML],
      ['Callouts', B.callout, COLOR.CALLOUT],
      ['Flows & automation', B.flow, COLOR.FLOW],
      ['System methods', B.system, COLOR.SYSTEM],
      ['Platform / untracked', B.platform, '#6e7781'],
    ].filter((s) => s[1] > 0);
    const cpuPct = P.cpu && P.cpu.max ? (P.cpu.used / P.cpu.max) * 100 : null;
    const heapPct = P.heap && P.heap.max ? (P.heap.used / P.heap.max) * 100 : null;
    const methods = D.hotspots.filter((h) => h.type === 'METHOD');
    const grade = (() => {
      const wall = total / 1e6;
      const c = cpuPct ?? 0;
      if (c >= 60 || wall >= 8000 || D.insights.some((i) => i.sev === 'error')) return ['Needs work', 'err', 'High CPU, long wall time or errors in this transaction.'];
      if (c >= 25 || wall >= 2000 || D.insights.some((i) => i.sev === 'warn')) return ['Fair', 'warn', 'Some hotspots worth reviewing.'];
      return ['Good', 'ok', 'No significant performance issues detected.'];
    })();
    const rating = (h) => {
      const sp = pct(h.self);
      if (sp >= 15) return '<span class="badge err">hot</span>';
      if (h.total / h.count >= 50e6) return '<span class="badge warn">slow</span>';
      if (h.count >= 1000) return '<span class="badge warn">chatty</span>';
      if (sp >= 5) return '<span class="badge">notable</span>';
      return '';
    };

    // recommendations
    const rec = [];
    if (pct(B.soql) >= 35) rec.push(['warn', `Database-bound — SOQL takes ${pct(B.soql).toFixed(0)}% of the time`, 'Check the Database tab for repeated or non-selective queries (use Plan) and add selective filters / indexes.']);
    if (pct(B.dml) >= 25) rec.push(['warn', `DML takes ${pct(B.dml).toFixed(0)}% of the time`, 'Combine DML into fewer bulk statements and review triggers fired by them.']);
    if (cpuPct != null && cpuPct >= 50) rec.push(['error', `CPU at ${cpuPct.toFixed(0)}% of the limit`, 'Reduce loops over large collections, avoid repeated describe/JSON work, cache results.']);
    if (heapPct != null && heapPct >= 50) rec.push(['warn', `Heap at ${heapPct.toFixed(0)}% of the limit`, 'Query fewer fields/rows, release large collections, process in batches.']);
    methods.filter((h) => h.count >= 1000).slice(0, 3).forEach((h) => rec.push(['info', `${h.name} called ${n0(h.count)} times`, `Total ${fmt(h.total)} — consider caching the result or moving it out of the loop.`, h.slowId]));
    methods.filter((h) => pct(h.self) >= 15).slice(0, 3).forEach((h) => rec.push(['warn', `${h.name} uses ${pct(h.self).toFixed(0)}% of the transaction (self time)`, `${n0(h.count)} call(s), slowest ${fmt(h.max)}.`, h.slowId]));
    D.insights.filter((i) => /loop/.test(i.title)).forEach((i) => rec.push(['warn', i.title, i.detail, i.id]));
    if (pct(B.callout) >= 30) rec.push(['info', `Callouts take ${pct(B.callout).toFixed(0)}% of the time`, 'Consider async processing (Queueable / Continuation) or caching responses.']);

    const kp = (v, l, s, cls = '') => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
    el.innerHTML = `<div class="pad perf">
      <div class="perf-top">
        <div class="grade g-${grade[1]}"><div class="gl">Transaction health</div><div class="gv">${grade[0]}</div><div class="gs">${grade[2]}</div></div>
        <div class="grid" style="flex:1">
          ${kp(fmt(total), 'Wall time', `${n0(D.stats.codeUnits)} code unit(s)`)}
          ${kp(P.cpu ? n0(P.cpu.used) + ' ms' : '—', 'CPU time', P.cpu ? `${cpuPct.toFixed(0)}% of ${n0(P.cpu.max)} ms` : 'needs APEX_PROFILING', cpuPct >= 60 ? 'bad' : '')}
          ${kp(fmt(B.soql + B.dml), 'Database time', `${pct(B.soql + B.dml).toFixed(0)}% · ${D.stats.soql} SOQL · ${D.stats.dml} DML`)}
          ${kp(P.heap ? (P.heap.used / 1024).toFixed(0) + ' KB' : '—', 'Heap', P.heap ? `${heapPct.toFixed(1)}% of limit` : '')}
          ${kp(n0(D.stats.methods), 'Method calls', `${n0(methods.length)} distinct`)}
        </div>
      </div>

      <div class="panel" style="margin-top:16px"><h3>Where the time went</h3><div class="body">
        <div class="stack">${segs.map((s) => `<i style="width:${pct(s[1])}%;background:${s[2]}" title="${s[0]}: ${fmt(s[1])} (${pct(s[1]).toFixed(1)}%)"></i>`).join('')}</div>
        <div class="stack-leg">${segs.map((s) => `<span><i style="background:${s[2]}"></i>${s[0]} <b>${fmt(s[1])}</b> <span class="muted">${pct(s[1]).toFixed(1)}%</span></span>`).join('')}</div>
        ${methods.length ? '' : '<div class="muted" style="margin-top:8px">Method-level timing is not in this log — set APEX_CODE to FINE (the “Analysis” trace preset) to see per-method performance.</div>'}
      </div></div>

      <div class="cols">
        <div class="panel"><h3>Critical path <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">— the slowest chain of nested calls</span></h3><div class="body cp">${P.criticalPath.length ? P.criticalPath.map((id, k) => {
          const n = byId.get(id);
          return `<div class="cp-row" data-id="${id}" style="padding-left:${Math.min(k, 14) * 12}px"><span class="nm">${typeTag(n.type)}${esc(n.name)}</span><span class="cp-bar"><i style="width:${pct(n.dur)}%;background:${COLOR[n.type]}"></i></span><span class="num">${fmt(n.dur)}</span><span class="num muted">${pct(n.dur).toFixed(0)}%</span></div>`;
        }).join('') : '<div class="muted">No nested calls.</div>'}</div></div>
        <div class="panel"><h3>Recommendations</h3>${rec.length ? rec.map((r, k) => `<div class="insight" data-rk="${k}"><div class="ic ${r[0]}">${r[0] === 'error' ? '!' : r[0] === 'warn' ? '▲' : 'i'}</div><div style="min-width:0"><div class="t">${esc(r[1])}</div><div class="d">${esc(r[2] || '')}</div></div></div>`).join('') : '<div class="ok-state">✓ Nothing stands out — this transaction looks efficient.</div>'}</div>
      </div>

      <div class="panel" style="margin-top:16px"><h3>Method performance</h3>
        <div class="toolbar" style="border-bottom:1px solid var(--border)"><input class="search" id="pq" placeholder="Filter methods…"><div class="legend" id="plg"></div><label><input type="checkbox" id="phot"> Only flagged</label></div>
        <div id="pmt" style="max-height:480px;overflow:auto"></div></div>

      <div class="cols">
        <div class="panel"><h3>Slowest individual calls</h3><div id="pslow" style="max-height:420px;overflow:auto"></div></div>
        <div class="panel"><h3>Code units</h3><div id="punits" style="max-height:420px;overflow:auto"></div></div>
      </div>
    </div>`;

    const hidden = new Set();
    let q = '', hotOnly = false;
    const mt = table($('#pmt', el), [
      { k: 'name', label: 'Method', cls: 'q', fmt: (r) => `<span class="clip">${typeTag(r.type)}${esc(r.name)} ${rating(r)}</span>` },
      { k: 'count', label: 'Calls', num: true, fmt: (r) => n0(r.count) },
      { k: 'total', label: 'Total', num: true, fmt: (r) => fmt(r.total) },
      { k: 'self', label: 'Self', num: true, fmt: (r) => `<div class="cellbar"><b>${fmt(r.self)}</b><span><i style="width:${Math.min(100, pct(r.self))}%"></i></span></div>` },
      { k: 'avg', label: 'Avg', num: true, sv: (r) => r.total / r.count, fmt: (r) => fmt(r.total / r.count) },
      { k: 'median', label: 'Median', num: true, fmt: (r) => fmt(r.median) },
      { k: 'p95', label: 'p95', num: true, fmt: (r) => fmt(r.p95) },
      { k: 'max', label: 'Max', num: true, fmt: (r) => fmt(r.max) },
      { k: 'pct', label: '% self', num: true, sv: (r) => r.self, fmt: (r) => pct(r.self).toFixed(1) + '%' },
      { k: 'soql', label: 'SOQL', num: true },
      { k: 'dml', label: 'DML', num: true },
      { k: 'rows', label: 'Rows', num: true, fmt: (r) => n0(r.rows) },
    ], [], {
      sort: { k: 'self', dir: -1 },
      empty: 'No method timing in this log — use the Analysis trace preset (APEX_CODE FINE).',
      onClick: (r) => select(r.slowId),
      onDbl: (r) => { show('tree'); TREE.reveal(r.slowId); },
    });
    const refresh = () => mt.set(D.hotspots.filter((h) => !hidden.has(h.type) && (!q || h.name.toLowerCase().includes(q)) && (!hotOnly || rating(h))));
    legend($('#plg', el), hidden, ['METHOD', 'CODE_UNIT', 'FLOW', 'WORKFLOW', 'SYSTEM'].filter((t) => D.hotspots.some((h) => h.type === t)), refresh);
    $('#pq', el).oninput = (e) => { q = e.target.value.toLowerCase(); refresh(); };
    $('#phot', el).onchange = (e) => { hotOnly = e.target.checked; refresh(); };
    refresh();

    const parentName = (id) => { const p = parentOf.get(id); return p && p.type !== 'ROOT' ? p.name : ''; };
    table($('#pslow', el), [
      { k: 'name', label: 'Call', cls: 'q', fmt: (r) => `<span class="clip">${typeTag(r.type)}${esc(r.name)}</span><div class="muted small">in ${esc(parentName(r.id))}</div>` },
      { k: 'dur', label: 'Duration', num: true, fmt: (r) => `<b>${fmt(r.dur)}</b>` },
      { k: 'self', label: 'Self', num: true, fmt: (r) => fmt(r.self) },
      { k: 'start', label: 'At', num: true, fmt: (r) => '+' + fmt(r.start - D.root.start) },
    ], P.slowest.map((id) => byId.get(id)), { onClick: (r) => select(r.id), onDbl: (r) => { show('timeline'); TL.zoomTo(r); }, empty: 'No calls.' });

    table($('#punits', el), [
      { k: 'name', label: 'Code unit', cls: 'q', fmt: (r) => `<span class="clip">${typeTag(r.type)}${esc(r.name)}</span>` },
      { k: 'dur', label: 'Total', num: true, fmt: (r) => fmt(r.dur) },
      { k: 'share', label: 'Share', num: true, sv: (r) => r.dur, fmt: (r) => pct(r.dur).toFixed(1) + '%' },
      { k: 'soql', label: 'SOQL', num: true },
      { k: 'dml', label: 'DML', num: true },
      { k: 'totalRows', label: 'Rows', num: true, fmt: (r) => n0(r.totalRows) },
    ], P.units.map((id) => byId.get(id)), { sort: { k: 'dur', dir: -1 }, onClick: (r) => select(r.id), onDbl: (r) => { show('timeline'); TL.zoomTo(r); }, empty: 'No code units.' });

    el.addEventListener('click', (e) => {
      const cp = e.target.closest('.cp-row');
      if (cp) { select(+cp.dataset.id); return; }
      const ins = e.target.closest('[data-rk]');
      if (ins) { const r = rec[+ins.dataset.rk]; if (r[3] != null) { select(r[3]); show('tree'); TREE.reveal(r[3]); } }
    });
    el.addEventListener('dblclick', (e) => { const cp = e.target.closest('.cp-row'); if (cp) { show('timeline'); TL.zoomTo(byId.get(+cp.dataset.id)); } });
  }

  // ---------- Log viewer (formatted raw log) ----------
  const LOGV = { paint() {}, goto() {} };
  function buildLog(el) {
    const CATS = [
      ['unit', 'Code units', COLOR.CODE_UNIT, true],
      ['method', 'Methods', COLOR.METHOD, true],
      ['db', 'SOQL / DML', COLOR.SOQL, true],
      ['debug', 'Debug', COLOR.DEBUG, true],
      ['error', 'Errors', COLOR.EXCEPTION, true],
      ['flow', 'Flow / Workflow', COLOR.FLOW, true],
      ['callout', 'Callouts', COLOR.CALLOUT, true],
      ['limits', 'Limits', '#c9a227', true],
      ['system', 'System', COLOR.SYSTEM, false],
      ['vars', 'Variables & statements', '#8b949e', false],
      ['other', 'Other', '#6e7781', true],
    ];
    const CI = Object.fromEntries(CATS.map((c, i) => [c[0], i]));
    const catOf = (t) => {
      if (/^(CODE_UNIT|EXECUTION)_/.test(t)) return CI.unit;
      if (/^(METHOD|CONSTRUCTOR)_/.test(t)) return CI.method;
      if (/^(SOQL|SOSL|DML|QUERY)_/.test(t)) return CI.db;
      if (t === 'USER_DEBUG') return CI.debug;
      if (/EXCEPTION|FATAL|_ERROR|_FAULT|VALIDATION_FAIL/.test(t)) return CI.error;
      if (/^(FLOW|WF|VALIDATION|PROCESS)_/.test(t)) return CI.flow;
      if (/^(CALLOUT|NAMED_CREDENTIAL)_/.test(t)) return CI.callout;
      if (/LIMIT|PROFILING/.test(t)) return CI.limits;
      if (/^SYSTEM_/.test(t)) return CI.system;
      if (/^(VARIABLE|STATEMENT|HEAP)_/.test(t)) return CI.vars;
      return CI.other;
    };
    const BEG = /^(CODE_UNIT_STARTED|EXECUTION_STARTED|METHOD_ENTRY|CONSTRUCTOR_ENTRY|SYSTEM_METHOD_ENTRY|SYSTEM_CONSTRUCTOR_ENTRY|SOQL_EXECUTE_BEGIN|SOSL_EXECUTE_BEGIN|DML_BEGIN|CALLOUT_REQUEST|FLOW_START_INTERVIEW_BEGIN|FLOW_START_INTERVIEWS_BEGIN|FLOW_ELEMENT_BEGIN|WF_RULE_EVAL_BEGIN)$/;
    const END = /^(CODE_UNIT_FINISHED|EXECUTION_FINISHED|METHOD_EXIT|CONSTRUCTOR_EXIT|SYSTEM_METHOD_EXIT|SYSTEM_CONSTRUCTOR_EXIT|SOQL_EXECUTE_END|SOSL_EXECUTE_END|DML_END|CALLOUT_RESPONSE|FLOW_START_INTERVIEW_END|FLOW_START_INTERVIEWS_END|FLOW_ELEMENT_END|WF_RULE_EVAL_END)$/;
    const RE = /^(\d{1,2}:\d{2}:\d{2}\.\d+) \((\d+)\)\|([A-Z_]+)\|?/;
    const lines = (D.raw || '').split(/\r?\n/);
    const N = lines.length;
    const cat = new Uint8Array(N), depth = new Uint16Array(N), restAt = new Uint32Array(N);
    const evt = new Array(N), ts = new Float64Array(N);
    const counts = new Array(CATS.length).fill(0);
    let d = 0, lastCat = CI.other, first = null;
    for (let i = 0; i < N; i++) {
      const m = RE.exec(lines[i]);
      if (m) {
        const t = m[3];
        if (END.test(t)) d = Math.max(0, d - 1);
        const c = catOf(t);
        cat[i] = c; depth[i] = d; evt[i] = t; restAt[i] = m[0].length;
        const n = Number(m[2]);
        if (first === null) first = n;
        ts[i] = n - first;
        counts[c]++;
        if (BEG.test(t)) d++;
        lastCat = c;
      } else {
        cat[i] = i === 0 ? CI.other : lastCat;
        depth[i] = d; evt[i] = null; ts[i] = NaN;
      }
    }
    const on = new Set(saved.logCats || CATS.filter((c) => c[3]).map((c) => c[0]));
    let q = '', useRe = false, onlyMatch = false, wrapIndent = true;
    let vis = [], matches = [], mPos = -1, sel = -1;
    const ROW = 20;
    el.innerHTML = `
      <div class="toolbar lv-tools">
        <div class="lv-search"><input class="search" id="lq" placeholder="Search log…  (Enter = next, Shift+Enter = previous)"><button class="btn sm" id="lre" title="Regular expression">.*</button></div>
        <span class="muted lv-mc" id="lmc"></span>
        <button class="btn sm" id="lprev" title="Previous match">↑</button><button class="btn sm" id="lnext" title="Next match">↓</button>
        <label><input type="checkbox" id="lonly"> Only matching lines</label>
        <label><input type="checkbox" id="lind" checked> Indent by call depth</label>
        <div style="flex:1"></div>
        <span class="muted" style="font-size:11px">Jump to next:</span>
        <button class="btn sm" data-j="error" style="color:var(--err)">Error</button><button class="btn sm" data-j="db">SOQL/DML</button><button class="btn sm" data-j="debug">Debug</button><button class="btn sm" data-j="unit">Code unit</button>
      </div>
      <div class="toolbar lv-cats" id="lcats"></div>
      <div class="lv-scroll" id="ls" tabindex="0"><div id="lin" style="position:relative"></div></div>
      <div class="lv-foot" id="lfoot"><span class="muted">Click a line to inspect it · double-click to open it in the editor</span></div>`;
    const sc = $('#ls', el), inner = $('#lin', el), foot = $('#lfoot', el);
    function drawCats() {
      $('#lcats', el).innerHTML = CATS.map((c, i) => `<button class="lg ${on.has(c[0]) ? '' : 'off'}" data-c="${c[0]}"><i style="background:${c[2]}"></i>${c[1]} <span class="muted">${n0(counts[i])}</span></button>`).join('') +
        `<button class="btn sm" id="lall">All</button><button class="btn sm" id="lreset">Default</button>`;
    }
    drawCats();
    $('#lcats', el).onclick = (e) => {
      if (e.target.id === 'lall') CATS.forEach((c) => on.add(c[0]));
      else if (e.target.id === 'lreset') { on.clear(); CATS.filter((c) => c[3]).forEach((c) => on.add(c[0])); }
      else {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        on.has(b.dataset.c) ? on.delete(b.dataset.c) : on.add(b.dataset.c);
      }
      save({ logCats: [...on] });
      drawCats();
      compute(true);
    };
    let reObj = null;
    function matcher() {
      if (!q) return null;
      if (useRe) { try { reObj = new RegExp(q, 'gi'); return (s) => { reObj.lastIndex = 0; return reObj.test(s); }; } catch { return null; } }
      const lq = q.toLowerCase();
      return (s) => s.toLowerCase().includes(lq);
    }
    function compute(keepSel) {
      const mt = matcher();
      const onIdx = new Set([...on].map((c) => CI[c]));
      vis = [];
      matches = [];
      for (let i = 0; i < N; i++) {
        if (!onIdx.has(cat[i]) && i !== 0) continue;
        const hit = mt ? mt(lines[i]) : false;
        if (onlyMatch && mt && !hit) continue;
        if (hit) matches.push(vis.length);
        vis.push(i);
      }
      $('#lmc', el).textContent = q ? (matches.length ? `${mPos >= 0 ? mPos + 1 : 0} / ${n0(matches.length)}` : 'No matches') : `${n0(vis.length)} of ${n0(N)} lines`;
      inner.style.height = vis.length * ROW + 'px';
      if (!keepSel) mPos = -1;
      paint();
    }
    const hl = (s) => {
      if (!q) return esc(s);
      try {
        const re = useRe ? new RegExp(q, 'gi') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        let out = '', last = 0, m;
        while ((m = re.exec(s)) && m[0].length) { out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
        return out + esc(s.slice(last));
      } catch { return esc(s); }
    };
    function fmtRest(s) {
      // [12] source line badges + soften pipes
      return hl(s).replace(/^\[(\d+)\]\|?/, '<span class="lv-src">L$1</span>').replace(/\|/g, '<span class="lv-pipe">│</span>');
    }
    function paint() {
      if (active !== 'log') return;
      const top = sc.scrollTop, h = sc.clientHeight || 600;
      const a = Math.max(0, Math.floor(top / ROW) - 20), b = Math.min(vis.length, Math.ceil((top + h) / ROW) + 20);
      const cur = mPos >= 0 ? matches[mPos] : -1;
      let html = '';
      for (let k = a; k < b; k++) {
        const i = vis[k];
        const c = CATS[cat[i]];
        const t = evt[i];
        const ind = wrapIndent ? Math.min(depth[i], 40) * 14 : 0;
        const time = isNaN(ts[i]) ? '' : fmt(ts[i]);
        const body = i === 0
          ? `<span class="lv-hdr">${hl(lines[i])}</span>`
          : t
          ? `<span class="lv-ev" style="--c:${c[2]}">${esc(t)}</span><span class="lv-rest ${cat[i] === CI.error ? 'err' : cat[i] === CI.debug ? 'lv-dbg' : ''}">${fmtRest(lines[i].slice(restAt[i]))}</span>`
          : `<span class="lv-cont">${hl(lines[i])}</span>`;
        html += `<div class="lv-row ${i === sel ? 'sel' : ''} ${k === cur ? 'cur' : ''}" data-i="${i}" style="top:${k * ROW}px"><span class="lv-ln">${i + 1}</span><span class="lv-ts">${time}</span><span class="lv-bar" style="background:${c[2]}"></span><span class="lv-body" style="padding-left:${ind}px">${body}</span></div>`;
      }
      inner.innerHTML = html;
    }
    function scrollToVis(k) {
      if (k < 0) return;
      const y = k * ROW;
      if (y < sc.scrollTop + ROW || y > sc.scrollTop + sc.clientHeight - ROW * 2) sc.scrollTop = Math.max(0, y - sc.clientHeight / 3);
      paint();
    }
    function step(dir) {
      if (!matches.length) return;
      mPos = (mPos + dir + matches.length) % matches.length;
      sel = vis[matches[mPos]];
      $('#lmc', el).textContent = `${mPos + 1} / ${n0(matches.length)}`;
      scrollToVis(matches[mPos]);
      showLine(sel);
    }
    function showLine(i) {
      const node = lineNode(i);
      foot.innerHTML = `<div class="lv-full"><span class="muted">Line ${i + 1}${isNaN(ts[i]) ? '' : ' · +' + fmt(ts[i])}${evt[i] ? ' · ' + esc(evt[i]) : ''}</span><pre>${hl(lines[i])}</pre></div>
        <div class="lv-acts"><button class="btn sm" data-x="ed">↗ Open in editor</button>${node ? '<button class="btn sm" data-x="tree">Show in call tree</button>' + (!LEAF.has(node.type) ? '<button class="btn sm" data-x="tl">Show in timeline</button>' : '') : ''}<button class="btn sm" data-x="copy">Copy line</button></div>`;
      foot.onclick = (e) => {
        const b = e.target.closest('[data-x]');
        if (!b) return;
        if (b.dataset.x === 'ed') post({ cmd: 'reveal', line: i });
        if (b.dataset.x === 'copy') post({ cmd: 'copy', text: lines[i] });
        if (b.dataset.x === 'tree') { select(node.id, { silent: true }); show('tree'); TREE.reveal(node.id); }
        if (b.dataset.x === 'tl') { show('timeline'); TL.zoomTo(node); }
      };
    }
    let lineIdx = null;
    function lineNode(i) {
      if (!lineIdx) { lineIdx = new Map(); for (const n of all) if (!lineIdx.has(n.line)) lineIdx.set(n.line, n); }
      return lineIdx.get(i);
    }
    let qt;
    $('#lq', el).addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value; compute(); if (matches.length) step(1); }, 160); });
    $('#lq', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } });
    $('#lre', el).onclick = (e) => { useRe = !useRe; e.target.classList.toggle('on', useRe); compute(); };
    $('#lprev', el).onclick = () => step(-1);
    $('#lnext', el).onclick = () => step(1);
    $('#lonly', el).onchange = (e) => { onlyMatch = e.target.checked; compute(); };
    $('#lind', el).onchange = (e) => { wrapIndent = e.target.checked; paint(); };
    el.querySelector('.lv-tools').addEventListener('click', (e) => {
      const j = e.target.closest('[data-j]');
      if (!j) return;
      const want = CI[j.dataset.j];
      if (!on.has(j.dataset.j)) { on.add(j.dataset.j); drawCats(); compute(true); }
      const startK = sel >= 0 ? vis.indexOf(sel) : -1;
      for (let k = startK + 1; k < vis.length; k++) {
        const i = vis[k];
        if (cat[i] === want && evt[i]) { sel = i; scrollToVis(k); showLine(i); return; }
      }
      foot.innerHTML = `<span class="muted">No more ${CATS[want][1].toLowerCase()} lines below the current position.</span>`;
    });
    sc.addEventListener('scroll', () => requestAnimationFrame(paint));
    new ResizeObserver(() => paint()).observe(sc);
    sc.addEventListener('click', (e) => { const r = e.target.closest('.lv-row'); if (!r) return; sel = +r.dataset.i; paint(); showLine(sel); });
    sc.addEventListener('dblclick', (e) => { const r = e.target.closest('.lv-row'); if (r) post({ cmd: 'reveal', line: +r.dataset.i }); });
    document.addEventListener('keydown', (e) => {
      if (active !== 'log') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); $('#lq', el).focus(); $('#lq', el).select(); }
      if (e.key === 'F3') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    });
    LOGV.paint = paint;
    LOGV.goto = (line) => {
      let k = vis.indexOf(line);
      if (k < 0) { CATS.forEach((c) => on.add(c[0])); drawCats(); compute(true); k = vis.indexOf(line); }
      sel = line;
      requestAnimationFrame(() => { scrollToVis(k); showLine(line); });
    };
    compute();
  }

  // ---------- summary ----------
  function summaryMarkdown() {
    const s = D.stats, m = D.meta;
    const lines = [
      `### Apex log — ${m.operation || m.title}`,
      `${m.user ? `User: ${m.user} · ` : ''}${m.status ? `Status: ${m.status} · ` : ''}Duration: ${fmt(s.duration)} · Size: ${bytes(m.size)}`,
      '',
      `| SOQL | DML | Rows (Q/D) | Callouts | Exceptions | Debug |`,
      `|---|---|---|---|---|---|`,
      `| ${s.soql} | ${s.dml} | ${s.soqlRows}/${s.dmlRows} | ${s.callouts} | ${s.exceptions} | ${s.debugs} |`,
    ];
    if (D.insights.length) { lines.push('', '**Insights**'); D.insights.forEach((i) => lines.push(`- ${i.sev.toUpperCase()}: ${i.title}`)); }
    const top = D.hotspots.slice(0, 5);
    if (top.length) { lines.push('', '**Top self time**'); top.forEach((h) => lines.push(`- ${h.name} — ${fmt(h.self)} (${h.count}×)`)); }
    const lim = D.limits.filter((l) => l.used > 0).sort((a, b) => b.pct - a.pct).slice(0, 6);
    if (lim.length) { lines.push('', '**Limits**'); lim.forEach((l) => lines.push(`- ${l.name}: ${l.used}/${l.max}`)); }
    return lines.join('\n');
  }
})();

// OrgLens — Trace Flags & Debug Levels page
(() => {
  'use strict';
  const { call, esc, I, toast, when } = window.SFLS;
  const LEVELS = ['NONE', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINER', 'FINEST'];
  const DUR = [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours'], [1440, '24 hours']];
  const KINDS = [
    ['users', 'Users', I.user],
    ['automated', 'Automated Process', I.bot],
    ['integration', 'Integration', I.ext],
    ['guest', 'Guest / Site', I.user],
    ['apex', 'Apex classes & triggers', I.code],
  ];

  let el, flags = [], levels = [], presets = {}, cats = [];
  let showExpired = false;
  const picked = new Map(); // id -> {name, sub, kind}
  const checked = new Set();
  let kind = 'users', term = '', results = [], searching = false;

  window.SFLS.pages.trace = {
    build(root) {
      el = root;
      el.innerHTML = `<div class="tf">
        <div class="tf-main">
          <div class="sec-head"><h3>Active trace flags</h3><span class="muted" id="tfCount"></span><span style="flex:1"></span>
            <label class="muted chk"><input type="checkbox" id="tfExp"> Show expired</label>
            <button class="btn sm" id="tfReload">${I.refresh} Reload</button></div>
          <div class="bulk" id="tfBulk"><b id="tfSel"></b> selected
            <select id="tfExtSel"><option value="">Extend by…</option>${DUR.map(([m, l]) => `<option value="${m}">${l}</option>`).join('')}</select>
            <select id="tfLvlSel"><option value="">Change level…</option></select>
            <button class="btn sm danger" id="tfDel">${I.trash} Remove</button></div>
          <div id="tfTable" class="card flush"></div>

          <div class="sec-head" style="margin-top:22px"><h3>Debug levels</h3><span class="muted">What each trace captures. Presets created by OrgLens start with <code>OrgLens_</code>.</span><span style="flex:1"></span>
            <button class="btn sm" id="dlNew">${I.plus} New debug level</button></div>
          <div id="dlTable" class="card flush"></div>
        </div>

        <aside class="tf-side card">
          <h3 style="margin-top:0">${I.plus} Add trace flags</h3>
          <div class="step"><span class="n">1</span>Who should be traced?</div>
          <div class="seg" id="tfKinds">${KINDS.map(([k, l, ic]) => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${ic}${l}</button>`).join('')}</div>
          <div class="who-search"><input id="tfQ" placeholder="Search by name or username…"><button class="btn sm" id="tfMe" title="Add yourself">${I.user} Me</button></div>
          <div class="who-list" id="tfResults"></div>
          <div class="chips" id="tfPicked"></div>
          <div class="step"><span class="n">2</span>Debug level</div>
          <select id="tfLevel" style="width:100%"></select>
          <div class="lvl-preview" id="tfLvlPrev"></div>
          <div class="step"><span class="n">3</span>Duration</div>
          <div class="seg dur" id="tfDur">${DUR.map(([m, l]) => `<button data-m="${m}" class="${m === 60 ? 'on' : ''}">${l}</button>`).join('')}</div>
          <button class="btn primary block" id="tfStart" disabled>${I.record} Start tracing</button>
          <p class="muted hint">Your own user gets a <b>DEVELOPER_LOG</b> flag; everyone else gets <b>USER_DEBUG</b> (Automated Process covers platform events, async flows and many async jobs). Apex classes/triggers get <b>CLASS_TRACING</b> overrides. Max 24 h.</p>
        </aside>
      </div>`;
      const $ = (s) => el.querySelector(s);
      $('#tfReload').onclick = () => loadFlags(true);
      $('#tfExp').onchange = (e) => { showExpired = e.target.checked; drawFlags(); };
      $('#tfKinds').onclick = (e) => {
        const b = e.target.closest('[data-k]');
        if (!b) return;
        kind = b.dataset.k;
        el.querySelectorAll('#tfKinds button').forEach((x) => x.classList.toggle('on', x === b));
        search();
      };
      let t;
      $('#tfQ').oninput = (e) => { term = e.target.value.trim(); clearTimeout(t); t = setTimeout(search, 280); };
      $('#tfMe').onclick = () => {
        const s = window.SFLS.getState();
        if (s.org) { picked.set(s.org.userId, { name: s.org.userName || 'Me', sub: s.org.username, kind: 'User' }); drawPicked(); }
      };
      $('#tfResults').onclick = (e) => {
        const r = e.target.closest('[data-id]');
        if (!r) return;
        const x = results.find((y) => y.Id === r.dataset.id);
        if (picked.has(x.Id)) picked.delete(x.Id);
        else picked.set(x.Id, { name: x.Name, sub: x.Username || x.NamespacePrefix || '', kind: kindLabel(x) });
        drawResults();
        drawPicked();
      };
      $('#tfPicked').onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) { picked.delete(c.dataset.id); drawResults(); drawPicked(); } };
      $('#tfDur').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) el.querySelectorAll('#tfDur button').forEach((x) => x.classList.toggle('on', x === b)); };
      $('#tfLevel').onchange = drawLvlPreview;
      $('#tfStart').onclick = startTracing;
      $('#tfExtSel').onchange = async (e) => {
        const m = Number(e.target.value);
        e.target.value = '';
        if (!m || !checked.size) return;
        await act(() => call('extendTraces', { ids: [...checked], minutes: m }), `Extended ${checked.size} trace flag(s)`);
      };
      $('#tfLvlSel').onchange = async (e) => {
        const v = e.target.value;
        e.target.value = '';
        if (!v || !checked.size) return;
        const id = await resolveLevel(v);
        await act(() => call('changeTraceLevel', { ids: [...checked], debugLevelId: id }), 'Debug level changed');
      };
      $('#tfDel').onclick = async () => {
        if (!(await call('confirm', { message: `Remove ${checked.size} trace flag(s)?`, action: 'Remove' }))) return;
        await act(() => call('deleteTraces', { ids: [...checked] }), 'Trace flag(s) removed');
        checked.clear();
      };
      $('#tfTable').onclick = flagClick;
      $('#tfTable').onchange = flagChange;
      $('#dlNew').onclick = () => editLevel(null);
      $('#dlTable').onclick = levelClick;
      init();
    },
    shown() { loadFlags(); },
  };

  const kindLabel = (x) =>
    x.kind || (x.UserType === 'AutomatedProcess' ? 'Automated Process' : x.UserType === 'Guest' ? 'Guest user' : x.UserType === 'CloudIntegrationUser' ? 'Integration' : 'User');

  async function init() {
    try {
      const p = await call('presets');
      presets = p.presets;
      cats = p.cats;
    } catch (e) { toast(e.message, 'error'); }
    await Promise.all([loadFlags(), loadLevels(), search()]);
  }

  async function act(fn, ok) {
    try {
      await fn();
      toast(ok, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    await loadFlags();
  }

  async function loadFlags() {
    try {
      flags = await call('traceFlags');
    } catch (e) {
      flags = [];
      toast(e.message, 'error');
    }
    drawFlags();
  }
  async function loadLevels() {
    try {
      levels = await call('debugLevels');
    } catch (e) {
      levels = [];
      toast(e.message, 'error');
    }
    drawLevels();
    fillLevelSelects();
  }

  // ---- flags table ----
  function drawFlags() {
    const list = flags.filter((f) => showExpired || f.active);
    for (const id of [...checked]) if (!list.some((f) => f.id === id)) checked.delete(id);
    el.querySelector('#tfCount').textContent = `${flags.filter((f) => f.active).length} active · ${flags.length} total`;
    el.querySelector('#tfBulk').classList.toggle('show', checked.size > 0);
    el.querySelector('#tfSel').textContent = checked.size;
    const me = (window.SFLS.getState().org || {}).userId;
    el.querySelector('#tfTable').innerHTML = list.length
      ? `<table class="lt"><thead><tr><th style="width:28px"><input type="checkbox" id="tfAll"></th><th>Traced entity</th><th>Log type</th><th>Debug level</th><th>Expires</th><th></th></tr></thead><tbody>${list
          .map((f) => {
            const left = new Date(f.exp) - Date.now();
            const total = Math.max(1, new Date(f.exp) - new Date(f.start));
            const pct = Math.max(0, Math.min(100, (left / total) * 100));
            return `<tr data-id="${f.id}" class="${checked.has(f.id) ? 'checked' : ''} ${f.active ? '' : 'dim'}">
              <td><input type="checkbox" class="chk" ${checked.has(f.id) ? 'checked' : ''}></td>
              <td><div class="ent"><span class="kind k-${esc(f.entity.kind.replace(/\W/g, ''))}">${esc(f.entity.kind)}</span><b>${esc(f.entity.name)}</b>${f.entityId === me ? ' <span class="badge">you</span>' : ''}</div><div class="muted small">${esc(f.entity.sub || f.entityId)}</div></td>
              <td><span class="mono small">${esc(f.logType)}</span></td>
              <td><select class="lvl" data-id="${f.id}">${levelOptions(f.debugLevelId)}</select></td>
              <td style="min-width:150px">${f.active ? `<div>${fmtLeft(left)} left</div><div class="meter"><i style="width:${pct}%" class="${pct < 15 ? 'low' : ''}"></i></div><div class="muted small">until ${new Date(f.exp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>` : `<span class="muted">expired ${when(f.exp)}</span>`}</td>
              <td><div class="rowacts"><button data-a="ext" title="Extend 1 hour">${I.clock}+1h</button><button data-a="del" title="Remove">${I.trash}</button></div></td></tr>`;
          })
          .join('')}</tbody></table>`
      : `<div class="empty">No ${showExpired ? '' : 'active '}trace flags. Add one on the right →</div>`;
    const all = el.querySelector('#tfAll');
    if (all) {
      all.checked = list.length > 0 && list.every((f) => checked.has(f.id));
      all.onclick = () => { list.forEach((f) => (all.checked ? checked.add(f.id) : checked.delete(f.id))); drawFlags(); };
    }
  }
  const fmtLeft = (ms) => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.max(m, 0)}m`;
  };
  async function flagClick(e) {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.classList.contains('chk')) { e.target.checked ? checked.add(id) : checked.delete(id); drawFlags(); return; }
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'ext') {
      const f = flags.find((x) => x.id === id);
      const left = Math.max(0, (new Date(f.exp) - Date.now()) / 60000);
      await act(() => call('extendTraces', { ids: [id], minutes: Math.min(1438, Math.round(left + 60)) }), 'Extended by 1 hour');
    }
    if (a.dataset.a === 'del') await act(() => call('deleteTraces', { ids: [id] }), 'Trace flag removed');
  }
  async function flagChange(e) {
    if (!e.target.classList.contains('lvl')) return;
    const id = await resolveLevel(e.target.value);
    await act(() => call('changeTraceLevel', { ids: [e.target.dataset.id], debugLevelId: id }), 'Debug level changed');
  }

  // ---- levels ----
  function levelOptions(sel) {
    const pre = Object.keys(presets)
      .filter((p) => !levels.some((l) => l.DeveloperName === 'OrgLens_' + p))
      .map((p) => `<option value="preset:${p}">★ ${p} (preset)</option>`)
      .join('');
    return levels.map((l) => `<option value="${l.Id}" ${l.Id === sel ? 'selected' : ''}>${esc(l.DeveloperName)}</option>`).join('') + pre;
  }
  async function resolveLevel(v) {
    if (v.startsWith('preset:')) {
      const id = await call('ensurePreset', { preset: v.slice(7) });
      await loadLevels();
      return id;
    }
    return v;
  }
  function fillLevelSelects() {
    const s = el.querySelector('#tfLevel');
    const prev = s.value;
    const def = levels.find((l) => l.DeveloperName === 'OrgLens_Analysis');
    s.innerHTML = levelOptions(prev || (def ? def.Id : 'preset:Analysis'));
    if (!prev && !def) s.value = 'preset:Analysis';
    el.querySelector('#tfLvlSel').innerHTML = '<option value="">Change level…</option>' + levelOptions();
    drawLvlPreview();
    drawFlags();
  }
  function drawLvlPreview() {
    const v = el.querySelector('#tfLevel').value;
    let lv;
    if (v.startsWith('preset:')) lv = presets[v.slice(7)] && presets[v.slice(7)].levels;
    else lv = levels.find((l) => l.Id === v);
    el.querySelector('#tfLvlPrev').innerHTML = lv
      ? cats.map((c) => `<span class="lv-chip lv-${esc(lv[c])}" title="${c}">${c.replace('Apex', 'Apex ').replace('Profiling', 'Prof.')}<b>${esc(lv[c] || '—')}</b></span>`).join('')
      : '';
  }
  function drawLevels() {
    el.querySelector('#dlTable').innerHTML = levels.length
      ? `<table class="lt"><thead><tr><th>Name</th>${cats.map((c) => `<th>${c}</th>`).join('')}<th></th></tr></thead><tbody>${levels
          .map((l) => `<tr data-id="${l.Id}"><td><b>${esc(l.DeveloperName)}</b></td>${cats.map((c) => `<td><span class="lv-chip lv-${esc(l[c])}"><b>${esc(l[c])}</b></span></td>`).join('')}<td><div class="rowacts"><button data-a="edit" title="Edit">${I.gear}</button><button data-a="del" title="Delete">${I.trash}</button></div></td></tr>`)
          .join('')}</tbody></table>`
      : '<div class="empty">No debug levels.</div>';
  }
  async function levelClick(e) {
    const tr = e.target.closest('tr[data-id]');
    const a = e.target.closest('[data-a]');
    if (!tr || !a) return;
    const l = levels.find((x) => x.Id === tr.dataset.id);
    if (a.dataset.a === 'edit') editLevel(l);
    if (a.dataset.a === 'del') {
      if (!(await call('confirm', { message: `Delete debug level ${l.DeveloperName}?`, action: 'Delete' }))) return;
      try {
        await call('deleteDebugLevel', { id: l.Id });
        toast('Debug level deleted', 'ok');
      } catch (err) {
        toast(err.message.includes('DELETE_FAILED') || err.message.includes('in use') ? 'That level is used by a trace flag — remove or change those first.' : err.message, 'error');
      }
      loadLevels();
    }
  }
  function editLevel(l) {
    const base = l || (presets.Analysis && presets.Analysis.levels) || {};
    const dlg = document.createElement('div');
    dlg.className = 'modal-bg';
    dlg.innerHTML = `<div class="modal"><h3>${l ? 'Edit ' + esc(l.DeveloperName) : 'New debug level'}</h3>
      ${l ? '' : '<label class="fld">Name<input id="dlName" placeholder="e.g. Integration_Debug"></label>'}
      <div class="lvl-grid">${cats.map((c) => `<label class="fld">${c}<select data-c="${c}">${LEVELS.map((v) => `<option ${v === base[c] ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`).join('')}</div>
      ${l ? '' : `<div class="muted small" style="margin-top:8px">Start from: ${Object.keys(presets).map((p) => `<a href="#" data-p="${p}">${p}</a>`).join(' · ')}</div>`}
      <div class="modal-acts"><button class="btn" data-x>Cancel</button><button class="btn primary" data-save>Save</button></div></div>`;
    document.body.appendChild(dlg);
    const close = () => dlg.remove();
    dlg.onclick = async (e) => {
      if (e.target === dlg || e.target.closest('[data-x]')) return close();
      const p = e.target.closest('[data-p]');
      if (p) {
        e.preventDefault();
        const lv = presets[p.dataset.p].levels;
        dlg.querySelectorAll('select[data-c]').forEach((s) => (s.value = lv[s.dataset.c]));
        return;
      }
      if (e.target.closest('[data-save]')) {
        const lv = {};
        dlg.querySelectorAll('select[data-c]').forEach((s) => (lv[s.dataset.c] = s.value));
        const name = l ? null : dlg.querySelector('#dlName').value.trim();
        if (!l && !name) return toast('Give the debug level a name', 'error');
        try {
          await call('saveDebugLevel', { id: l && l.Id, name, levels: lv });
          toast('Debug level saved', 'ok');
          close();
          loadLevels();
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    };
  }

  // ---- who ----
  async function search() {
    searching = true;
    drawResults();
    try {
      results = kind === 'apex' ? await call('searchApex', { term }) : await call('searchUsers', { term, kind: kind === 'users' ? '' : kind });
    } catch (e) {
      results = [];
      toast(e.message, 'error');
    }
    searching = false;
    drawResults();
  }
  function drawResults() {
    const box = el.querySelector('#tfResults');
    if (searching && !results.length) { box.innerHTML = '<div class="muted pad-s">Searching…</div>'; return; }
    box.innerHTML = results.length
      ? results
          .map((x) => `<div class="who ${picked.has(x.Id) ? 'on' : ''}" data-id="${x.Id}"><input type="checkbox" ${picked.has(x.Id) ? 'checked' : ''}><div class="w-main"><b>${esc(x.Name)}</b> <span class="kind k-${esc(kindLabel(x).replace(/\W/g, ''))}">${esc(kindLabel(x))}</span><div class="muted small">${esc(x.Username || (x.NamespacePrefix ? x.NamespacePrefix + '__' : '') || '')}${x.Profile ? ' · ' + esc(x.Profile.Name) : ''}${x.IsActive === false ? ' · inactive' : ''}</div></div></div>`)
          .join('')
      : `<div class="muted pad-s">${kind === 'automated' ? 'No Automated Process user found.' : 'No matches.'}</div>`;
  }
  function drawPicked() {
    el.querySelector('#tfPicked').innerHTML = [...picked.entries()].map(([id, p]) => `<span class="pchip" data-id="${id}" title="Remove">${esc(p.name)} ✕</span>`).join('');
    const b = el.querySelector('#tfStart');
    b.disabled = picked.size === 0;
    b.innerHTML = `${I.record} Start tracing${picked.size ? ` ${picked.size} ${picked.size === 1 ? 'entity' : 'entities'}` : ''}`;
  }
  async function startTracing() {
    const b = el.querySelector('#tfStart');
    b.disabled = true;
    try {
      const debugLevelId = await resolveLevel(el.querySelector('#tfLevel').value);
      const minutes = Number(el.querySelector('#tfDur .on').dataset.m);
      const n = await call('createTraces', { entityIds: [...picked.keys()], minutes, debugLevelId });
      toast(`Tracing ${n} ${n === 1 ? 'entity' : 'entities'}`, 'ok');
      picked.clear();
      drawResults();
      drawPicked();
    } catch (e) {
      toast(e.message, 'error');
    }
    b.disabled = picked.size === 0;
    loadFlags();
  }

  window.SFLS.onState(() => {
    if (el && !el.querySelector('#tfTable')) return;
  });
  setInterval(() => el && el.closest('.page.active') && drawFlags(), 30000);
})();

// OrgLens — Org Setup page (settings, limits, packages, licenses, access, audit trail)
(() => {
  'use strict';
  const { call, esc, I, toast } = window.SFLS;
  let el, $;
  const SUBS = [
    ['overview', 'Overview & limits'],
    ['settings', 'Settings'],
    ['packages', 'Installed packages'],
    ['licenses', 'Licenses'],
    ['access', 'My access'],
    ['audit', 'Setup audit trail'],
  ];
  let sub = 'settings';
  const loaded = {}; // sub -> data
  // settings state
  let names = [], settings = {}, curSetting = null, sQ = '', gQ = '', onlyOn = false, loadingAll = false;

  window.SFLS.pages.org = {
    build(root) {
      el = root;
      $ = (s) => el.querySelector(s);
      el.innerHTML = `<div class="org">
        <div class="org-bar"><div class="seg" id="orgSubs">${SUBS.map(([k, l]) => `<button data-s="${k}" class="${k === sub ? 'on' : ''}">${l}</button>`).join('')}</div>
          <span style="flex:1"></span>
          <button class="btn sm" id="orgReload">${I.refresh} Reload</button>
          <button class="btn sm" id="orgSetup">${I.ext} Open Setup</button></div>
        <div class="org-body" id="orgBody"></div></div>`;
      $('#orgSubs').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) show(b.dataset.s); };
      $('#orgReload').onclick = () => { delete loaded[sub]; if (sub === 'settings') { names = []; settings = {}; } show(sub); };
      $('#orgSetup').onclick = () => { call('openPath', { path: '/lightning/setup/SetupOneHome/home' }).catch((e) => toast(e.message, 'error')); toast('Opening Setup…'); };
      show(sub);
    },
  };

  function show(s) {
    sub = s;
    el.querySelectorAll('#orgSubs button').forEach((b) => b.classList.toggle('on', b.dataset.s === s));
    const body = $('#orgBody');
    ({ overview: overview, settings: settingsView, packages: packagesView, licenses: licensesView, access: accessView, audit: auditView })[s](body);
  }
  const loading = (body, what) => (body.innerHTML = `<div class="empty"><span class="spinner sm"></span> Loading ${what}…</div>`);
  async function load(key, op, body, what) {
    if (!loaded[key]) {
      loading(body, what);
      try { loaded[key] = await call(op); } catch (e) { body.innerHTML = `<div class="q-err"><b>Could not load ${what}</b><pre>${esc(e.message)}</pre></div>`; return null; }
    }
    return loaded[key];
  }

  // ---------- generic grid ----------
  function grid(host, cols, rows, opt = {}) {
    let sort = opt.sort || null, q = '';
    host.innerHTML = `${opt.noFilter ? '' : `<div class="grid-tools"><input class="search" placeholder="${opt.placeholder || 'Filter…'}"><span class="muted small gcount"></span>${opt.tools || ''}</div>`}<div class="grid-wrap"></div>`;
    const wrap = host.querySelector('.grid-wrap');
    const draw = () => {
      let r = rows;
      if (q) r = r.filter((x) => cols.some((c) => String(c.sv ? c.sv(x) : x[c.k] ?? '').toLowerCase().includes(q)));
      if (sort) {
        const c = cols.find((x) => x.k === sort.k);
        const v = c.sv || ((x) => x[c.k]);
        r = [...r].sort((a, b) => { const A = v(a), B = v(b); return (A == null ? 1 : B == null ? -1 : typeof A === 'number' ? A - B : String(A).localeCompare(String(B), undefined, { numeric: true })) * sort.dir; });
      }
      const gc = host.querySelector('.gcount');
      if (gc) gc.textContent = `${r.length} of ${rows.length}`;
      wrap.innerHTML = r.length
        ? `<table class="dgrid compact"><thead><tr>${cols.map((c) => `<th data-k="${c.k}" style="${c.w ? 'width:' + c.w : ''}"><div class="th-in"><span class="th-n">${c.label}</span><span class="th-s">${sort && sort.k === c.k ? (sort.dir > 0 ? '▲' : '▼') : ''}</span></div></th>`).join('')}</tr></thead><tbody>${r
            .map((x) => `<tr>${cols.map((c) => `<td class="${c.cls || ''}">${c.fmt ? c.fmt(x) : esc(x[c.k] ?? '')}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        : `<div class="empty">${opt.empty || 'Nothing to show.'}</div>`;
    };
    wrap.onclick = (e) => {
      const th = e.target.closest('th[data-k]');
      if (!th) return;
      const k = th.dataset.k;
      const c = cols.find((x) => x.k === k);
      sort = sort && sort.k === k ? { k, dir: -sort.dir } : { k, dir: c.num ? -1 : 1 };
      draw();
    };
    const inp = host.querySelector('.grid-tools .search');
    if (inp) inp.oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
    draw();
  }
  const fmtDate = (d) => (d ? new Date(d).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const usage = (used, max) => {
    const p = max ? (used / max) * 100 : 0;
    return `<div class="use"><span class="use-n">${(used ?? 0).toLocaleString()} / ${(max ?? 0).toLocaleString()}</span><span class="use-b"><i class="${p >= 90 ? 'err' : p >= 70 ? 'warn' : ''}" style="width:${Math.min(100, p)}%"></i></span><span class="use-p">${p.toFixed(0)}%</span></div>`;
  };

  // ---------- overview ----------
  async function overview(body) {
    const d = await load('overview', 'orgInfo', body, 'org details');
    if (!d) return;
    const o = d.org || {};
    const kv = [
      ['Org name', o.Name], ['Org Id', o.Id], ['Edition', o.OrganizationType], ['Instance', o.InstanceName],
      ['Sandbox', o.IsSandbox ? 'Yes' : 'No'], ['Trial expires', o.TrialExpirationDate ? fmtDate(o.TrialExpirationDate) : '—'],
      ['Namespace', o.NamespacePrefix || '—'], ['Created', fmtDate(o.CreatedDate)], ['Default currency', o.DefaultCurrencyIsoCode || '—'],
      ['Locale', o.DefaultLocaleSidKey], ['Language', o.LanguageLocaleKey], ['Time zone', o.TimeZoneSidKey],
      ['Fiscal year starts', o.FiscalYearStartMonth ? 'Month ' + o.FiscalYearStartMonth : '—'], ['Country', o.Country || '—'],
      ['Active users', (d.activeUsers ?? '—').toLocaleString()], ['API version', d.apiVersion], ['Instance URL', d.instanceUrl],
    ];
    body.innerHTML = `<div class="org-pad">
      <div class="kv-grid">${kv.map(([k, v]) => `<div class="kv"><div class="k">${esc(k)}</div><div class="v">${esc(v ?? '—')}</div></div>`).join('')}</div>
      <div class="sec-head" style="margin-top:20px"><h3>Org limits</h3><span class="muted">From the REST /limits resource — sorted by usage.</span></div>
      <div id="limGrid" class="card flush"></div></div>`;
    grid($('#limGrid'), [
      { k: 'name', label: 'Limit', cls: 'mono', fmt: (x) => esc(x.name.replace(/([a-z])([A-Z])/g, '$1 $2')) },
      { k: 'pct', label: 'Usage', w: '360px', sv: (x) => (x.max ? x.used / x.max : 0), num: true, fmt: (x) => usage(x.used, x.max) },
      { k: 'remaining', label: 'Remaining', num: true, cls: 'num', fmt: (x) => (x.remaining ?? 0).toLocaleString() },
    ], d.limits, { sort: { k: 'pct', dir: -1 }, placeholder: 'Filter limits (e.g. API, storage, email)…' });
  }

  // ---------- settings ----------
  const friendly = (key) => {
    const last = key.split('.').pop().replace(/\[\d+\]$/, '');
    return last.replace(/^enable/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) || key;
  };
  const valCell = (v) =>
    v === true ? '<span class="onoff on">● Enabled</span>' : v === false ? '<span class="onoff off">○ Disabled</span>' : v === '' ? '<span class="muted">—</span>' : `<span class="mono">${esc(v)}</span>`;

  async function settingsView(body) {
    body.innerHTML = `<div class="set">
      <aside class="set-side">
        <input id="sq" class="search" placeholder="Find a settings page…" value="${esc(sQ)}">
        <div class="set-list" id="setList"><div class="muted pad-s"><span class="spinner sm"></span> Loading settings list…</div></div>
      </aside>
      <section class="set-main">
        <div class="grid-tools set-tools">
          <input id="gq" class="search" placeholder="Search every setting (e.g. history, order, einstein, surveys)…" value="${esc(gQ)}">
          <label class="chk"><input type="checkbox" id="onlyOn" ${onlyOn ? 'checked' : ''}> Only enabled</label>
          <span style="flex:1"></span>
          <span class="muted small" id="setStat"></span>
          <button class="btn sm" id="loadAll">${I.download} Load all settings</button>
          <button class="btn sm" id="setCsv">${I.download} Export CSV</button>
        </div>
        <div id="setBody" class="set-body"></div>
      </section></div>`;
    $('#sq').oninput = (e) => { sQ = e.target.value.toLowerCase(); drawList(); };
    let t;
    $('#gq').oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        gQ = e.target.value.trim().toLowerCase();
        drawMain();
        if (gQ && !loadingAll && names.some((n) => !settings[n])) loadAll(); // search needs every page
      }, 150);
    };
    $('#onlyOn').onchange = (e) => { onlyOn = e.target.checked; drawMain(); };
    $('#loadAll').onclick = loadAll;
    $('#setCsv').onclick = exportCsv;
    $('#setList').onclick = (e) => { const r = e.target.closest('[data-n]'); if (r) pick(r.dataset.n); };
    if (!names.length) {
      try { names = await call('listSettings'); } catch (e) { $('#setList').innerHTML = `<div class="err pad-s">${esc(e.message)}</div>`; return; }
    }
    drawList();
    if (!curSetting) curSetting = names.includes('Order') ? 'Order' : names[0];
    pick(curSetting);
  }
  function drawList() {
    const list = names.filter((n) => !sQ || n.toLowerCase().includes(sQ) || friendly(n).toLowerCase().includes(sQ));
    $('#setList').innerHTML = list
      .map((n) => {
        const s = settings[n];
        const on = s && s.items ? s.items.filter((i) => i.value === true).length : null;
        const tot = s && s.items ? s.items.filter((i) => typeof i.value === 'boolean').length : null;
        return `<div class="set-it ${n === curSetting ? 'on' : ''}" data-n="${esc(n)}"><span>${esc(n.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))}</span>${s && s.error ? '<span class="badge err" title="' + esc(s.error) + '">!</span>' : on != null ? `<span class="set-c" title="${on} of ${tot} switches enabled">${on}/${tot}</span>` : ''}</div>`;
      })
      .join('') || '<div class="muted pad-s">No match.</div>';
    const done = names.filter((n) => settings[n]).length;
    $('#setStat').textContent = `${done} of ${names.length} pages loaded`;
  }
  async function pick(n) {
    curSetting = n;
    drawList();
    if (!settings[n]) {
      if (!gQ) $('#setBody').innerHTML = '<div class="empty"><span class="spinner sm"></span> Reading ' + esc(n) + 'Settings…</div>';
      const r = await call('readSettings', { names: [n] }).catch((e) => ({ [n]: { error: e.message } }));
      Object.assign(settings, r);
      drawList();
    }
    drawMain();
  }
  async function loadAll() {
    if (loadingAll) return;
    loadingAll = true;
    const btn = $('#loadAll');
    const todo = names.filter((n) => !settings[n]);
    for (let i = 0; i < todo.length; i += 16) {
      btn.innerHTML = `<span class="spinner sm"></span> ${Math.min(i + 16, todo.length)}/${todo.length}`;
      const r = await call('readSettings', { names: todo.slice(i, i + 16) }).catch(() => ({}));
      Object.assign(settings, r);
      if ($('#setList')) { drawList(); if (gQ) drawMain(); }
    }
    loadingAll = false;
    if ($('#loadAll')) { $('#loadAll').innerHTML = `${I.check} All loaded`; drawMain(); }
    toast(`Loaded ${names.length} settings pages`, 'ok');
  }
  function rowsFor(list) {
    const out = [];
    for (const n of list) {
      const s = settings[n];
      if (!s || !s.items) continue;
      for (const it of s.items) {
        if (onlyOn && it.value !== true) continue;
        if (gQ && !`${n} ${it.key} ${friendly(it.key)} ${it.value}`.toLowerCase().includes(gQ)) continue;
        out.push({ setting: n, key: it.key, label: friendly(it.key), value: it.value });
      }
    }
    return out;
  }
  function drawMain() {
    const host = $('#setBody');
    if (!host) return;
    if (gQ) {
      const loadedN = names.filter((n) => settings[n] && settings[n].items).length;
      const rows = rowsFor(names);
      host.innerHTML = `${loadedN < names.length ? `<div class="banner">Searching ${loadedN} of ${names.length} settings pages. <a href="#" id="bnLoad">Load all</a> to search everything.</div>` : ''}<div id="sg"></div>`;
      const bl = host.querySelector('#bnLoad');
      if (bl) bl.onclick = (e) => { e.preventDefault(); loadAll(); };
      grid(host.querySelector('#sg'), [
        { k: 'setting', label: 'Settings page', fmt: (x) => `<a href="#" class="set-link" data-n="${esc(x.setting)}">${esc(x.setting)}</a>` },
        { k: 'label', label: 'Option', fmt: (x) => `${esc(x.label)}<div class="muted small mono">${esc(x.key)}</div>` },
        { k: 'value', label: 'Value', sv: (x) => String(x.value), fmt: (x) => valCell(x.value) },
      ], rows, { noFilter: true, empty: 'No settings match.' });
      host.querySelectorAll('.set-link').forEach((a) => (a.onclick = (e) => { e.preventDefault(); gQ = ''; $('#gq').value = ''; pick(a.dataset.n); }));
      return;
    }
    const s = settings[curSetting];
    if (!s) return;
    if (s.error) { host.innerHTML = `<div class="q-err"><b>${esc(curSetting)}Settings could not be read</b><pre>${esc(s.error)}</pre></div>`; return; }
    const rows = rowsFor([curSetting]);
    const bools = s.items.filter((i) => typeof i.value === 'boolean');
    const on = bools.filter((i) => i.value).length;
    host.innerHTML = `<div class="set-head"><h3>${esc(curSetting.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))} settings</h3>
      <span class="onoff on">${on} enabled</span><span class="onoff off">${bools.length - on} disabled</span>${s.items.length - bools.length ? `<span class="muted small">${s.items.length - bools.length} other values</span>` : ''}
      <span class="muted small mono">${esc(curSetting)}Settings</span></div><div id="sg"></div>`;
    grid(host.querySelector('#sg'), [
      { k: 'label', label: 'Option', fmt: (x) => `${esc(x.label)}<div class="muted small mono">${esc(x.key)}</div>` },
      { k: 'value', label: 'Value', w: '200px', sv: (x) => (x.value === true ? 0 : x.value === false ? 2 : 1), fmt: (x) => valCell(x.value) },
    ], rows, { noFilter: true, sort: { k: 'value', dir: 1 }, empty: onlyOn ? 'Nothing enabled on this page.' : 'This settings page has no values.' });
  }
  function exportCsv() {
    const rows = gQ ? rowsFor(names) : rowsFor(curSetting ? [curSetting] : []);
    const q = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const csv = ['Settings page,Option,Key,Value', ...rows.map((r) => [r.setting, r.label, r.key, r.value].map(q).join(','))].join('\r\n');
    call('saveFile', { name: gQ ? 'org-settings-search.csv' : `${curSetting}Settings.csv`, content: csv });
  }

  // ---------- packages ----------
  async function packagesView(body) {
    const d = await load('packages', 'packages', body, 'installed packages');
    if (!d) return;
    body.innerHTML = '<div class="org-pad"><div class="card flush" id="pg"></div></div>';
    grid($('#pg'), [
      { k: 'name', label: 'Package', sv: (x) => x.SubscriberPackage && x.SubscriberPackage.Name, fmt: (x) => `<b>${esc(x.SubscriberPackage && x.SubscriberPackage.Name)}</b>` },
      { k: 'ns', label: 'Namespace', sv: (x) => x.SubscriberPackage && x.SubscriberPackage.NamespacePrefix, fmt: (x) => `<span class="mono">${esc((x.SubscriberPackage && x.SubscriberPackage.NamespacePrefix) || '—')}</span>` },
      { k: 'ver', label: 'Version', sv: (x) => x.SubscriberPackageVersion && x.SubscriberPackageVersion.Name, fmt: (x) => esc(x.SubscriberPackageVersion && x.SubscriberPackageVersion.Name) },
      { k: 'num', label: 'Version number', sv: (x) => { const v = x.SubscriberPackageVersion || {}; return `${v.MajorVersion}.${v.MinorVersion}.${v.PatchVersion}.${v.BuildNumber}`; }, fmt: (x) => { const v = x.SubscriberPackageVersion || {}; return `<span class="mono">${v.MajorVersion}.${v.MinorVersion}.${v.PatchVersion}.${v.BuildNumber}</span>`; } },
    ], d, { sort: { k: 'name', dir: 1 }, placeholder: 'Filter packages…', empty: 'No managed or unlocked packages installed.' });
  }

  // ---------- licenses ----------
  async function licensesView(body) {
    const d = await load('licenses', 'licenses', body, 'licenses');
    if (!d) return;
    body.innerHTML = `<div class="org-pad"><div class="sec-head"><h3>User licenses</h3></div><div class="card flush" id="ul"></div>
      <div class="sec-head" style="margin-top:20px"><h3>Permission set licenses</h3></div><div class="card flush" id="pl"></div></div>`;
    grid($('#ul'), [
      { k: 'Name', label: 'License', fmt: (x) => `<b>${esc(x.Name)}</b>` },
      { k: 'Status', label: 'Status' },
      { k: 'use', label: 'Used / total', w: '360px', num: true, sv: (x) => (x.TotalLicenses ? x.UsedLicenses / x.TotalLicenses : 0), fmt: (x) => usage(x.UsedLicenses, x.TotalLicenses) },
    ], d.user, { sort: { k: 'use', dir: -1 }, placeholder: 'Filter user licenses…' });
    grid($('#pl'), [
      { k: 'MasterLabel', label: 'License', fmt: (x) => `<b>${esc(x.MasterLabel)}</b><div class="muted small mono">${esc(x.DeveloperName)}</div>` },
      { k: 'Status', label: 'Status' },
      { k: 'ExpirationDate', label: 'Expires', fmt: (x) => esc(x.ExpirationDate || '—') },
      { k: 'use', label: 'Used / total', w: '360px', num: true, sv: (x) => (x.TotalLicenses ? x.UsedLicenses / x.TotalLicenses : 0), fmt: (x) => usage(x.UsedLicenses, x.TotalLicenses) },
    ], d.psl, { sort: { k: 'MasterLabel', dir: 1 }, placeholder: 'Filter permission set licenses (e.g. Revenue, CPQ, Industries)…' });
  }

  // ---------- my access ----------
  async function accessView(body) {
    const d = await load('access', 'myAccess', body, 'your access');
    if (!d) return;
    const u = d.user || {};
    body.innerHTML = `<div class="org-pad">
      <div class="kv-grid">${[['User', u.Name], ['Username', u.Username], ['Profile', u.Profile && u.Profile.Name], ['Role', (u.UserRole && u.UserRole.Name) || '—'], ['User type', u.UserType], ['Time zone', u.TimeZoneSidKey], ['Locale', u.LocaleSidKey], ['Language', u.LanguageLocaleKey]].map(([k, v]) => `<div class="kv"><div class="k">${k}</div><div class="v">${esc(v ?? '—')}</div></div>`).join('')}</div>
      <div class="sec-head" style="margin-top:20px"><h3>Permission sets & groups assigned to you</h3></div><div class="card flush" id="pa"></div></div>`;
    grid($('#pa'), [
      { k: 'label', label: 'Permission set', sv: (x) => x.PermissionSet.Label, fmt: (x) => `<b>${esc(x.PermissionSetGroup ? x.PermissionSetGroup.MasterLabel : x.PermissionSet.Label)}</b><div class="muted small mono">${esc(x.PermissionSet.Name)}</div>` },
      { k: 'type', label: 'Type', sv: (x) => (x.PermissionSet.IsOwnedByProfile ? 'Profile' : x.PermissionSetGroupId ? 'Group' : x.PermissionSet.Type || 'Permission set'), fmt: (x) => `<span class="kind">${x.PermissionSet.IsOwnedByProfile ? 'Profile' : x.PermissionSetGroupId ? 'Group' : esc(x.PermissionSet.Type || 'Permission set')}</span>` },
    ], d.assignments, { sort: { k: 'label', dir: 1 }, placeholder: 'Filter permission sets…' });
  }

  // ---------- audit trail ----------
  async function auditView(body) {
    const d = await load('audit', 'auditTrail', body, 'the setup audit trail');
    if (!d) return;
    body.innerHTML = `<div class="org-pad"><div class="sec-head"><h3>Recent setup changes</h3><span class="muted">Last ${d.length} entries</span></div><div class="card flush" id="at"></div></div>`;
    grid($('#at'), [
      { k: 'CreatedDate', label: 'When', w: '170px', fmt: (x) => `<span class="mono small">${esc(fmtDate(x.CreatedDate))}</span>` },
      { k: 'who', label: 'User', w: '180px', sv: (x) => x.CreatedBy && x.CreatedBy.Name, fmt: (x) => esc((x.CreatedBy && x.CreatedBy.Name) || '') + (x.DelegateUser ? `<div class="muted small">as ${esc(x.DelegateUser)}</div>` : '') },
      { k: 'Section', label: 'Section', w: '180px', fmt: (x) => `<span class="kind">${esc(x.Section || '—')}</span>` },
      { k: 'Display', label: 'Change', cls: 'wrap', fmt: (x) => esc(x.Display) },
    ], d, { sort: { k: 'CreatedDate', dir: -1 }, placeholder: 'Filter changes (e.g. permission, flow, field)…' });
  }
})();

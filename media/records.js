// OrgLens — record tools: Show all data, edit, clone, create, delete, bulk edit, import
(() => {
  'use strict';
  const { call, esc, I, toast } = window.SFLS;
  const orgName = () => ((window.SFLS.getState() || {}).org || {}).alias || 'this org';
  let globalObjs = null;

  async function objects() {
    if (!globalObjs) globalObjs = await call('describeGlobal', { tooling: false });
    return globalObjs;
  }
  async function objectForId(id) {
    const p = String(id).slice(0, 3);
    const o = (await objects()).find((x) => x.prefix === p);
    if (!o) throw new Error(`No queryable object uses the Id prefix ${p}`);
    return o.name;
  }
  const describe = (name) => call('describe', { name, tooling: false });
  const NUM = new Set(['int', 'double', 'currency', 'percent', 'long']);
  const isBlankable = (f) => f.type !== 'boolean';
  const required = (f) => f.createable && !f.nillable && !f.defaulted && f.type !== 'boolean';
  const isIdLike = (v) => typeof v === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(v) && /\d/.test(v);

  // ---------- field editors ----------
  function toLocalDT(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function editor(f, v, attrs = '') {
    const val = v == null ? '' : v;
    const a = `data-f="${esc(f.name)}" ${attrs}`;
    switch (f.type) {
      case 'boolean':
        return `<input type="checkbox" ${a} ${v ? 'checked' : ''}>`;
      case 'picklist': {
        const opts = [...f.picklist];
        if (val && !opts.includes(val)) opts.unshift(val);
        return `<select ${a}><option value="">— none —</option>${opts.map((p) => `<option ${p === val ? 'selected' : ''} value="${esc(p)}">${esc(p)}</option>`).join('')}</select>`;
      }
      case 'multipicklist': {
        const cur = String(val).split(';').filter(Boolean);
        return `<select multiple size="${Math.min(5, Math.max(2, f.picklist.length))}" ${a}>${f.picklist.map((p) => `<option ${cur.includes(p) ? 'selected' : ''} value="${esc(p)}">${esc(p)}</option>`).join('')}</select>`;
      }
      case 'date':
        return `<input type="date" ${a} value="${esc(val)}">`;
      case 'datetime':
        return `<input type="datetime-local" ${a} value="${esc(toLocalDT(val))}">`;
      case 'time':
        return `<input type="time" step="1" ${a} value="${esc(String(val).slice(0, 8))}">`;
      case 'textarea':
        return `<textarea rows="${f.length > 255 ? 4 : 2}" ${a}>${esc(val)}</textarea>`;
      default:
        if (NUM.has(f.type)) return `<input type="number" step="any" ${a} value="${esc(val)}">`;
        return `<input type="text" ${a} value="${esc(val)}" ${f.length ? `maxlength="${f.length}"` : ''}>`;
    }
  }
  function readEditor(f, el) {
    if (f.type === 'boolean') return el.checked;
    if (f.type === 'multipicklist') return [...el.selectedOptions].map((o) => o.value).join(';') || null;
    const v = el.value;
    if (v === '') return null;
    if (f.type === 'datetime') return new Date(v).toISOString();
    if (NUM.has(f.type)) return Number(v);
    return v;
  }
  /** Convert an imported/text value to the right JSON type. Returns undefined to skip the field. */
  function coerce(f, raw) {
    if (raw == null) return undefined;
    const s = String(raw).trim();
    if (s === '') return undefined;
    if (/^(#N\/A|NULL)$/i.test(s)) return null;
    if (f.type === 'boolean') return /^(true|1|yes|y|x)$/i.test(s);
    if (NUM.has(f.type)) { const n = Number(s.replace(/,/g, '')); if (isNaN(n)) throw new Error(`"${s}" is not a number for ${f.name}`); return n; }
    if (f.type === 'datetime' && !/T/.test(s)) { const d = new Date(s); if (!isNaN(d)) return d.toISOString(); }
    return s;
  }
  const show = (v) => {
    if (v == null || v === '') return '<span class="muted">—</span>';
    if (typeof v === 'object' && ('street' in v || 'city' in v || 'latitude' in v)) return esc([v.street, [v.city, v.state, v.postalCode].filter(Boolean).join(' '), v.country].filter(Boolean).join(', ') || [v.latitude, v.longitude].filter((x) => x != null).join(', ')) || '<span class="muted">—</span>';
    return esc(typeof v === 'object' ? JSON.stringify(v) : v);
  };
  const fmtErr = (r) => (r.errors || []).map((e) => `${e.statusCode ? e.statusCode + ': ' : ''}${e.message}${e.fields && e.fields.length ? ' (' + e.fields.join(', ') + ')' : ''}`).join('; ');

  function modal(html, cls = 'wide') {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${cls}">${html}</div>`;
    document.body.appendChild(bg);
    return bg;
  }
  const confirmDlg = (message, action) => call('confirm', { message, action });

  // ---------- Show all data (record panel with history stack) ----------
  async function open(id, opts = {}) {
    let stack = [];
    let state = null; // { object, id, desc, rec, editing, changes, tab, q, hideEmpty, customOnly }
    const bg = modal('<div class="rp"><div class="empty"><span class="spinner sm"></span> Loading record…</div></div>', 'wide rp-modal');
    const root = bg.querySelector('.rp');
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape' && !bg.querySelector('.modal-bg')) close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });

    async function load(recId, object, push) {
      root.innerHTML = '<div class="empty"><span class="spinner sm"></span> Loading record…</div>';
      try {
        const obj = object || (await objectForId(recId));
        const [desc, rec] = await Promise.all([describe(obj), call('getRecord', { object: obj, id: recId })]);
        if (push && state) stack.push({ object: state.object, id: state.id });
        state = { object: obj, id: rec.Id || recId, desc, rec, editing: false, changes: {}, tab: 'fields', q: '', hideEmpty: false, customOnly: false, related: {} };
        render();
      } catch (e) {
        root.innerHTML = `<div class="q-err"><b>Could not load ${esc(recId)}</b><pre>${esc(e.message)}</pre></div><div class="modal-acts">${stack.length ? '<button class="btn" data-back>← Back</button>' : ''}<button class="btn" data-close>Close</button></div>`;
      }
    }
    function nameOf() {
      const nf = state.desc.fields.find((f) => f.nameField);
      return (nf && state.rec[nf.name]) || state.id;
    }
    function render() {
      const d = state.desc, r = state.rec;
      const fields = d.fields.filter((f) => {
        if (state.customOnly && !f.custom) return false;
        if (state.hideEmpty && (r[f.name] == null || r[f.name] === '') && !(f.name in state.changes)) return false;
        if (state.q) { const q = state.q.toLowerCase(); return `${f.label} ${f.name} ${f.type} ${r[f.name] ?? ''}`.toLowerCase().includes(q); }
        return true;
      });
      const nChanges = Object.keys(state.changes).length;
      root.innerHTML = `
        <div class="rp-head">
          ${stack.length ? `<button class="btn sm" data-back title="Back to previous record">←</button>` : ''}
          <div class="rp-title"><div class="muted small">${esc(d.label)} · <span class="mono">${esc(d.name)}</span></div><h3>${esc(nameOf())}</h3><a class="rid" data-ext="${esc(state.id)}" title="Open in Salesforce">${esc(state.id)}</a></div>
          <span style="flex:1"></span>
          ${state.editing
            ? `<button class="btn primary" data-save ${nChanges ? '' : 'disabled'}>Save${nChanges ? ` ${nChanges} change${nChanges === 1 ? '' : 's'}` : ''}</button><button class="btn" data-cancel>Cancel</button>`
            : `${d.updateable ? `<button class="btn primary" data-edit>${I.gear} Edit</button>` : ''}${d.createable ? `<button class="btn" data-clone>${I.copy} Clone</button>` : ''}${d.deletable ? `<button class="btn danger" data-del>${I.trash} Delete</button>` : ''}`}
          <button class="btn sm" data-refresh title="Reload">${I.refresh}</button>
          <button class="btn sm" data-sf title="Open in Salesforce">${I.ext}</button>
          <button class="btn sm" data-close title="Close (Esc)">✕</button>
        </div>
        <div class="rp-tabs"><div class="seg">${[['fields', `Fields (${d.fields.length})`], ['related', `Related (${d.children.length})`], ['json', 'JSON']].map(([k, l]) => `<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          ${state.tab === 'fields' ? `<input class="search" id="rpQ" placeholder="Filter fields or values…" value="${esc(state.q)}"><label class="chk"><input type="checkbox" id="rpEmpty" ${state.hideEmpty ? 'checked' : ''}> Hide empty</label><label class="chk"><input type="checkbox" id="rpCustom" ${state.customOnly ? 'checked' : ''}> Custom only</label><span class="muted small">${fields.length} shown</span>` : ''}
          ${state.tab === 'json' ? `<button class="btn sm" data-copyjson>${I.copy} Copy JSON</button>` : ''}
        </div>
        <div class="rp-body">${state.tab === 'fields' ? fieldsTable(fields) : state.tab === 'related' ? relatedView() : `<pre class="rx-raw">${esc(JSON.stringify(stripAttrs(r), null, 2))}</pre>`}</div>`;
      const q = root.querySelector('#rpQ');
      if (q) q.oninput = (e) => { state.q = e.target.value; const p = e.target.selectionStart; render(); const n = root.querySelector('#rpQ'); n.focus(); n.setSelectionRange(p, p); };
      const he = root.querySelector('#rpEmpty');
      if (he) he.onchange = (e) => { state.hideEmpty = e.target.checked; render(); };
      const co = root.querySelector('#rpCustom');
      if (co) co.onchange = (e) => { state.customOnly = e.target.checked; render(); };
    }
    function fieldsTable(fields) {
      const r = state.rec;
      return `<table class="dgrid kv rp-t"><thead><tr><th>Field</th><th>API name</th><th>Type</th><th>Value</th></tr></thead><tbody>${fields
        .map((f) => {
          const changed = f.name in state.changes;
          const v = changed ? state.changes[f.name] : r[f.name];
          let valHtml;
          if (state.editing && f.updateable && !f.calculated) valHtml = editor(f, v, 'class="rp-ed"');
          else if (f.type === 'reference' && isIdLike(v)) {
            const relObj = f.rel && r[f.rel] ? r[f.rel] : null;
            valHtml = `<a class="rid" data-open="${esc(v)}" title="Show all data for this record">${esc(v)}</a>${relObj && relObj.Name ? ` <span class="muted">${esc(relObj.Name)}</span>` : ''}`;
          } else if (f.type === 'boolean') valHtml = `<span class="bool ${!!v}">${!!v}</span>`;
          else valHtml = `<span class="rp-v">${show(v)}</span>`;
          const typ = f.type + (f.type === 'reference' && f.ref ? ` → ${f.ref.join(', ')}` : '') + (f.length && ['string', 'textarea'].includes(f.type) ? `(${f.length})` : '');
          const flags = [f.calculated ? 'formula' : '', f.externalId ? 'ext id' : '', f.unique ? 'unique' : '', !f.updateable && !f.calculated ? 'read-only' : '', required(f) ? 'required' : ''].filter(Boolean);
          return `<tr class="${changed ? 'dirty-row' : ''}"><td>${esc(f.label)}${f.help ? ` <span class="help" title="${esc(f.help)}">ⓘ</span>` : ''}</td><td class="mono small">${esc(f.name)}</td><td class="small muted">${esc(typ)}${flags.length ? `<div>${flags.map((x) => `<span class="flag">${x}</span>`).join(' ')}</div>` : ''}</td><td class="rp-val">${valHtml}</td></tr>`;
        })
        .join('')}</tbody></table>`;
    }
    function relatedView() {
      const kids = state.desc.children;
      return `<div class="rp-rel">${kids
        .map((c, i) => {
          const rel = state.related[c.rel];
          return `<div class="rel-it ${rel ? 'open' : ''}" data-ri="${i}"><div class="rel-h"><span class="jtg">▸</span><b>${esc(c.rel)}</b><span class="muted small">${esc(c.object)}.${esc(c.field)}</span>${rel && rel.total != null ? `<span class="badge">${rel.total}</span>` : ''}<span style="flex:1"></span>${rel ? `<button class="btn sm" data-relq="${i}">Query in SOQL →</button>` : ''}</div>
            ${rel ? (rel.loading ? '<div class="muted small pad-s"><span class="spinner sm"></span> Loading…</div>' : rel.error ? `<div class="err small pad-s">${esc(rel.error)}</div>` : rel.records.length ? `<table class="dgrid compact"><tbody>${rel.records.map((x) => `<tr><td><a class="rid" data-open="${esc(x.Id)}" data-obj="${esc(c.object)}">${esc(x.Id)}</a></td><td>${esc(rel.nameField ? x[rel.nameField] ?? '' : '')}</td><td class="muted small">${esc(x.LastModifiedDate || '')}</td></tr>`).join('')}</tbody></table>${rel.total > rel.records.length ? `<div class="muted small pad-s">Showing ${rel.records.length} of ${rel.total}</div>` : ''}` : '<div class="muted small pad-s">No related records.</div>') : ''}</div>`;
        })
        .join('') || '<div class="empty">This object has no child relationships.</div>'}</div>`;
    }
    async function toggleRelated(i) {
      const c = state.desc.children[i];
      if (state.related[c.rel]) { delete state.related[c.rel]; render(); return; }
      state.related[c.rel] = { loading: true };
      render();
      try {
        const r = await call('related', { object: c.object, field: c.field, id: state.id });
        state.related[c.rel] = { records: r.records, total: r.total, nameField: r.nameField };
      } catch (e) {
        state.related[c.rel] = { error: e.message };
      }
      render();
    }
    root.addEventListener('input', (e) => trackEdit(e));
    root.addEventListener('change', (e) => trackEdit(e));
    function trackEdit(e) {
      const t = e.target.closest('.rp-ed');
      if (!t) return;
      const f = state.desc.fields.find((x) => x.name === t.dataset.f);
      const v = readEditor(f, t);
      const orig = state.rec[f.name] ?? null;
      const same = f.type === 'datetime' ? orig && v && new Date(orig).getTime() === new Date(v).getTime() : v === orig || (v == null && orig === '');
      if (same) delete state.changes[f.name]; else state.changes[f.name] = v;
      const n = Object.keys(state.changes).length;
      const b = root.querySelector('[data-save]');
      if (b) { b.disabled = !n; b.textContent = n ? `Save ${n} change${n === 1 ? '' : 's'}` : 'Save'; }
      t.closest('tr').classList.toggle('dirty-row', f.name in state.changes);
    }
    root.addEventListener('click', async (e) => {
      const t = (s) => e.target.closest(s);
      if (t('[data-close]')) return close();
      if (t('[data-back]')) { const prev = stack.pop(); return load(prev.id, prev.object, false); }
      const op = t('[data-open]');
      if (op) return load(op.dataset.open, op.dataset.obj || null, true);
      if (t('[data-ext]') || t('[data-sf]')) { call('openRecord', { id: state.id }).catch((err) => toast(err.message, 'error')); return toast('Opening in Salesforce…'); }
      const tab = t('[data-tab]');
      if (tab && tab.closest('.rp-tabs')) { state.tab = tab.dataset.tab; return render(); }
      if (t('[data-refresh]')) return load(state.id, state.object, false);
      if (t('[data-edit]')) { state.editing = true; state.tab = 'fields'; return render(); }
      if (t('[data-cancel]')) { state.editing = false; state.changes = {}; return render(); }
      if (t('[data-copyjson]')) return call('copy', { text: JSON.stringify(stripAttrs(state.rec), null, 2) });
      const rh = t('.rel-h');
      if (rh && !t('[data-relq]')) return toggleRelated(+rh.parentElement.dataset.ri);
      const rq = t('[data-relq]');
      if (rq) {
        const c = state.desc.children[+rq.dataset.relq];
        const nf = (state.related[c.rel] || {}).nameField;
        close();
        if (opts.onQuery) opts.onQuery(`SELECT Id${nf && nf !== 'Id' ? ', ' + nf : ''} FROM ${c.object} WHERE ${c.field} = '${state.id}' ORDER BY ${(state.related[c.rel] || {}).records && (state.related[c.rel].records[0] || {}).LastModifiedDate ? 'LastModifiedDate DESC' : 'Id'} LIMIT 200`);
        return;
      }
      if (t('[data-save]')) {
        const changes = state.changes;
        const n = Object.keys(changes).length;
        if (!n) return;
        if (!(await confirmDlg(`Save ${n} change${n === 1 ? '' : 's'} to ${state.desc.label} ${nameOf()} in ${orgName()}?`, 'Save'))) return;
        try {
          const [res] = await call('dml', { op: 'update', object: state.object, records: [{ Id: state.id, ...changes }] });
          if (!res.success) throw new Error(fmtErr(res));
          toast('Record saved', 'ok');
          if (opts.onChange) opts.onChange({ type: 'update', id: state.id, changes });
          await load(state.id, state.object, false);
        } catch (err) {
          toast('Save failed: ' + err.message, 'error');
        }
        return;
      }
      if (t('[data-del]')) {
        if (!(await confirmDlg(`Delete ${state.desc.label} "${nameOf()}" (${state.id}) from ${orgName()}? It goes to the Recycle Bin.`, 'Delete'))) return;
        const [res] = await call('dml', { op: 'delete', ids: [state.id] });
        if (!res.success) return toast('Delete failed: ' + fmtErr(res), 'error');
        toast('Record deleted', 'ok');
        if (opts.onChange) opts.onChange({ type: 'delete', id: state.id });
        if (stack.length) { const prev = stack.pop(); return load(prev.id, prev.object, false); }
        return close();
      }
      if (t('[data-clone]')) {
        const prefill = {};
        state.desc.fields.forEach((f) => { if (f.createable && !f.unique && !f.externalId && state.rec[f.name] != null && f.name !== 'OwnerId') prefill[f.name] = state.rec[f.name]; });
        return create(state.object, { prefill, title: `Clone ${state.desc.label}`, onDone: (newId) => { if (opts.onChange) opts.onChange({ type: 'insert', id: newId }); load(newId, state.object, true); } });
      }
    });
    await load(id, opts.object, false);
  }
  function stripAttrs(o) {
    if (Array.isArray(o)) return o.map(stripAttrs);
    if (!o || typeof o !== 'object') return o;
    const r = {};
    for (const [k, v] of Object.entries(o)) if (k !== 'attributes') r[k] = stripAttrs(v);
    return r;
  }

  // ---------- create / clone ----------
  async function create(object, opts = {}) {
    let desc;
    try { desc = await describe(object); } catch (e) { return toast(e.message, 'error'); }
    if (!desc.createable) return toast(`${desc.label} records can't be created via the API`, 'error');
    const fields = desc.fields.filter((f) => f.createable && !f.calculated && f.type !== 'id' && f.type !== 'base64' && f.type !== 'address' && f.type !== 'location');
    fields.sort((a, b) => (required(b) - required(a)) || (b.nameField - a.nameField) || a.label.localeCompare(b.label));
    const pre = opts.prefill || {};
    let onlyReq = false;
    const bg = modal(`<h3>${esc(opts.title || 'New ' + desc.label)} <span class="muted small mono">${esc(desc.name)}</span></h3>
      <div class="grid-tools" style="padding:0 0 8px;border:none"><input class="search" id="nfQ" placeholder="Filter fields…"><label class="chk"><input type="checkbox" id="nfReq"> Required only</label><span class="muted small">* required · ${fields.length} fields</span></div>
      <div class="modal-scroll nf-scroll"><table class="dgrid kv"><tbody>${fields
        .map((f) => `<tr data-row="${esc(f.name)}" data-req="${required(f) ? 1 : 0}"><td>${esc(f.label)}${required(f) ? ' <b class="req">*</b>' : ''}${f.help ? ` <span class="help" title="${esc(f.help)}">ⓘ</span>` : ''}<div class="muted small mono">${esc(f.name)} · ${esc(f.type)}${f.ref && f.ref.length ? ' → ' + esc(f.ref.join(', ')) : ''}</div></td><td>${editor(f, pre[f.name], 'class="nf-ed"')}</td></tr>`)
        .join('')}</tbody></table></div>
      <div class="nf-err err small" id="nfErr"></div>
      <div class="modal-acts"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>${I.plus} Create</button></div>`);
    const filter = () => {
      const q = bg.querySelector('#nfQ').value.toLowerCase();
      bg.querySelectorAll('tr[data-row]').forEach((tr) => { tr.style.display = (!onlyReq || tr.dataset.req === '1') && (!q || tr.textContent.toLowerCase().includes(q)) ? '' : 'none'; });
    };
    bg.querySelector('#nfQ').oninput = filter;
    bg.querySelector('#nfReq').onchange = (e) => { onlyReq = e.target.checked; filter(); };
    bg.onclick = async (e) => {
      if (e.target === bg || e.target.closest('[data-x]')) return bg.remove();
      if (!e.target.closest('[data-s]')) return;
      const rec = {};
      bg.querySelectorAll('.nf-ed').forEach((x) => {
        const f = fields.find((ff) => ff.name === x.dataset.f);
        const v = readEditor(f, x);
        if (v !== null && !(f.type === 'boolean' && v === false && !pre[f.name])) rec[f.name] = v;
      });
      const missing = fields.filter((f) => required(f) && rec[f.name] == null).map((f) => f.label);
      if (missing.length) { bg.querySelector('#nfErr').textContent = 'Required: ' + missing.join(', '); return; }
      if (!(await confirmDlg(`Create a new ${desc.label} in ${orgName()}?`, 'Create'))) return;
      try {
        const [res] = await call('dml', { op: 'insert', object, records: [rec] });
        if (!res.success) throw new Error(fmtErr(res));
        toast(`${desc.label} created: ${res.id}`, 'ok');
        bg.remove();
        if (opts.onDone) opts.onDone(res.id);
        else open(res.id, { object });
      } catch (err) {
        bg.querySelector('#nfErr').textContent = err.message;
      }
    };
  }

  // ---------- bulk edit (returns a {field: value} change) ----------
  async function bulkEdit(object, count) {
    const desc = await describe(object);
    const fields = desc.fields.filter((f) => f.updateable && !f.calculated && !['address', 'location', 'base64'].includes(f.type)).sort((a, b) => a.label.localeCompare(b.label));
    return new Promise((resolve) => {
      const bg = modal(`<h3>Bulk edit ${count} ${esc(desc.labelPlural || desc.label)}</h3>
        <label class="fld">Field<select id="beF">${fields.map((f) => `<option value="${esc(f.name)}">${esc(f.label)} — ${esc(f.name)} (${esc(f.type)})</option>`).join('')}</select></label>
        <label class="fld">New value<div id="beV"></div></label>
        <div class="muted small">The change is added to the grid as pending edits — review, then click <b>Save changes</b>. Leave empty to clear the field.</div>
        <div class="modal-acts"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Apply to ${count} row${count === 1 ? '' : 's'}</button></div>`, '');
      const draw = () => { const f = fields.find((x) => x.name === bg.querySelector('#beF').value); bg.querySelector('#beV').innerHTML = editor(f, null, 'id="beEd"'); };
      bg.querySelector('#beF').onchange = draw;
      draw();
      bg.onclick = (e) => {
        if (e.target === bg || e.target.closest('[data-x]')) { bg.remove(); return resolve(null); }
        if (e.target.closest('[data-s]')) {
          const f = fields.find((x) => x.name === bg.querySelector('#beF').value);
          const v = readEditor(f, bg.querySelector('#beEd'));
          bg.remove();
          resolve({ field: f.name, value: v });
        }
      };
    });
  }

  // ---------- import (insert / update / upsert / delete from CSV or pasted Excel) ----------
  function parseDelimited(text) {
    const first = text.split(/\r?\n/)[0] || '';
    const d = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"' && cur === '') q = true;
      else if (c === d) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur);
    if (row.some((x) => x !== '')) rows.push(row);
    return { header: (rows.shift() || []).map((h) => h.trim()), rows, delimiter: d };
  }
  async function importData(defaultObject, opts = {}) {
    const objs = await objects().catch(() => []);
    const bg = modal(`<h3>${I.download} Import data</h3>
      <div class="imp-grid">
        <label class="fld">Object<input id="imO" list="imOl" value="${esc(defaultObject || '')}" placeholder="Account"><datalist id="imOl">${objs.slice(0, 1500).map((o) => `<option value="${esc(o.name)}">${esc(o.label)}</option>`).join('')}</datalist></label>
        <label class="fld">Action<select id="imA"><option value="insert">Insert new records</option><option value="update">Update (needs Id column)</option><option value="upsert">Upsert (by external Id)</option><option value="delete">Delete (needs Id column)</option></select></label>
        <label class="fld" id="imEW" hidden>Match on<select id="imE"></select></label>
      </div>
      <label class="fld">Paste CSV, or copy cells from Excel/Sheets — first row = field API names<textarea id="imT" rows="7" spellcheck="false" placeholder="Name,Industry,AnnualRevenue&#10;Acme,Technology,1000000"></textarea></label>
      <div class="muted small">Empty cells are left unchanged; <code>#N/A</code> or <code>NULL</code> clears a field. Booleans accept true/false/1/0/yes/no. Max 10,000 rows per run; sent in batches of 200 (not all-or-none).</div>
      <div id="imP" class="imp-prev"></div>
      <div class="modal-acts"><button class="btn" data-x>Close</button><button class="btn" data-file>${I.file} Load file…</button><button class="btn primary" data-run disabled>Run</button></div>`);
    let desc = null, parsed = null, results = null;
    const $ = (s) => bg.querySelector(s);
    async function refresh() {
      const obj = $('#imO').value.trim();
      const act = $('#imA').value;
      $('#imEW').hidden = act !== 'upsert';
      try {
        if (obj && (!desc || desc.name.toLowerCase() !== obj.toLowerCase())) {
          desc = await describe(obj);
          $('#imE').innerHTML = desc.fields.filter((f) => f.externalId || f.idLookup).map((f) => `<option value="${esc(f.name)}">${esc(f.label)} (${esc(f.name)})</option>`).join('');
        }
      } catch (e) { desc = null; }
      const text = $('#imT').value;
      parsed = text.trim() ? parseDelimited(text) : null;
      const p = $('#imP');
      if (!obj) { p.innerHTML = '<div class="muted small">Choose an object.</div>'; $('[data-run]').disabled = true; return; }
      if (!desc) { p.innerHTML = `<div class="err small">Unknown object "${esc(obj)}".</div>`; $('[data-run]').disabled = true; return; }
      if (!parsed || !parsed.rows.length) { p.innerHTML = '<div class="muted small">Paste data with a header row.</div>'; $('[data-run]').disabled = true; return; }
      const fmap = new Map(desc.fields.map((f) => [f.name.toLowerCase(), f]));
      const cols = parsed.header.map((h) => {
        const f = fmap.get(h.toLowerCase());
        const ok = f && (h.toLowerCase() === 'id' || (act === 'insert' ? f.createable : act === 'delete' ? false : f.updateable || f.createable || f.externalId));
        return { h, f, ok };
      });
      const hasId = cols.some((c) => c.h.toLowerCase() === 'id');
      const needsId = ['update', 'delete'].includes(act) && !hasId;
      const needsExt = act === 'upsert' && !cols.some((c) => c.f && c.f.name === $('#imE').value);
      const warn = needsId ? 'An Id column is required for this action.' : needsExt ? `The data needs a ${$('#imE').value} column to match on.` : '';
      p.innerHTML = `<div class="imp-sum"><b>${parsed.rows.length.toLocaleString()}</b> row${parsed.rows.length === 1 ? '' : 's'} · delimiter <code>${parsed.delimiter === '\t' ? 'tab' : parsed.delimiter}</code> · columns: ${cols.map((c) => `<span class="flag ${c.ok || (act === 'delete' && c.h.toLowerCase() === 'id') ? 'ok' : 'bad'}" title="${c.f ? esc(c.f.label + ' · ' + c.f.type) : 'Not a field on ' + esc(desc.name) + ' — ignored'}">${esc(c.h)}</span>`).join(' ')}</div>
        ${warn ? `<div class="err small">${esc(warn)}</div>` : ''}
        <div class="modal-scroll" style="max-height:180px"><table class="dgrid compact"><thead><tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${parsed.rows.slice(0, 8).map((r) => `<tr>${cols.map((c, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${parsed.rows.length > 8 ? `<div class="muted small">Previewing 8 of ${parsed.rows.length} rows.</div>` : ''}`;
      $('[data-run]').disabled = !!warn || parsed.rows.length > 10000;
      $('[data-run]').textContent = `${act[0].toUpperCase() + act.slice(1)} ${parsed.rows.length.toLocaleString()} record${parsed.rows.length === 1 ? '' : 's'}`;
      bg._cols = cols;
    }
    let t;
    ['#imO', '#imT'].forEach((s) => ($(s).oninput = () => { clearTimeout(t); t = setTimeout(refresh, 250); }));
    ['#imA', '#imE'].forEach((s) => ($(s).onchange = refresh));
    refresh();
    bg.onclick = async (e) => {
      if (e.target === bg || e.target.closest('[data-x]')) return bg.remove();
      if (e.target.closest('[data-file]')) { const f = await call('readTextFile', {}); if (f) { $('#imT').value = f; refresh(); } return; }
      if (e.target.closest('[data-dl]')) return call('saveFile', { name: `import-results-${Date.now()}.csv`, content: results });
      if (!e.target.closest('[data-run]')) return;
      const act = $('#imA').value, cols = bg._cols, obj = desc.name;
      let records = [], ids = [];
      try {
        if (act === 'delete') ids = parsed.rows.map((r) => r[cols.findIndex((c) => c.h.toLowerCase() === 'id')]).filter(Boolean);
        else records = parsed.rows.map((r) => {
          const o = {};
          cols.forEach((c, i) => { if (!c.f) return; const v = coerce(c.f, r[i]); if (v !== undefined) o[c.f.name] = v; });
          return o;
        });
      } catch (err) { return toast(err.message, 'error'); }
      const n = act === 'delete' ? ids.length : records.length;
      if (!(await confirmDlg(`${act.toUpperCase()} ${n} ${desc.label} record${n === 1 ? '' : 's'} in ${orgName()}? This changes real data.`, 'Run'))) return;
      const btn = $('[data-run]');
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner sm"></span> Running…`;
      try {
        const res = await call('dml', { op: act, object: obj, records, ids, extField: $('#imE').value });
        const ok = res.filter((x) => x.success).length;
        const q = (s) => { const v = String(s ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        results = [[...parsed.header, 'RESULT', 'RECORD_ID', 'ERROR'].map(q).join(','), ...parsed.rows.map((r, i) => [...r, res[i] && res[i].success ? (res[i].created === false ? 'UPDATED' : 'SUCCESS') : 'ERROR', res[i] && res[i].id, res[i] ? fmtErr(res[i]) : ''].map(q).join(','))].join('\r\n');
        $('#imP').innerHTML = `<div class="imp-sum"><span class="onoff on">${ok} succeeded</span> ${res.length - ok ? `<span class="onoff off" style="color:var(--err)">${res.length - ok} failed</span>` : ''} <button class="btn sm" data-dl>${I.download} Download results CSV</button></div>
          <div class="modal-scroll" style="max-height:240px"><table class="dgrid compact"><thead><tr><th>#</th><th>Result</th><th>Id</th><th>Error</th></tr></thead><tbody>${res.map((x, i) => `<tr><td>${i + 1}</td><td>${x.success ? '<span class="onoff on">OK</span>' : '<span class="onoff off" style="color:var(--err)">Error</span>'}</td><td class="mono small">${esc(x.id || '')}</td><td class="small">${esc(fmtErr(x))}</td></tr>`).join('')}</tbody></table></div>`;
        toast(`${ok} of ${res.length} ${act === 'delete' ? 'deleted' : 'saved'}`, res.length - ok ? 'error' : 'ok');
        if (opts.onDone) opts.onDone();
      } catch (err) {
        toast(err.message, 'error');
      }
      btn.disabled = false;
      btn.textContent = 'Run again';
    };
  }

  window.SFLS.records = { open, create, bulkEdit, importData, editor, readEditor, objectForId, describe, fmtErr };
})();

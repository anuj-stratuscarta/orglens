// OrgLens — SOQL Explorer (Inspector-style)
(() => {
  'use strict';
  const { call, esc, I, toast } = window.SFLS;
  const KW = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'COUNT()', 'TODAY', 'YESTERDAY', 'LAST_N_DAYS:', 'THIS_MONTH', 'WITH SECURITY_ENFORCED', 'FIELDS(ALL)', 'FIELDS(STANDARD)', 'FIELDS(CUSTOM)', 'INCLUDES', 'EXCLUDES', 'TYPEOF'];
  let el, $;
  let tooling = false, includeDeleted = false;
  let objects = [], objQ = '', curObj = null, fieldQ = '';
  let result = null, rows = [], cols = [], resQ = '', sort = null, shownN = 500;
  let lastToken = null, suggestions = [];

  window.SFLS.pages.soql = {
    build(root) {
      el = root;
      $ = (s) => el.querySelector(s);
      const saved = JSON.parse(localStorageSafe('sfls.soql') || '{}');
      el.innerHTML = `<div class="sq">
        <aside class="sq-side">
          <div class="sq-side-head">
            <input id="oq" placeholder="Search objects…">
            <label class="chk muted"><input type="checkbox" id="tool"> Tooling API</label>
          </div>
          <div class="obj-list" id="objList"><div class="muted pad-s">Loading objects…</div></div>
          <div class="fld-panel" id="fldPanel"></div>
        </aside>
        <section class="sq-main">
          <div class="sq-editor">
            <div class="ed-bar">
              <button class="btn primary" id="run">${I.play} Run <span class="kbd">Ctrl+Enter</span></button>
              <label class="chk muted"><input type="checkbox" id="del"> Include deleted/archived</label>
              <span style="flex:1"></span>
              <button class="btn sm" id="countQ" data-tip="Count all matching rows without fetching them (SELECT COUNT() …)">Σ Count</button>
              <button class="btn sm" id="planQ" data-tip="Query plan: does this query use an index (selective) or scan the whole table?">${I.search} Plan</button>
              <button class="btn sm" id="openId" data-tip="Show all data for any record by pasting its Id">${I.ext} Open Id</button>
              <button class="btn sm" id="newRec" data-tip="Create a new record of the selected object">${I.plus} New</button>
              <button class="btn sm" id="impBtn" data-tip="Insert / update / upsert / delete records from CSV or pasted Excel data">${I.download} Import</button>
              <button class="btn sm" id="fmt" title="Format query">${I.code} Format</button>
              <button class="btn sm" id="hist">${I.clock} History</button>
              <button class="btn sm" id="savedBtn">${I.star} Saved</button>
              <button class="btn sm" id="saveQ">Save…</button>
            </div>
            <textarea id="q" spellcheck="false" placeholder="SELECT Id, Name FROM Account ORDER BY CreatedDate DESC LIMIT 50">${esc(saved.q || '')}</textarea>
            <div class="sugg" id="sugg"></div>
          </div>
          <div class="res-bar" id="resBar"></div>
          <div class="res" id="res"><div class="empty">${I.db}<div>Pick an object on the left or type a query, then press <span class="kbd">Ctrl+Enter</span>.<br><span class="muted">Autocomplete suggests objects, fields and relationships as you type · <span class="kbd">Tab</span> accepts the first suggestion.</span></div></div></div>
        </section>
      </div>`;
      tooling = !!saved.tooling;
      $('#tool').checked = tooling;
      $('#oq').oninput = (e) => { objQ = e.target.value.toLowerCase(); drawObjects(); };
      $('#tool').onchange = (e) => { tooling = e.target.checked; curObj = null; loadObjects(); persist(); };
      $('#del').onchange = (e) => (includeDeleted = e.target.checked);
      $('#objList').onclick = (e) => { const r = e.target.closest('[data-o]'); if (r) pickObject(r.dataset.o, true); };
      $('#run').onclick = runQuery;
      $('#fmt').onclick = () => { $('#q').value = format($('#q').value); persist(); };
      $('#hist').onclick = () => pickFrom('history');
      $('#savedBtn').onclick = () => pickFrom('saved');
      $('#saveQ').onclick = saveQuery;
      $('#countQ').onclick = countQuery;
      $('#planQ').onclick = planQuery;
      $('#openId').onclick = openById;
      $('#newRec').onclick = () => { const o = objName(); if (!o || o === 'query') return toast('Type a query with FROM <Object>, or pick an object first', 'error'); R().create(o, { onDone: (id) => R().open(id, recOpts()) }); };
      $('#impBtn').onclick = () => R().importData(objName() !== 'query' ? objName() : '', { onDone: () => result && runQuery() });
      const q = $('#q');
      q.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
        else if (e.key === 'Tab' && suggestions.length) { e.preventDefault(); accept(suggestions[0]); }
        else if (e.key === 'Escape') { suggestions = []; drawSugg(); }
      });
      ['input', 'click', 'keyup'].forEach((ev) => q.addEventListener(ev, (e) => { if (ev === 'keyup' && ['Tab', 'Enter'].includes(e.key)) return; persist(); suggest(); }));
      $('#sugg').onclick = (e) => { const s = e.target.closest('[data-i]'); if (s) accept(suggestions[+s.dataset.i]); };
      $('#res').onclick = resClick;
      $('#res').ondblclick = (e) => {
        const ed = e.target.closest('td.editable');
        if (ed && !ed.classList.contains('editing')) { e.preventDefault(); return startEdit(ed); }
        const td = e.target.closest('td[data-v]');
        if (td && !td.classList.contains('editing')) call('copy', { text: td.dataset.v });
      };
      loadObjects();
    },
  };

  function localStorageSafe(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch { /* no storage */ }
    return null;
  }
  const persist = () => localStorageSafe('sfls.soql', JSON.stringify({ q: $('#q').value, tooling }));

  // ---------- objects & fields ----------
  async function loadObjects() {
    $('#objList').innerHTML = '<div class="muted pad-s">Loading objects…</div>';
    try {
      objects = await call('describeGlobal', { tooling });
    } catch (e) {
      objects = [];
      $('#objList').innerHTML = `<div class="err pad-s">${esc(e.message)}</div>`;
      return;
    }
    drawObjects();
    const m = /\bFROM\s+(\w+)/i.exec($('#q').value);
    if (m && objects.some((o) => o.name.toLowerCase() === m[1].toLowerCase())) pickObject(objects.find((o) => o.name.toLowerCase() === m[1].toLowerCase()).name, false);
  }
  function drawObjects() {
    const list = objects.filter((o) => !objQ || o.name.toLowerCase().includes(objQ) || (o.label || '').toLowerCase().includes(objQ));
    list.sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(objQ) ? 0 : 1, bp = b.name.toLowerCase().startsWith(objQ) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
    $('#objList').innerHTML = list.length
      ? list.slice(0, 400).map((o) => `<div class="obj ${curObj && curObj.name === o.name ? 'on' : ''}" data-o="${esc(o.name)}"><span class="o-n">${esc(o.name)}</span><span class="o-l">${esc(o.label)}</span>${o.custom ? '<span class="badge">custom</span>' : ''}</div>`).join('') + (list.length > 400 ? `<div class="muted pad-s">${list.length - 400} more — refine search</div>` : '')
      : '<div class="muted pad-s">No objects match.</div>';
  }
  async function describe(name) {
    return call('describe', { name, tooling });
  }
  async function pickObject(name, setQuery) {
    try {
      curObj = await describe(name);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    drawObjects();
    if (setQuery) {
      const q = $('#q');
      const nameF = curObj.fields.find((f) => f.name === 'Name') ? ', Name' : '';
      q.value = `SELECT Id${nameF} FROM ${curObj.name} ORDER BY ${curObj.fields.some((f) => f.name === 'CreatedDate') ? 'CreatedDate DESC' : 'Id'} LIMIT 100`;
      persist();
    }
    drawFields();
  }
  function drawFields() {
    const p = $('#fldPanel');
    if (!curObj) { p.innerHTML = ''; return; }
    const fq = fieldQ.toLowerCase();
    const list = curObj.fields.filter((f) => !fq || f.name.toLowerCase().includes(fq) || f.label.toLowerCase().includes(fq) || f.type.includes(fq));
    p.innerHTML = `<div class="fp-head"><b>${esc(curObj.name)}</b> <span class="muted">${esc(curObj.label)} · ${curObj.fields.length} fields${curObj.prefix ? ' · ' + esc(curObj.prefix) : ''}</span></div>
      <div class="fp-tools"><input id="fq" placeholder="Filter fields…" value="${esc(fieldQ)}"><button class="btn sm" id="allF" title="Query all fields">All</button></div>
      <div class="fld-list">${list.map((f) => `<div class="fld" data-f="${esc(f.name)}" title="${esc(f.label)}${f.ref && f.ref.length ? ' → ' + esc(f.ref.join(', ')) : ''}${f.picklist.length ? '\nValues: ' + esc(f.picklist.slice(0, 25).join(', ')) : ''}\nClick: insert · Shift+click: add to SELECT"><span class="f-n">${esc(f.name)}</span><span class="ftype t-${esc(f.type)}">${esc(f.type)}</span>${f.rel ? `<span class="rel" data-rel="${esc(f.rel)}" title="Insert ${esc(f.rel)}.">${esc(f.rel)}.</span>` : ''}</div>`).join('')}</div>
      ${curObj.children.length ? `<details class="kids"><summary>Child relationships (${curObj.children.length})</summary>${curObj.children.slice(0, 200).map((c) => `<div class="fld" data-sub="${esc(c.rel)}" title="Insert sub-query"><span class="f-n">${esc(c.rel)}</span><span class="muted small">${esc(c.object)}</span></div>`).join('')}</details>` : ''}`;
    const fqEl = p.querySelector('#fq');
    fqEl.oninput = (e) => { fieldQ = e.target.value; const pos = e.target.selectionStart; drawFields(); const n = $('#fq'); n.focus(); n.setSelectionRange(pos, pos); };
    p.querySelector('#allF').onclick = () => {
      const names = curObj.fields.filter((f) => f.type !== 'address' && f.type !== 'location' && f.type !== 'base64').map((f) => f.name);
      $('#q').value = `SELECT ${names.join(', ')}\nFROM ${curObj.name}\nLIMIT 50`;
      persist();
    };
    p.querySelector('.fld-list').onclick = (e) => {
      const rel = e.target.closest('[data-rel]');
      if (rel) { insertAtCursor(rel.dataset.rel + '.'); suggest(); return; }
      const f = e.target.closest('[data-f]');
      if (!f) return;
      if (e.shiftKey) addToSelect(f.dataset.f);
      else insertAtCursor(f.dataset.f);
    };
    const kids = p.querySelector('.kids');
    if (kids) kids.onclick = (e) => { const s = e.target.closest('[data-sub]'); if (s) addToSelect(`(SELECT Id FROM ${s.dataset.sub})`); };
  }
  function insertAtCursor(text) {
    const q = $('#q');
    const s = q.selectionStart, e2 = q.selectionEnd, v = q.value;
    const before = v.slice(0, s);
    const sep = before && !/[\s,(.]$/.test(before) ? ', ' : '';
    q.value = before + sep + text + v.slice(e2);
    const pos = s + sep.length + text.length;
    q.focus();
    q.setSelectionRange(pos, pos);
    persist();
  }
  function addToSelect(field) {
    const q = $('#q');
    const v = q.value;
    const m = /^\s*SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(v);
    if (!m) { q.value = `SELECT Id, ${field} FROM ${curObj ? curObj.name : ''}`; persist(); return; }
    if (new RegExp(`(^|[\\s,])${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s,]|$)`, 'i').test(m[1])) return toast(`${field} is already selected`);
    const idx = m.index + m[0].length - m[0].match(/\s+FROM\s$/i)[0].length;
    q.value = v.slice(0, idx) + ', ' + field + v.slice(idx);
    persist();
  }

  // ---------- autocomplete ----------
  async function suggest() {
    const q = $('#q');
    const pos = q.selectionStart;
    const before = q.value.slice(0, pos);
    const tm = /[\w.]*$/.exec(before);
    const token = tm[0];
    const prefix = before.slice(0, before.length - token.length);
    const key = token + '|' + q.value.length + '|' + pos;
    if (key === lastToken) return;
    lastToken = key;
    let list = [];
    try {
      if (/\bFROM\s+$/i.test(prefix)) {
        const ctxObj = subqueryParent(before);
        if (ctxObj) {
          const parent = await describe(ctxObj);
          list = parent.children.filter((c) => c.rel.toLowerCase().startsWith(token.toLowerCase())).map((c) => ({ v: c.rel, d: c.object, k: 'rel' }));
        } else {
          const t = token.toLowerCase();
          list = objects.filter((o) => o.name.toLowerCase().includes(t)).sort((a, b) => (a.name.toLowerCase().startsWith(t) ? 0 : 1) - (b.name.toLowerCase().startsWith(t) ? 0 : 1)).map((o) => ({ v: o.name, d: o.label, k: 'obj' }));
        }
      } else {
        const objName = await contextObject(q.value, pos);
        if (objName) {
          let d = await describe(objName);
          const parts = token.split('.');
          const last = parts.pop().toLowerCase();
          for (const seg of parts) {
            const f = d.fields.find((x) => x.rel && x.rel.toLowerCase() === seg.toLowerCase());
            if (!f || !f.ref || !f.ref.length) { d = null; break; }
            d = await describe(f.ref[0]);
          }
          if (d) {
            const lead = parts.length ? parts.join('.') + '.' : '';
            const fl = d.fields.filter((f) => f.name.toLowerCase().includes(last) || (f.rel && f.rel.toLowerCase().startsWith(last)));
            fl.sort((a, b) => (a.name.toLowerCase().startsWith(last) ? 0 : 1) - (b.name.toLowerCase().startsWith(last) ? 0 : 1));
            for (const f of fl) {
              if (f.name.toLowerCase().includes(last)) list.push({ v: lead + f.name, d: f.type, k: 'fld' });
              if (f.rel && f.rel.toLowerCase().startsWith(last)) list.push({ v: lead + f.rel + '.', d: '→ ' + (f.ref || []).join('/'), k: 'rel' });
            }
            // picklist values after `Field = '` or IN (
            const pm = /(\w+)\s*(=|!=|IN\s*\(|INCLUDES\s*\()\s*'?[^']*$/i.exec(before);
            if (pm && /'/.test(before.slice(before.lastIndexOf(pm[0])))) {
              const pf = d.fields.find((x) => x.name.toLowerCase() === pm[1].toLowerCase());
              if (pf && pf.picklist.length) list = pf.picklist.filter((p) => p.toLowerCase().includes(last)).map((p) => ({ v: p, d: 'value', k: 'val' }));
            }
          }
        }
        if (token && !token.includes('.')) {
          const t = token.toUpperCase();
          KW.filter((k) => k.startsWith(t) && k !== t).forEach((k) => list.push({ v: k, d: 'keyword', k: 'kw' }));
        }
      }
    } catch { /* ignore describe failures */ }
    suggestions = token || /\bFROM\s+$/i.test(prefix) || /\.\s*$/.test(before) ? list.slice(0, 60) : [];
    drawSugg();
  }
  function drawSugg() {
    $('#sugg').innerHTML = suggestions.map((s, i) => `<span class="sg sg-${s.k}" data-i="${i}" title="${esc(s.d || '')}">${esc(s.v)}${s.d && s.k !== 'kw' ? `<i>${esc(String(s.d).slice(0, 24))}</i>` : ''}</span>`).join('');
  }
  function accept(s) {
    const q = $('#q');
    const pos = q.selectionStart;
    const before = q.value.slice(0, pos);
    const token = /[\w.]*$/.exec(before)[0];
    let v = s.v;
    if (s.k === 'val') {
      const lastTok = token.split('.').pop();
      q.value = before.slice(0, before.length - lastTok.length) + v + "'" + q.value.slice(pos);
      const np = pos - lastTok.length + v.length + 1;
      q.setSelectionRange(np, np);
    } else {
      q.value = before.slice(0, before.length - token.length) + v + q.value.slice(pos);
      const np = pos - token.length + v.length;
      q.setSelectionRange(np, np);
    }
    q.focus();
    lastToken = null;
    persist();
    suggest();
  }
  /** Object the caret is "in": sub-query relationship or main FROM. */
  function contextObject(text, pos) {
    let depth = 0;
    for (let i = pos - 1; i >= 0; i--) {
      if (text[i] === ')') depth++;
      else if (text[i] === '(') {
        if (depth === 0) {
          const end = matchParen(text, i);
          const inner = text.slice(i + 1, end);
          const fm = /^\s*SELECT\b[\s\S]*?\bFROM\s+(\w+)/i.exec(inner);
          if (fm) {
            const parentObj = mainObject(text.slice(0, i) + text.slice(end + 1));
            return childObj(parentObj, fm[1]);
          }
        } else depth--;
      }
    }
    return mainObject(text) || (curObj && curObj.name) || null;
  }
  function subqueryParent(before) {
    const i = before.lastIndexOf('(');
    if (i < 0 || before.slice(i).includes(')')) return null;
    if (!/^\(\s*SELECT\b/i.test(before.slice(i))) return null;
    return mainObject(before.slice(0, i) + ' ' + $('#q').value.slice(before.length));
  }
  function mainObject(text) {
    const stripped = text.replace(/\([^()]*\)/g, '');
    const m = /\bFROM\s+(\w+)/i.exec(stripped);
    return m ? (objects.find((o) => o.name.toLowerCase() === m[1].toLowerCase()) || { name: m[1] }).name : null;
  }
  async function childObj(parent, rel) {
    if (!parent) return null;
    const d = await describe(parent);
    const c = d.children.find((x) => x.rel.toLowerCase() === rel.toLowerCase());
    return c ? c.object : null;
  }
  function matchParen(t, i) {
    let d = 0;
    for (let j = i; j < t.length; j++) { if (t[j] === '(') d++; else if (t[j] === ')' && --d === 0) return j; }
    return t.length;
  }
  function format(q) {
    let s = q.replace(/\s+/g, ' ').trim();
    s = s.replace(/\b(select|from|where|and|or|not|in|like|order by|group by|having|limit|offset|asc|desc|nulls first|nulls last|includes|excludes|with)\b/gi, (m) => m.toUpperCase());
    return s.replace(/ (FROM|WHERE|ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET) /g, '\n$1 ').replace(/ (AND|OR) /g, '\n  $1 ');
  }

  // ---------- history / saved ----------
  async function pickFrom(kind) {
    const list = await call(kind === 'history' ? 'history' : 'saved');
    if (!list.length) return toast(kind === 'history' ? 'No history yet' : 'No saved queries yet');
    const p = await call('pickItems', {
      title: kind === 'history' ? 'Query history' : 'Saved queries',
      items: list.map((h, i) => ({ label: (h.name ? h.name + ' — ' : '') + h.soql.replace(/\s+/g, ' ').slice(0, 140), description: (h.tooling ? 'Tooling · ' : '') + (h.org || '') + (h.at ? ' · ' + new Date(h.at).toLocaleString() : ''), i })),
    });
    if (!p) return;
    const h = list[p.i];
    $('#q').value = h.soql;
    if (!!h.tooling !== tooling) { tooling = !!h.tooling; $('#tool').checked = tooling; await loadObjects(); }
    persist();
    runQuery();
  }
  async function saveQuery() {
    const soql = $('#q').value.trim();
    if (!soql) return;
    const dlg = document.createElement('div');
    dlg.className = 'modal-bg';
    dlg.innerHTML = `<div class="modal"><h3>Save query</h3><label class="fld">Name<input id="sqName" placeholder="e.g. Open orders by account"></label><div class="modal-acts"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#sqName').focus();
    dlg.onclick = async (e) => {
      if (e.target === dlg || e.target.closest('[data-x]')) return dlg.remove();
      if (e.target.closest('[data-s]')) {
        const name = dlg.querySelector('#sqName').value.trim();
        if (!name) return;
        await call('saveQuery', { name, soql, tooling });
        toast('Query saved', 'ok');
        dlg.remove();
      }
    };
  }

  // ---------- run & results ----------
  async function runQuery() {
    const soql = $('#q').value.trim().replace(/;+\s*$/, '');
    if (!soql) return;
    $('#run').disabled = true;
    $('#resBar').innerHTML = '<span class="muted"><span class="spinner sm"></span> Running…</span>';
    try {
      result = await call('query', { soql, tooling, all: includeDeleted });
      rows = result.records.map((r) => flatten(r));
      cols = columnsOf(rows);
      sort = null;
      resQ = '';
      shownN = 500;
      pending = new Map();
      selected = new Set();
      rowErr = new Map();
      resObj = tooling ? null : (rows[0] && rows[0].__type) || null;
      resDesc = null;
      drawResults();
      if (resObj && cols.includes('Id')) {
        try { resDesc = await call('describe', { name: resObj, tooling: false }); drawResults(); } catch { /* read-only */ }
      }
    } catch (e) {
      $('#resBar').innerHTML = '';
      $('#res').innerHTML = `<div class="q-err"><b>Query failed</b><pre>${esc(e.message)}</pre></div>`;
    }
    $('#run').disabled = false;
  }
  async function loadMore() {
    if (!result || !result.next) return;
    try {
      const r = await call('queryMore', { next: result.next });
      result.next = r.next;
      result.done = r.done;
      const more = r.records.map((x) => flatten(x));
      rows.push(...more);
      cols = columnsOf(rows);
      shownN += more.length;
      drawResults();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  function flatten(rec, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'attributes') {
        if (!prefix) out.__type = v.type;
        continue;
      }
      const key = prefix + k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (Array.isArray(v.records)) out[key] = { __sub: v.records, total: v.totalSize };
        else if (v.attributes) flatten(v, key + '.', out);
        else out[key] = v;
      } else out[key] = v;
    }
    return out;
  }
  function columnsOf(list) {
    const seen = new Set();
    for (const r of list) for (const k of Object.keys(r)) if (k !== '__type') seen.add(k);
    return [...seen];
  }
  const cellText = (v) => (v == null ? '' : typeof v === 'object' ? (v.__sub ? `[${v.__sub.length} records]` : JSON.stringify(v)) : String(v));
  const isId = (v) => typeof v === 'string' && /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(v) && /^[a-zA-Z0-9]{3}[0-9A-Za-z]/.test(v) && /\d/.test(v);
  function visibleRows() {
    let list = rows;
    if (resQ) {
      const q = resQ.toLowerCase();
      list = list.filter((r) => cols.some((c) => cellText(r[c]).toLowerCase().includes(q)));
    }
    if (sort) {
      const { k, dir } = sort;
      list = [...list].sort((a, b) => {
        const A = a[k], B = b[k];
        if (A == null) return 1;
        if (B == null) return -1;
        return (typeof A === 'number' && typeof B === 'number' ? A - B : cellText(A).localeCompare(cellText(B), undefined, { numeric: true })) * dir;
      });
    }
    return list;
  }
  function drawResults() {
    const list = visibleRows();
    $('#resBar').innerHTML = `<b>${result.totalSize.toLocaleString()}</b>&nbsp;record${result.totalSize === 1 ? '' : 's'} <span class="muted">· ${rows.length.toLocaleString()} loaded · ${result.ms} ms${tooling ? ' · Tooling' : ''}</span>
      ${result.next ? `<button class="btn sm" data-r="more">Load more</button>` : ''}
      <span style="flex:1"></span>
      <input id="rq" class="rq" placeholder="Filter results…" value="${esc(resQ)}">
      <button class="btn sm" data-r="csv" title="Save as CSV">${I.download} CSV</button>
      <button class="btn sm" data-r="json" title="Save as JSON">${I.download} JSON</button>
      <button class="btn sm" data-r="copy" title="Copy as tab-separated (paste into Excel)">${I.copy} Copy</button>
      <span class="seg dens"><button data-r="d-compact" class="${density === 'compact' ? 'on' : ''}" title="Compact rows">Compact</button><button data-r="d-comfy" class="${density === 'comfy' ? 'on' : ''}" title="Comfortable rows">Comfortable</button></span>`;
    const rq = $('#rq');
    rq.oninput = (e) => { resQ = e.target.value; const p = e.target.selectionStart; drawResults(); const n = $('#rq'); n.focus(); n.setSelectionRange(p, p); };
    $('#resBar').onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const a = b.dataset.r;
      if (a === 'more') loadMore();
      if (a === 'csv') call('saveFile', { name: `${objName()}-${stamp()}.csv`, content: toDelimited(visibleRows(), ',') });
      if (a === 'json') call('saveFile', { name: `${objName()}-${stamp()}.json`, content: JSON.stringify(result.records.map(strip), null, 2) });
      if (a === 'copy') call('copy', { text: toDelimited(visibleRows(), '\t') });
      if (a === 'd-compact' || a === 'd-comfy') { density = a === 'd-compact' ? 'compact' : 'comfy'; localStorageSafe('sfls.density', density); drawResults(); }
    };
    if (!rows.length) { $('#res').innerHTML = '<div class="empty">No records returned.</div>'; return; }
    const shown = list.slice(0, shownN);
    shownRows = shown;
    const canEdit = !!(resDesc && resDesc.updateable);
    const nPend = [...pending.values()].reduce((s, ch) => s + Object.keys(ch).length, 0);
    const actBar = `<div class="act-bar ${pending.size || selected.size || lastUndo ? 'show' : ''}">
      ${pending.size ? `<span class="pend"><b>${nPend}</b> unsaved change${nPend === 1 ? '' : 's'} in ${pending.size} record${pending.size === 1 ? '' : 's'}</span><button class="btn sm primary" data-x="save">Save changes</button><button class="btn sm" data-x="discard">Discard</button><span class="sep"></span>` : ''}
      ${selected.size ? `<span><b>${selected.size}</b> selected</span>
        ${selected.size === 1 ? `<button class="btn sm" data-x="showall">${I.ext} Show all data</button>${resDesc && resDesc.createable ? `<button class="btn sm" data-x="clone">${I.copy} Clone</button>` : ''}` : ''}
        ${canEdit ? `<button class="btn sm" data-x="bulk">${I.gear} Bulk edit…</button>` : ''}
        ${resDesc && resDesc.deletable ? `<button class="btn sm danger" data-x="delete">${I.trash} Delete</button>` : ''}
        <button class="btn sm" data-x="copyids">${I.copy} Copy Ids</button>
        <button class="btn sm" data-x="clearsel">Clear selection</button><span class="sep"></span>` : ''}
      ${lastUndo ? `<button class="btn sm" data-x="undo" title="Restore the previous values of the last save">↶ Undo last save (${lastUndo.length})</button>` : ''}
    </div>`;
    const hint = resObj && !cols.includes('Id') ? `<div class="banner">Add <b>Id</b> to the SELECT to edit, delete or open these ${esc(resObj)} records.</div>` : canEdit && !pending.size && !selected.size ? `<div class="hint-line muted small">Double-click a cell to edit · tick rows to bulk edit, delete or clone · click # to show all data</div>` : '';
    const head = cols
      .map((c) => {
        const t = fieldType(c);
        const w = colW[c] ? `style="width:${colW[c]}px;min-width:${colW[c]}px;max-width:${colW[c]}px"` : '';
        return `<th data-k="${esc(c)}" ${w} title="${esc(c)}${t ? ' · ' + esc(t.label) + ' (' + esc(t.type) + ')' : ''}"><div class="th-in"><span class="th-n">${esc(c)}</span>${t ? `<span class="th-t">${esc(t.type)}</span>` : ''}<span class="th-s">${sort && sort.k === c ? (sort.dir > 0 ? '▲' : '▼') : ''}</span></div><span class="rsz" data-rsz="${esc(c)}"></span></th>`;
      })
      .join('');
    const hasId = cols.includes('Id');
    const allSel = hasId && shown.length && shown.every((r) => selected.has(r));
    $('#res').innerHTML = `${actBar}${hint}<table class="dgrid ${density}"><thead><tr><th class="rn" title="Click a row number to show all data">#</th>${hasId ? `<th class="ck"><input type="checkbox" id="selAll" ${allSel ? 'checked' : ''} title="Select all shown rows"></th>` : ''}${head}</tr></thead><tbody>${shown
      .map((r, i) => {
        const ch = pending.get(r) || {};
        const err = rowErr.get(r);
        return `<tr class="${selected.has(r) ? 'row-sel' : ''} ${err ? 'row-err' : ''}" ${err ? `title="${esc(err)}"` : ''}><td class="rn" data-row="${i}" title="Show all data">${err ? '⚠ ' : ''}${i + 1}</td>${hasId ? `<td class="ck"><input type="checkbox" data-sel="${i}" ${selected.has(r) ? 'checked' : ''}></td>` : ''}${cols
          .map((c) => cell(c in ch ? ch[c] : r[c], c, { dirty: c in ch, editable: canEdit && hasId && editableField(c), row: i }))
          .join('')}</tr>`;
      })
      .join('')}</tbody></table>${list.length > shownN ? `<div class="pad-s"><button class="btn sm" data-more-rows>Show ${Math.min(500, list.length - shownN)} more rows</button> <span class="muted">${list.length - shownN} hidden</span></div>` : ''}`;
  }
  // ---------- editing state ----------
  let pending = new Map(); // row -> {field: newValue}
  let selected = new Set(); // rows
  let rowErr = new Map(); // row -> error text
  let resObj = null, resDesc = null, lastUndo = null;
  const R = () => window.SFLS.records;
  const orgAlias = () => ((window.SFLS.getState() || {}).org || {}).alias || 'this org';
  const fieldMeta = (c) => (resDesc && !c.includes('.') ? resDesc.fields.find((f) => f.name === c) : null);
  const editableField = (c) => { const f = fieldMeta(c); return !!(f && f.updateable && !f.calculated && !['address', 'location', 'base64'].includes(f.type)); };
  const recOpts = () => ({
    onQuery: (soql) => { $('#q').value = soql; persist(); runQuery(); },
    onChange: (ev) => {
      const row = rows.find((r) => r.Id === ev.id);
      if (ev.type === 'delete' && row) { rows = rows.filter((r) => r !== row); selected.delete(row); pending.delete(row); result.totalSize--; drawResults(); }
      if (ev.type === 'update' && row) { Object.assign(row, ev.changes); drawResults(); }
    },
  });
  function startEdit(td) {
    const r = shownRows[+td.dataset.row];
    const c = td.dataset.c;
    const f = fieldMeta(c);
    const ch = pending.get(r) || {};
    const cur = c in ch ? ch[c] : r[c];
    td.classList.add('editing');
    td.innerHTML = R().editor(f, cur, 'class="cell-ed"');
    const ed = td.querySelector('.cell-ed');
    ed.focus();
    if (ed.select && ed.type === 'text') ed.select();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      if (save) {
        const v = R().readEditor(f, ed);
        const orig = r[c] ?? null;
        const same = f.type === 'datetime' ? orig && v && new Date(orig).getTime() === new Date(v).getTime() : v === orig || (v == null && orig === '');
        const p = pending.get(r) || {};
        if (same) delete p[c]; else p[c] = v;
        if (Object.keys(p).length) pending.set(r, p); else pending.delete(r);
      }
      drawResults();
    };
    ed.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && f.type !== 'textarea' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    ed.addEventListener('blur', () => setTimeout(() => commit(true), 120));
    if (f.type === 'boolean' || f.type === 'picklist') ed.addEventListener('change', () => commit(true));
  }
  async function saveChanges() {
    const entries = [...pending.entries()];
    const n = entries.reduce((s, [, ch]) => s + Object.keys(ch).length, 0);
    if (!(await call('confirm', { message: `Save ${n} change${n === 1 ? '' : 's'} to ${entries.length} ${resDesc.label} record${entries.length === 1 ? '' : 's'} in ${orgAlias()}?`, action: 'Save' }))) return;
    const undo = entries.map(([r, ch]) => ({ Id: r.Id, ...Object.fromEntries(Object.keys(ch).map((k) => [k, r[k] ?? null])) }));
    try {
      const res = await call('dml', { op: 'update', object: resObj, records: entries.map(([r, ch]) => ({ Id: r.Id, ...ch })) });
      let ok = 0;
      const okUndo = [];
      res.forEach((x, i) => {
        const [r, ch] = entries[i];
        if (x.success) { ok++; Object.assign(r, ch); pending.delete(r); rowErr.delete(r); okUndo.push(undo[i]); }
        else rowErr.set(r, R().fmtErr(x));
      });
      lastUndo = okUndo.length ? okUndo : lastUndo;
      toast(`${ok} of ${res.length} record${res.length === 1 ? '' : 's'} saved${res.length - ok ? ' — hover ⚠ rows for errors' : ''}`, res.length - ok ? 'error' : 'ok');
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
    }
    drawResults();
  }
  async function undoLast() {
    if (!lastUndo) return;
    if (!(await call('confirm', { message: `Restore previous values on ${lastUndo.length} record${lastUndo.length === 1 ? '' : 's'} in ${orgAlias()}?`, action: 'Undo' }))) return;
    try {
      const res = await call('dml', { op: 'update', object: resObj, records: lastUndo });
      res.forEach((x, i) => { if (x.success) { const r = rows.find((y) => y.Id === lastUndo[i].Id); if (r) { const { Id, ...vals } = lastUndo[i]; Object.assign(r, vals); } } });
      toast(`Restored ${res.filter((x) => x.success).length} record(s)`, 'ok');
      lastUndo = null;
    } catch (e) { toast('Undo failed: ' + e.message, 'error'); }
    drawResults();
  }
  async function deleteSelected() {
    const list = [...selected];
    if (!(await call('confirm', { message: `Delete ${list.length} ${resDesc.label} record${list.length === 1 ? '' : 's'} from ${orgAlias()}? They go to the Recycle Bin.`, action: 'Delete' }))) return;
    try {
      const res = await call('dml', { op: 'delete', ids: list.map((r) => r.Id) });
      let ok = 0;
      res.forEach((x, i) => { const r = list[i]; if (x.success) { ok++; rows = rows.filter((y) => y !== r); selected.delete(r); pending.delete(r); } else rowErr.set(r, R().fmtErr(x)); });
      result.totalSize -= ok;
      toast(`${ok} of ${list.length} deleted`, ok === list.length ? 'ok' : 'error');
    } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
    drawResults();
  }
  async function bulkEditSelected() {
    const ch = await R().bulkEdit(resObj, selected.size);
    if (!ch) return;
    for (const r of selected) {
      const p = pending.get(r) || {};
      if ((r[ch.field] ?? null) === ch.value) delete p[ch.field]; else p[ch.field] = ch.value;
      if (Object.keys(p).length) pending.set(r, p); else pending.delete(r);
    }
    drawResults();
    toast('Pending — review the highlighted cells, then Save changes');
  }
  function topLevelFromIndex(s) {
    let d = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') d++;
      else if (s[i] === ')') d--;
      else if (d === 0 && /\bFROM\b/i.test(s.slice(i, i + 5)) && /\s/.test(s[i - 1] || ' ')) return i;
    }
    return -1;
  }
  async function countQuery() {
    const s = $('#q').value.trim().replace(/;+\s*$/, '');
    const i = topLevelFromIndex(s);
    if (i < 0) return toast('No FROM clause found', 'error');
    const q = 'SELECT COUNT() ' + s.slice(i).replace(/\s+ORDER\s+BY[\s\S]*$/i, '').replace(/\s+(LIMIT|OFFSET)\s+\d+/gi, '');
    try {
      const r = await call('query', { soql: q, tooling, all: includeDeleted });
      toast(`${r.totalSize.toLocaleString()} matching row${r.totalSize === 1 ? '' : 's'}`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function planQuery() {
    const s = $('#q').value.trim().replace(/;+\s*$/, '');
    if (!s) return;
    try {
      const r = await call('explain', { soql: s });
      const plans = r.plans || [];
      const dlg = document.createElement('div');
      dlg.className = 'modal-bg';
      dlg.innerHTML = `<div class="modal wide"><h3>Query plan</h3><div class="muted small mono" style="margin-bottom:10px">${esc(s)}</div>
        ${plans.length ? `<table class="dgrid kv"><thead><tr><th></th><th>Leading operation</th><th>Fields</th><th>Relative cost</th><th>Est. rows</th><th>Table rows</th><th>Notes</th></tr></thead><tbody>${plans
          .map((p, i) => `<tr><td>${i === 0 ? '<b>Best</b>' : 'Alt ' + i}</td><td>${esc(p.leadingOperationType)}</td><td class="mono small">${esc((p.fields || []).join(', '))}</td><td><span class="onoff ${p.relativeCost < 1 ? 'on' : 'off'}" style="${p.relativeCost < 1 ? '' : 'color:var(--err)'}">${(+p.relativeCost).toFixed(2)} ${p.relativeCost < 1 ? 'selective' : 'not selective'}</span></td><td class="num">${(p.cardinality || 0).toLocaleString()}</td><td class="num">${(p.sobjectCardinality || 0).toLocaleString()}</td><td class="small">${(p.notes || []).map((n) => esc(n.description + (n.fields ? ' (' + n.fields.join(', ') + ')' : ''))).join('<br>')}</td></tr>`)
          .join('')}</tbody></table><p class="muted small">Cost below 1.0 means the optimizer can use an index (selective). Above 1.0 means a full table scan — add a filter on an indexed field (Id, Name, lookups, external Ids, CreatedDate…).</p>` : '<div class="muted">No plan returned (queries with bind variables or on some objects cannot be explained).</div>'}
        <div class="modal-acts"><button class="btn primary" data-x>Close</button></div></div>`;
      document.body.appendChild(dlg);
      dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-x]')) dlg.remove(); };
    } catch (e) { toast('Plan unavailable: ' + e.message, 'error'); }
  }
  function openById() {
    const dlg = document.createElement('div');
    dlg.className = 'modal-bg';
    dlg.innerHTML = `<div class="modal"><h3>Show all data for a record</h3><label class="fld">Record Id (15 or 18 characters) or a Salesforce URL<input id="oiV" placeholder="001d500000hLIikAAG"></label><div class="modal-acts"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Open</button></div></div>`;
    document.body.appendChild(dlg);
    const inp = dlg.querySelector('#oiV');
    inp.focus();
    const go = () => {
      const m = /([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})(?![a-zA-Z0-9])/.exec(inp.value.trim().split('?')[0].split('/').filter((x) => /^[a-zA-Z0-9]{15,18}$/.test(x)).pop() || inp.value.trim());
      if (!m) return toast('That does not look like a record Id', 'error');
      dlg.remove();
      R().open(m[1], recOpts());
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-x]')) dlg.remove(); if (e.target.closest('[data-s]')) go(); };
  }
  let density = localStorageSafe('sfls.density') || 'compact';
  let shownRows = [];
  const colW = {};
  function fieldType(c) {
    if (!curObj || c.includes('.')) return null;
    const m = objName();
    if (m.toLowerCase() !== curObj.name.toLowerCase()) return null;
    return curObj.fields.find((f) => f.name === c) || null;
  }
  // column resize + cell selection
  document.addEventListener('mousedown', (e) => {
    const h = e.target.closest && e.target.closest('.rsz');
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    const th = h.parentElement;
    const k = h.dataset.rsz;
    const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(50, Math.round(w0 + ev.clientX - x0));
      colW[k] = w;
      th.style.width = th.style.minWidth = th.style.maxWidth = w + 'px';
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); th._justResized = true; setTimeout(() => (th._justResized = false), 0); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, true);
  let selCell = null;
  document.addEventListener('keydown', (e) => {
    if (!selCell || !document.body.contains(selCell)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !window.getSelection().toString()) { e.preventDefault(); call('copy', { text: selCell.dataset.v || '' }); }
  });
  function showRecord(r) {
    const keys = cols.filter((c) => c in r);
    const dlg = document.createElement('div');
    dlg.className = 'modal-bg';
    const id = r.Id || '';
    dlg.innerHTML = `<div class="modal wide"><h3>${esc(r.__type || objName())} ${id ? `<a class="rid" data-id="${esc(id)}">${esc(id)}</a>` : ''}</h3>
      <div class="modal-scroll"><table class="dgrid kv"><thead><tr><th>Field</th><th>Type</th><th>Value</th></tr></thead><tbody>${keys
        .map((k) => { const t = fieldType(k); return `<tr><td class="mono">${esc(k)}${t && t.label !== k ? `<div class="muted small">${esc(t.label)}</div>` : ''}</td><td class="muted small">${t ? esc(t.type) : ''}</td>${cell(r[k], k)}</tr>`; })
        .join('')}</tbody></table></div>
      <div class="modal-acts"><button class="btn" data-cj>${I.copy} Copy as JSON</button><button class="btn primary" data-x>Close</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.onclick = (e) => {
      if (e.target === dlg || e.target.closest('[data-x]')) return dlg.remove();
      if (e.target.closest('[data-cj]')) { const o = {}; keys.forEach((k) => (o[k] = r[k] && r[k].__sub ? r[k].__sub.map(strip) : r[k])); call('copy', { text: JSON.stringify(o, null, 2) }); }
      const a = e.target.closest('.rid');
      if (a) { dlg.remove(); R().open(a.dataset.show || a.dataset.id, recOpts()); }
    };
  }
  function cell(v, c, o = {}) {
    const ed = o.editable ? ` data-c="${esc(c)}" data-row="${o.row}"` : '';
    const cls = [o.editable ? 'editable' : '', o.dirty ? 'dirty' : ''].filter(Boolean).join(' ');
    if (v == null || v === '') return `<td class="null ${cls}"${ed} data-v="">${o.dirty ? '<span class="muted">(cleared)</span>' : 'null'}</td>`;
    if (typeof v === 'object' && v.__sub) return `<td><button class="subq" data-sub='${esc(JSON.stringify(v.__sub.map(strip)))}' data-col="${esc(c)}">${v.__sub.length} record${v.__sub.length === 1 ? '' : 's'} ▸</button></td>`;
    const t = cellText(v);
    if (typeof v === 'boolean') return `<td class="${cls}"${ed} data-v="${t}"><span class="bool ${v}">${t}</span></td>`;
    if (typeof v === 'number') return `<td class="num ${cls}"${ed} data-v="${t}">${t}</td>`;
    if ((c === 'Id' || c.endsWith('Id') || c.endsWith('.Id')) && isId(t)) return `<td class="${cls}"${ed} data-v="${esc(t)}"><a class="rid" data-show="${esc(t)}" title="Show all data (Ctrl+click: open in Salesforce)">${esc(t)}</a></td>`;
    return `<td class="${cls}"${ed} data-v="${esc(t)}" title="${t.length > 80 ? esc(t.slice(0, 1000)) : ''}">${esc(t.length > 200 ? t.slice(0, 200) + '…' : t)}</td>`;
  }
  function resClick(e) {
    if (e.target.closest('.rsz') || e.target.closest('.cell-ed')) return;
    const x = e.target.closest('[data-x]');
    if (x) {
      const a = x.dataset.x;
      const one = [...selected][0];
      if (a === 'save') return saveChanges();
      if (a === 'discard') { pending.clear(); rowErr.clear(); return drawResults(); }
      if (a === 'undo') return undoLast();
      if (a === 'delete') return deleteSelected();
      if (a === 'bulk') return bulkEditSelected();
      if (a === 'clearsel') { selected.clear(); return drawResults(); }
      if (a === 'copyids') return call('copy', { text: [...selected].map((r) => r.Id).join('\n') });
      if (a === 'showall') return R().open(one.Id, { ...recOpts(), object: resObj });
      if (a === 'clone') return R().open(one.Id, { ...recOpts(), object: resObj }).then(() => document.querySelector('.rp [data-clone]') && document.querySelector('.rp [data-clone]').click());
      return;
    }
    if (e.target.id === 'selAll') { shownRows.forEach((r) => (e.target.checked ? selected.add(r) : selected.delete(r))); return drawResults(); }
    const sel = e.target.closest('[data-sel]');
    if (sel) { const r = shownRows[+sel.dataset.sel]; sel.checked ? selected.add(r) : selected.delete(r); return drawResults(); }
    const show = e.target.closest('[data-show]');
    if (show) {
      if (e.ctrlKey || e.metaKey) { call('openRecord', { id: show.dataset.show }).catch((err) => toast(err.message, 'error')); return toast('Opening record in Salesforce…'); }
      return R().open(show.dataset.show, recOpts());
    }
    const rn = e.target.closest('td.rn[data-row]');
    if (rn) { const r = shownRows[+rn.dataset.row]; if (r.Id) R().open(r.Id, { ...recOpts(), object: resObj || r.__type }); else showRecord(r); return; }
    const td = e.target.closest('td[data-v], td.null');
    if (td && !e.target.closest('a, button')) {
      if (selCell) selCell.classList.remove('cell-sel');
      selCell = td;
      td.classList.add('cell-sel');
    }
    const th = e.target.closest('th[data-k]');
    if (th && th._justResized) return;
    if (th) { sort = sort && sort.k === th.dataset.k ? { k: th.dataset.k, dir: -sort.dir } : { k: th.dataset.k, dir: 1 }; drawResults(); return; }
    const a = e.target.closest('.rid');
    if (a) { call('openRecord', { id: a.dataset.id }).catch((err) => toast(err.message, 'error')); toast('Opening record in Salesforce…'); return; }
    const sb = e.target.closest(".subq");
    if (sb) { showSub(sb.dataset.col, JSON.parse(sb.dataset.sub)); return; }
    if (e.target.closest('[data-more-rows]')) { shownN += 500; drawResults(); }
  }
  function showSub(title, recs) {
    const r = recs.map((x) => flatten(x));
    const c = columnsOf(r);
    const dlg = document.createElement('div');
    dlg.className = 'modal-bg';
    dlg.innerHTML = `<div class="modal wide"><h3>${esc(title)} <span class="muted">(${recs.length})</span></h3><div class="modal-scroll"><table class="dgrid compact"><thead><tr>${c.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${r.map((x) => `<tr>${c.map((k) => cell(x[k], k)).join('')}</tr>`).join('')}</tbody></table></div><div class="modal-acts"><button class="btn" data-x>Close</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.onclick = (e) => {
      if (e.target === dlg || e.target.closest('[data-x]')) return dlg.remove();
      const a = e.target.closest('.rid');
      if (a) { dlg.remove(); R().open(a.dataset.show || a.dataset.id, recOpts()); }
    };
  }
  function strip(r) {
    if (Array.isArray(r)) return r.map(strip);
    if (!r || typeof r !== 'object') return r;
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      if (k === 'attributes') continue;
      o[k] = v && typeof v === 'object' && Array.isArray(v.records) ? v.records.map(strip) : strip(v);
    }
    return o;
  }
  function toDelimited(list, d) {
    const q = (s) => {
      const t = cellText(s);
      return d === ',' ? (/[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t) : t.replace(/[\t\r\n]+/g, ' ');
    };
    return [cols.join(d), ...list.map((r) => cols.map((c) => q(r[c])).join(d))].join('\r\n');
  }
  const objName = () => (/\bFROM\s+(\w+)/i.exec($('#q').value) || [0, 'query'])[1];
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

  window.SFLS.onState((s) => {
    if (el && s.org && !objects.length && $('#objList')) loadObjects();
  });
})();

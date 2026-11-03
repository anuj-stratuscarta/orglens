// OrgLens — REST Explorer
(() => {
  'use strict';
  const { call, esc, I, toast } = window.SFLS;
  const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'];
  const QUICK = [
    ['Basics', [
      ['GET', '/', 'Resources available in this API version'],
      ['GET', '/services/data', 'Supported API versions'],
      ['GET', '/limits', 'Org limits'],
      ['GET', '/sobjects', 'All objects (describeGlobal)'],
      ['GET', '/sobjects/Account/describe', 'Describe an object'],
      ['GET', '/chatter/users/me', 'Current user'],
    ]],
    ['Query & records', [
      ['GET', '/query?q=SELECT+Id,Name+FROM+Account+ORDER+BY+CreatedDate+DESC+LIMIT+5', 'SOQL query'],
      ['GET', '/search?q=FIND+%7BUmbrella%7D+IN+NAME+FIELDS+RETURNING+Account(Id,Name)', 'SOSL search'],
      ['GET', '/sobjects/Account/{id}', 'Get a record by Id'],
      ['POST', '/sobjects/Account', 'Create a record', '{\n  "Name": "REST Explorer test"\n}'],
      ['PATCH', '/sobjects/Account/{id}', 'Update a record', '{\n  "Description": "Updated from OrgLens"\n}'],
      ['DELETE', '/sobjects/Account/{id}', 'Delete a record'],
    ]],
    ['Composite', [
      ['POST', '/composite', 'Composite request', '{\n  "allOrNone": false,\n  "compositeRequest": [\n    {\n      "method": "GET",\n      "url": "/services/data/v{v}/query?q=SELECT+Id,Name+FROM+Account+LIMIT+1",\n      "referenceId": "acct"\n    },\n    {\n      "method": "GET",\n      "url": "/services/data/v{v}/sobjects/Account/@{acct.records[0].Id}",\n      "referenceId": "acctDetail"\n    }\n  ]\n}'],
      ['GET', '/composite/sobjects/Account?ids={id}&fields=Id,Name', 'Get records by Ids'],
    ]],
    ['Tooling & Apex', [
      ['GET', '/tooling/query?q=SELECT+Id,Name,ApiVersion+FROM+ApexClass+ORDER+BY+Name+LIMIT+20', 'Tooling query: Apex classes'],
      ['GET', '/tooling/executeAnonymous?anonymousBody=System.debug(UserInfo.getUserName());', 'Execute anonymous (Tooling)'],
      ['GET', '/tooling/sobjects/TraceFlag', 'Trace flag metadata'],
      ['GET', '/services/apexrest/', 'Custom Apex REST (add your path)'],
    ]],
    ['Connect / Revenue Cloud', [
      ['GET', '/connect', 'Connect API root'],
      ['GET', '/actions/standard', 'Standard invocable actions'],
      ['GET', '/actions/custom', 'Custom invocable actions'],
      ['GET', '/connect/communities', 'Experience Cloud sites'],
    ]],
  ];

  let el, $;
  let ctx = { apiVersion: '62.0', instanceUrl: '' };
  let method = 'GET', path = '/limits', body = '', headers = [['', '']];
  let resp = null, view = 'pretty', jsonData = undefined, jsonErr = null, treeQ = '';
  let sending = false;

  window.SFLS.pages.rest = {
    async build(root) {
      el = root;
      $ = (s) => el.querySelector(s);
      try { Object.assign(ctx, await call('restContext')); } catch { /* offline */ }
      const st = loadState();
      if (st) ({ method = method, path = path, body = body, headers = headers } = st);
      el.innerHTML = `<div class="rx">
        <aside class="rx-side">
          <div class="rx-side-h"><b>Quick start</b><span class="muted small">click to load</span></div>
          <div class="rx-quick">${QUICK.map(([g, items]) => `<div class="rx-g">${esc(g)}</div>${items.map((q, i) => `<div class="rx-q" data-g="${esc(g)}" data-i="${i}" title="${esc(q[2])}"><span class="mth m-${q[0]}">${q[0]}</span><span class="rx-qp">${esc(q[1].replace(/\?.*/, '?…'))}</span></div>`).join('')}`).join('')}</div>
          <div class="rx-side-h"><b>History & saved</b></div>
          <div class="rx-side-acts"><button class="btn sm" id="rxHist">${I.clock} History</button><button class="btn sm" id="rxSaved">${I.star} Saved</button></div>
        </aside>
        <section class="rx-main">
          <div class="rx-req">
            <div class="rx-line">
              <select id="rxM">${METHODS.map((m) => `<option ${m === method ? 'selected' : ''}>${m}</option>`).join('')}</select>
              <input id="rxP" list="rxPaths" spellcheck="false" placeholder="/limits  ·  /sobjects/Account/describe  ·  /services/apexrest/…" value="${esc(path)}">
              <datalist id="rxPaths"></datalist>
              <button class="btn primary" id="rxSend">${I.play} Send <span class="kbd">Ctrl+Enter</span></button>
            </div>
            <div class="rx-url muted small mono" id="rxUrl"></div>
            <div class="rx-tabs"><button data-rt="body" class="on">Body</button><button data-rt="headers">Headers <span class="count" id="rxHc"></span></button>
              <span style="flex:1"></span>
              <button class="btn sm" id="rxFmt" title="Pretty-print the JSON body">${I.code} Format</button>
              <button class="btn sm" id="rxCurl" title="Copy this request as a cURL command">${I.copy} cURL</button>
              <button class="btn sm" id="rxSave">${I.star} Save…</button></div>
            <div class="rx-bodywrap" id="rxBodyWrap"><textarea id="rxB" spellcheck="false" placeholder='Request body (JSON) — used for POST / PATCH / PUT'>${esc(body)}</textarea><div class="rx-bstat small" id="rxBs"></div></div>
            <div class="rx-hwrap" id="rxHWrap" hidden></div>
          </div>
          <div class="rx-res">
            <div class="rx-res-bar" id="rxBar"><span class="muted">Send a request to see the response.</span></div>
            <div class="rx-res-body" id="rxRes"><div class="empty">${I.ext}<div>Pick a quick-start request on the left or type a path, then press <span class="kbd">Ctrl+Enter</span>.<br><span class="muted">Relative paths are resolved against <b>/services/data/v${esc(ctx.apiVersion)}</b>; paths starting with <b>/services/</b> are used as-is. <b>{id}</b> placeholders must be replaced before sending.</span></div></div></div>
          </div>
        </section></div>`;
      bind();
      drawHeaders();
      updateUrl();
      validateBody();
      loadPathHints();
    },
  };

  function loadState() { try { return JSON.parse(localStorage.getItem('sfls.rest') || 'null'); } catch { return null; } }
  function saveState() { try { localStorage.setItem('sfls.rest', JSON.stringify({ method, path, body, headers })); } catch { /* ignore */ } }

  function resolved() {
    let p = path.trim();
    if (!p) return '';
    if (/^https?:/i.test(p)) return p;
    if (!p.startsWith('/')) p = '/' + p;
    return p.startsWith('/services') ? ctx.instanceUrl + p : `${ctx.instanceUrl}/services/data/v${ctx.apiVersion}${p}`;
  }
  function updateUrl() { $('#rxUrl').textContent = resolved() ? '→ ' + resolved() : ''; }
  function hdrObj() { const o = {}; headers.forEach(([k, v]) => { if (k.trim()) o[k.trim()] = v; }); return o; }

  function bind() {
    $('#rxM').onchange = (e) => { method = e.target.value; saveState(); validateBody(); };
    $('#rxP').oninput = (e) => { path = e.target.value; updateUrl(); saveState(); };
    $('#rxB').oninput = (e) => { body = e.target.value; saveState(); validateBody(); };
    $('#rxB').addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); body = t.value; }
    });
    el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); } });
    $('#rxSend').onclick = send;
    $('#rxFmt').onclick = () => {
      try { body = JSON.stringify(JSON.parse(body), null, 2); $('#rxB').value = body; saveState(); validateBody(); } catch (err) { toast('Body is not valid JSON: ' + err.message, 'error'); }
    };
    $('#rxCurl').onclick = () => {
      const h = { Authorization: 'Bearer $SF_ACCESS_TOKEN', Accept: 'application/json', ...hdrObj() };
      if (body && !['GET', 'HEAD'].includes(method)) h['Content-Type'] = h['Content-Type'] || 'application/json';
      const parts = [`curl -X ${method} '${resolved()}'`, ...Object.entries(h).map(([k, v]) => `  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`)];
      if (body && !['GET', 'HEAD'].includes(method)) parts.push(`  --data '${body.replace(/'/g, "'\\''")}'`);
      call('copy', { text: parts.join(' \\\n') + '\n# export SF_ACCESS_TOKEN=$(sf org auth show-access-token -p --json | jq -r .result.accessToken)' });
    };
    $('#rxSave').onclick = saveRequest;
    $('#rxHist').onclick = () => pickFrom('restHistory');
    $('#rxSaved').onclick = () => pickFrom('restSaved');
    el.querySelector('.rx-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rt]');
      if (!b) return;
      el.querySelectorAll('.rx-tabs [data-rt]').forEach((x) => x.classList.toggle('on', x === b));
      $('#rxBodyWrap').hidden = b.dataset.rt !== 'body';
      $('#rxHWrap').hidden = b.dataset.rt !== 'headers';
    });
    $('.rx-quick').onclick = (e) => {
      const q = e.target.closest('[data-g]');
      if (!q) return;
      const item = QUICK.find(([g]) => g === q.dataset.g)[1][+q.dataset.i];
      load({ method: item[0], path: item[1], body: (item[3] || '').replace(/\{v\}/g, ctx.apiVersion) });
      if (!/\{id\}/.test(item[1])) send();
      else { const p = $('#rxP'); p.focus(); const i = p.value.indexOf('{id}'); p.setSelectionRange(i, i + 4); toast('Replace {id} with a record Id, then send'); }
    };
    $('#rxRes').addEventListener('click', resClick);
  }

  function load(r) {
    method = r.method || 'GET'; path = r.path || ''; body = r.body || '';
    if (r.headers) headers = Object.entries(r.headers).length ? Object.entries(r.headers) : [['', '']];
    $('#rxM').value = method; $('#rxP').value = path; $('#rxB').value = body;
    drawHeaders(); updateUrl(); validateBody(); saveState();
  }

  function validateBody() {
    const s = $('#rxBs');
    if (!body.trim()) { s.textContent = ['GET', 'HEAD', 'DELETE'].includes(method) ? '' : 'No body'; s.className = 'rx-bstat small muted'; return; }
    try { JSON.parse(body); s.textContent = '✓ Valid JSON'; s.className = 'rx-bstat small ok'; } catch (e) { s.textContent = '✗ ' + e.message; s.className = 'rx-bstat small bad'; }
    if (['GET', 'HEAD'].includes(method)) { s.textContent += ' · ignored for ' + method; }
  }

  function drawHeaders() {
    const n = headers.filter(([k]) => k.trim()).length;
    $('#rxHc').textContent = n || '';
    $('#rxHWrap').innerHTML = `<div class="muted small" style="margin-bottom:6px">Authorization and Accept are added automatically.</div>${headers.map(([k, v], i) => `<div class="rx-h"><input data-hk="${i}" placeholder="Header" value="${esc(k)}"><input data-hv="${i}" placeholder="Value" value="${esc(v)}"><button class="btn sm" data-hd="${i}" title="Remove">${I.trash}</button></div>`).join('')}
      <button class="btn sm" id="rxHAdd">${I.plus} Add header</button>
      <span class="muted small">Common: <a href="#" data-hp="Sforce-Query-Options|batchSize=200">Sforce-Query-Options</a> · <a href="#" data-hp="Sforce-Call-Options|client=SFLogStudio">Sforce-Call-Options</a> · <a href="#" data-hp="If-Modified-Since|">If-Modified-Since</a></span>`;
    const w = $('#rxHWrap');
    w.oninput = (e) => {
      const k = e.target.dataset.hk, v = e.target.dataset.hv;
      if (k != null) headers[+k][0] = e.target.value;
      if (v != null) headers[+v][1] = e.target.value;
      $('#rxHc').textContent = headers.filter(([x]) => x.trim()).length || '';
      saveState();
    };
    w.onclick = (e) => {
      const d = e.target.closest('[data-hd]');
      if (d) { headers.splice(+d.dataset.hd, 1); if (!headers.length) headers.push(['', '']); drawHeaders(); saveState(); return; }
      if (e.target.closest('#rxHAdd')) { headers.push(['', '']); drawHeaders(); return; }
      const hp = e.target.closest('[data-hp]');
      if (hp) { e.preventDefault(); const [k, v] = hp.dataset.hp.split('|'); const empty = headers.findIndex(([x]) => !x.trim()); if (empty >= 0) headers[empty] = [k, v]; else headers.push([k, v]); drawHeaders(); saveState(); }
    };
  }

  async function loadPathHints() {
    try {
      const objs = await call('describeGlobal', { tooling: false });
      const top = ['Account', 'Contact', 'Opportunity', 'Order', 'Quote', 'Product2', 'Asset', 'Case', 'Lead', 'User'];
      const names = [...top.filter((n) => objs.some((o) => o.name === n)), ...objs.map((o) => o.name).filter((n) => !top.includes(n))].slice(0, 400);
      $('#rxPaths').innerHTML = ['/limits', '/sobjects', '/query?q=', '/tooling/query?q=', '/composite', '/services/apexrest/', '/connect', '/actions/standard']
        .concat(names.flatMap((n) => [`/sobjects/${n}/describe`, `/sobjects/${n}/`]))
        .map((p) => `<option value="${esc(p)}">`).join('');
    } catch { /* hints are optional */ }
  }

  async function send() {
    if (sending) return;
    if (/\{id\}/.test(path)) { toast('Replace {id} in the path first', 'error'); return; }
    if (body.trim() && !['GET', 'HEAD'].includes(method)) {
      try { JSON.parse(body); } catch (e) { if (!/xml|text/i.test(JSON.stringify(hdrObj()))) { toast('Body is not valid JSON: ' + e.message, 'error'); return; } }
    }
    if (['DELETE'].includes(method) && !(await call('confirm', { message: `Send DELETE ${path}?`, action: 'Send' }))) return;
    sending = true;
    $('#rxSend').disabled = true;
    $('#rxBar').innerHTML = `<span class="muted"><span class="spinner sm"></span> ${esc(method)} ${esc(resolved())}</span>`;
    try {
      resp = await call('restCall', { method, path, headers: hdrObj(), body: ['GET', 'HEAD'].includes(method) ? '' : body });
      jsonErr = null; jsonData = undefined;
      if (resp.body) { try { jsonData = JSON.parse(resp.body); } catch (e) { jsonErr = e.message; } }
      view = jsonData !== undefined ? view === 'headers' ? 'pretty' : view : 'raw';
      treeQ = '';
      drawResponse();
    } catch (e) {
      resp = null;
      $('#rxBar').innerHTML = '';
      $('#rxRes').innerHTML = `<div class="q-err"><b>Request failed</b><pre>${esc(e.message)}</pre></div>`;
    }
    sending = false;
    $('#rxSend').disabled = false;
  }

  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(2) + ' MB' : b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B');
  function drawResponse() {
    const s = resp.status;
    const cls = s >= 500 ? 'err' : s >= 400 ? 'warn' : s >= 300 ? 'info' : 'ok';
    $('#rxBar').innerHTML = `<span class="st-badge ${cls}">${s} ${esc(resp.statusText || '')}</span>
      <span class="muted small">${resp.ms} ms · ${fmtSize(resp.size)}${resp.truncated ? ' · truncated to 8 MB' : ''}</span>
      <div class="seg rx-views">${[['pretty', 'Pretty'], ['raw', 'Raw'], ['headers', `Headers (${Object.keys(resp.headers).length})`]].map(([k, l]) => `<button data-v="${k}" class="${view === k ? 'on' : ''}" ${k === 'pretty' && jsonData === undefined ? 'disabled title="Response is not JSON"' : ''}>${l}</button>`).join('')}</div>
      <span style="flex:1"></span>
      ${view === 'pretty' ? `<input class="search rx-tq" id="rxTq" placeholder="Search keys & values…" value="${esc(treeQ)}"><button class="btn sm" data-a="exp">Expand all</button><button class="btn sm" data-a="col">Collapse all</button>` : ''}
      <button class="btn sm" data-a="copy">${I.copy} Copy</button><button class="btn sm" data-a="save">${I.download} Save</button>`;
    const bar = $('#rxBar');
    bar.onclick = (e) => {
      const v = e.target.closest('[data-v]');
      if (v && !v.disabled) { view = v.dataset.v; drawResponse(); return; }
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'exp') expandAll(true);
      if (a.dataset.a === 'col') expandAll(false);
      if (a.dataset.a === 'copy') call('copy', { text: view === 'headers' ? JSON.stringify(resp.headers, null, 2) : jsonData !== undefined && view === 'pretty' ? JSON.stringify(jsonData, null, 2) : resp.body });
      if (a.dataset.a === 'save') call('saveFile', { name: `response-${Date.now()}.${jsonData !== undefined ? 'json' : 'txt'}`, content: jsonData !== undefined ? JSON.stringify(jsonData, null, 2) : resp.body });
    };
    const tq = $('#rxTq');
    if (tq) {
      let t;
      tq.oninput = (e) => { clearTimeout(t); t = setTimeout(() => { treeQ = e.target.value.trim().toLowerCase(); renderTree(); const n = $('#rxTq'); if (n) { n.focus(); } }, 200); };
    }
    const host = $('#rxRes');
    if (view === 'headers') {
      host.innerHTML = `<table class="dgrid compact rx-ht"><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody>${Object.entries(resp.headers).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('')}</tbody></table>
        <div class="muted small pad-s">Request: <span class="mono">${esc(method)} ${esc(resp.url)}</span></div>`;
    } else if (view === 'raw') {
      host.innerHTML = resp.body ? `<pre class="rx-raw">${esc(resp.body.length > 2e6 ? resp.body.slice(0, 2e6) + '\n… (showing first 2 MB — use Save for the full response)' : resp.body)}</pre>` : `<div class="empty">Empty response body${resp.status === 204 ? ' (204 No Content)' : ''}.</div>`;
    } else renderTree();
  }

  // ---------- JSON tree ----------
  const AUTO_DEPTH = 2;
  function renderTree() {
    const host = $('#rxRes');
    if (jsonData === undefined) { host.innerHTML = `<div class="empty">Not JSON${jsonErr ? ': ' + esc(jsonErr) : ''}.</div>`; return; }
    const matches = treeQ ? matchPaths(jsonData, treeQ) : null;
    host.innerHTML = `<div class="jt" id="jt">${node(null, jsonData, '', 0, matches, true)}</div>${matches ? `<div class="muted small pad-s">${matches.hits} match${matches.hits === 1 ? '' : 'es'}</div>` : ''}`;
  }
  function matchPaths(v, q) {
    const keep = new Set();
    let hits = 0;
    (function walk(x, p) {
      let found = false;
      if (x && typeof x === 'object') {
        for (const [k, c] of Object.entries(x)) {
          const cp = Array.isArray(x) ? `${p}[${k}]` : p ? `${p}.${k}` : k;
          const self = String(k).toLowerCase().includes(q) || (c === null || typeof c !== 'object' ? String(c).toLowerCase().includes(q) : false);
          if (self) hits++;
          if (walk(c, cp) || self) { keep.add(cp); found = true; }
        }
      }
      return found;
    })(v, '');
    return { keep, hits };
  }
  const isLink = (s) => typeof s === 'string' && /^\/services\/(data|apexrest)\//.test(s);
  // A Salesforce Id: 15/18 alphanumerics with digits and letters, in a field named Id / …Id / custom lookup.
  const isId = (s, key) =>
    typeof s === 'string' && /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(s) && /\d/.test(s) && /[a-zA-Z]/.test(s) && (key == null || /(^id$|Id$|__c$)/i.test(String(key)));
  function prim(v, key) {
    if (v === null) return '<span class="jv-null">null</span>';
    if (typeof v === 'boolean') return `<span class="jv-bool">${v}</span>`;
    if (typeof v === 'number') return `<span class="jv-num">${v}</span>`;
    const s = esc(v);
    if (isLink(v)) return `<span class="jv-str">"<a class="jlink" data-get="${s}" title="GET this URL">${s}</a>"</span>`;
    if (isId(v, key)) return `<span class="jv-str">"<a class="jid" data-id="${s}" title="Open in Salesforce">${s}</a>"</span>`;
    return `<span class="jv-str">"${hl(s)}"</span>`;
  }
  const hl = (s) => (treeQ ? s.replace(new RegExp(treeQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`) : s);
  function node(key, v, p, depth, matches, last) {
    const comma = last ? '' : '<span class="jp">,</span>';
    const k = key === null ? '' : `<span class="jk" data-path="${esc(p)}" title="Click to copy path: ${esc(p)}">${typeof key === 'number' ? `<span class="ji">${key}</span>` : `"${hl(esc(key))}"`}</span><span class="jp">: </span>`;
    if (v === null || typeof v !== 'object') return `<div class="jr">${k}${prim(v, key)}${comma}</div>`;
    const arr = Array.isArray(v);
    const entries = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
    const open = arr ? '[' : '{', close = arr ? ']' : '}';
    if (!entries.length) return `<div class="jr">${k}<span class="jp">${open}${close}</span>${comma}</div>`;
    const expanded = matches ? matches.keep.has(p) || p === '' : depth < AUTO_DEPTH && entries.length <= 200;
    const summary = arr ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : `${entries.length} key${entries.length === 1 ? '' : 's'}`;
    const typeHint = !arr && v.attributes && v.attributes.type ? ` <span class="jt-type">${esc(v.attributes.type)}</span>` : '';
    const kids = expanded ? children(entries, p, depth, matches, arr) : '';
    return `<div class="jn ${expanded ? 'open' : ''}" data-p="${esc(p)}" data-d="${depth}"><div class="jr jh"><span class="jtg">▸</span>${k}<span class="jp">${open}</span><span class="jsum">${summary}${typeHint}</span><span class="jp jclose-inline">${close}${comma}</span></div><div class="jc">${kids}</div><div class="jr jend"><span class="jp">${close}</span>${comma}</div></div>`;
  }
  function children(entries, p, depth, matches, arr) {
    const MAX = 500;
    const list = entries.slice(0, MAX);
    let html = list.map(([ck, cv], i) => node(arr ? ck : ck, cv, arr ? `${p}[${ck}]` : p ? `${p}.${ck}` : String(ck), depth + 1, matches, i === entries.length - 1)).join('');
    if (entries.length > MAX) html += `<div class="jr muted small">… ${entries.length - MAX} more (use Raw or Save to see everything)</div>`;
    return html;
  }
  function valueAt(p) {
    if (!p) return jsonData;
    const parts = p.match(/[^.[\]]+|\[\d+\]/g) || [];
    let v = jsonData;
    for (const part of parts) v = v == null ? undefined : part.startsWith('[') ? v[+part.slice(1, -1)] : v[part];
    return v;
  }
  function toggle(n, force) {
    const open = force != null ? force : !n.classList.contains('open');
    if (open && !n.querySelector(':scope > .jc').children.length) {
      const p = n.dataset.p;
      const v = valueAt(p);
      const arr = Array.isArray(v);
      const entries = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
      n.querySelector(':scope > .jc').innerHTML = children(entries, p, +n.dataset.d, null, arr);
    }
    n.classList.toggle('open', open);
  }
  function expandAll(open) {
    const host = $('#jt');
    if (!host) return;
    if (!open) { host.querySelectorAll('.jn').forEach((n) => n.classList.remove('open')); const r = host.querySelector('.jn'); if (r) r.classList.add('open'); return; }
    let budget = 4000, frontier = [...host.querySelectorAll('.jn')];
    while (frontier.length && budget > 0) {
      const n = frontier.shift();
      if (!n.classList.contains('open')) toggle(n, true);
      budget--;
      frontier.push(...n.querySelectorAll(':scope > .jc > .jn'));
    }
    if (budget <= 0) toast('Expanded the first 4,000 nodes — use Raw for the rest');
  }
  function resClick(e) {
    const g = e.target.closest('.jlink');
    if (g) { load({ method: 'GET', path: g.dataset.get, body: '' }); send(); return; }
    const id = e.target.closest('.jid');
    if (id) { call('openRecord', { id: id.dataset.id }).catch((err) => toast(err.message, 'error')); toast('Opening record in Salesforce…'); return; }
    const k = e.target.closest('.jk');
    if (k && !e.target.closest('.jh')) { call('copy', { text: k.dataset.path }); return; }
    const h = e.target.closest('.jh');
    if (h) {
      if (e.target.closest('.jk') && e.altKey) { call('copy', { text: h.querySelector('.jk').dataset.path }); return; }
      toggle(h.parentElement);
      return;
    }
    const v = e.target.closest('.jv-str, .jv-num, .jv-bool, .jv-null');
    if (v && e.detail === 2) call('copy', { text: v.textContent.replace(/^"|"$/g, '') });
  }

  // ---------- history / saved ----------
  async function pickFrom(op) {
    const list = await call(op);
    if (!list.length) return toast(op === 'restHistory' ? 'No requests sent yet' : 'No saved requests yet');
    const p = await call('pickItems', {
      title: op === 'restHistory' ? 'Request history' : 'Saved requests',
      items: list.map((h, i) => ({ label: `${h.name ? h.name + ' — ' : ''}${h.method} ${h.path}`.slice(0, 160), description: [h.status ? 'HTTP ' + h.status : '', h.org || '', h.at ? new Date(h.at).toLocaleString() : ''].filter(Boolean).join(' · '), i })),
    });
    if (p) load(list[p.i]);
  }
  function saveRequest() {
    const dlg = document.createElement('div');
    dlg.className = 'modal-bg';
    dlg.innerHTML = `<div class="modal"><h3>Save request</h3><div class="muted small mono" style="margin-bottom:10px">${esc(method)} ${esc(path)}</div><label class="fld">Name<input id="rxSn" placeholder="e.g. Create order – happy path"></label><div class="modal-acts"><button class="btn" data-x>Cancel</button><button class="btn primary" data-s>Save</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#rxSn').focus();
    dlg.onclick = async (e) => {
      if (e.target === dlg || e.target.closest('[data-x]')) return dlg.remove();
      if (e.target.closest('[data-s]')) {
        const name = dlg.querySelector('#rxSn').value.trim();
        if (!name) return;
        await call('restSave', { item: { name, method, path, body, headers: hdrObj() } });
        toast('Request saved', 'ok');
        dlg.remove();
      }
    };
  }
})();

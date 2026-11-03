'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Connection, listOrgs, defaultOrg, runSf } = require('./src/sf');
const { LogTreeProvider } = require('./src/logTree');
const { showAnalyzer } = require('./src/analyzer');
const trace = require('./src/traceFlags');
const lang = require('./src/languageFeatures');
const { openStudio, pushStudio } = require('./src/studio');
const xml = require('./src/xml');

/** @type {Connection|null} */
let conn = null;
let tailTimer = null;
let traceExp = null;
let traceStart = null;
let connecting = null;
let output = null;
const log = (m) => { if (output) output.appendLine(`[${new Date().toLocaleTimeString()}] ${m}`); };
let traceLevel = null;
let traceTick = null;
const describeCache = new Map();
const pulseCache = new Map();
const filter = { mineOnly: false, errorsOnly: false, text: '', operation: null, userName: null, minDuration: 0 };

const cfg = () => vscode.workspace.getConfiguration('orglens');
const cwd = () => (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath) || os.homedir();
const setCtx = (k, v) => vscode.commands.executeCommand('setContext', 'orglens.' + k, v);

function activate(ctx) {
  const provider = new LogTreeProvider({ conn: () => conn, filter });
  const view = vscode.window.createTreeView('orglens.logs', { treeDataProvider: provider, canSelectMany: true, showCollapseAll: false });
  ctx.subscriptions.push(view);
  output = vscode.window.createOutputChannel('OrgLens');
  ctx.subscriptions.push(output);
  lang.register(ctx);
  provider.onDidChangeTreeData(() => pushStudio());

  const sbOrg = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  sbOrg.command = 'orglens.selectOrg';
  const sbTrace = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  sbTrace.command = 'orglens.traceMenu';
  ctx.subscriptions.push(sbOrg, sbTrace);

  const cacheDir = () => {
    const d = path.join(ctx.globalStorageUri.fsPath, 'logs', (conn && conn.orgId) || 'local');
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  // ---------- org connection ----------
  async function connect(target, quiet) {
    stopTail();
    provider.reset();
    conn = null;
    updateStatus();
    if (!target) {
      setCtx('connected', false);
      return;
    }
    connecting = target;
    setCtx('connecting', true);
    sbOrg.text = `$(sync~spin) ${target}`;
    sbOrg.show();
    pushStudio(true);
    const t0 = Date.now();
    try {
      // Cached session (token lives in VS Code's encrypted SecretStorage) → no sf CLI spawn on warm starts.
      const secretKey = `sfls.session.${target}`;
      let cache = null;
      try { cache = JSON.parse((await ctx.secrets.get(secretKey)) || 'null'); } catch { cache = null; }
      const c = new Connection(target, cwd());
      const save = () =>
        ctx.secrets.store(secretKey, JSON.stringify({ accessToken: c.accessToken, userId: c.userId, userName: c.userName, username: c.username })).then(undefined, () => {});
      c.onToken = (tok) => { c.accessToken = tok; if (c.userId) save(); };
      await c.init(cache);
      if (cache && cache.username && cache.username !== c.username) {
        // Org was re-authorized as someone else: drop the stale session.
        c.userId = null;
        c.accessToken = await c.freshToken(null);
        await c.init({ accessToken: c.accessToken });
      }
      save();
      conn = c;
      await ctx.workspaceState.update('org', target);
      setCtx('connected', true);
      view.title = 'Debug Logs';
      view.description = conn.alias;
      connecting = null;
      setCtx('connecting', false);
      updateStatus();
      // Logs + trace status in parallel.
      await Promise.all([provider.refresh(), refreshTraceStatus()]);
      if (cfg().get('tail.autoStart')) startTail();
      log(`Connected to ${target} in ${Date.now() - t0} ms${cache ? ' (cached session)' : ''}`);
    } catch (e) {
      conn = null;
      setCtx('connected', false);
      log(`Connect to ${target} failed: ${e.message}`);
      if (!quiet) vscode.window.showErrorMessage(`OrgLens: could not connect to "${target}": ${e.message}`);
    }
    connecting = null;
    setCtx('connecting', false);
    updateStatus();
  }

  function updateStatus() {
    pushStudio();
    if (!conn) {
      sbOrg.text = '$(cloud) No org';
      sbOrg.tooltip = 'OrgLens — select an org';
      sbOrg.show();
      sbTrace.hide();
      return;
    }
    sbOrg.text = `$(cloud) ${conn.alias}`;
    sbOrg.tooltip = `OrgLens\n${conn.username}\n${conn.instanceUrl}\nClick to switch org`;
    sbOrg.show();
    const live = tailTimer ? '$(radio-tower) ' : '';
    if (traceExp && traceExp > Date.now()) {
      const mins = Math.max(1, Math.round((traceExp - Date.now()) / 60000));
      sbTrace.text = `${live}$(record) Tracing ${mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm'}`;
      sbTrace.backgroundColor = undefined;
      sbTrace.tooltip = `Debug logging active for you until ${traceExp.toLocaleTimeString()}${tailTimer ? '\nLive tail ON' : ''}\nClick for options`;
    } else {
      sbTrace.text = `${live}$(circle-outline) Not tracing`;
      sbTrace.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      sbTrace.tooltip = 'No active trace flag for you — logs will not be generated. Click to start.';
    }
    setCtx('tracing', !!(traceExp && traceExp > Date.now()));
    sbTrace.show();
  }

  async function refreshTraceStatus() {
    if (!conn) return;
    try {
      const tf = await trace.activeTraceFlag(conn, conn.userId);
      traceExp = tf ? new Date(tf.ExpirationDate) : null;
      traceStart = tf ? +new Date(tf.StartDate) : null;
      traceLevel = tf && tf.DebugLevel ? tf.DebugLevel.DeveloperName : null;
    } catch {
      traceExp = null;
    }
    updateStatus();
    clearInterval(traceTick);
    traceTick = setInterval(async () => {
      if (traceExp && cfg().get('trace.autoExtend') && tailTimer && traceExp - Date.now() < 3 * 60000) {
        try {
          traceExp = await trace.startTrace(conn, { userId: conn.userId, minutes: 30, preset: cfg().get('trace.defaultPreset') });
        } catch { /* ignore */ }
      }
      updateStatus();
    }, 30000);
  }

  // ---------- tail ----------
  function startTail() {
    if (!conn || tailTimer) return;
    const ms = Math.max(2, cfg().get('tail.intervalSeconds')) * 1000;
    tailTimer = setInterval(async () => {
      const fresh = await provider.refresh();
      if (fresh.length) onNewLogs(fresh);
    }, ms);
    setCtx('tailing', true);
    view.message = '● Live — watching for new logs';
    updateStatus();
    if (!traceExp || traceExp < Date.now()) {
      vscode.window.showWarningMessage('Live tail is on, but you have no active trace flag, so no new logs will appear.', 'Start tracing').then((a) => a && vscode.commands.executeCommand('orglens.startTrace'));
    }
  }
  function stopTail() {
    clearInterval(tailTimer);
    tailTimer = null;
    setCtx('tailing', false);
    view.message = undefined;
    updateStatus();
  }
  function onNewLogs(fresh) {
    view.badge = { value: provider.newIds.size, tooltip: `${provider.newIds.size} new log(s)` };
    const mode = cfg().get('tail.onNewLog');
    const newest = fresh[0];
    if (mode === 'analyze') openLog(newest, 'analyze');
    else if (mode === 'raw') openLog(newest, 'raw');
    else if (mode === 'notify') {
      const failed = fresh.find((l) => l.Status !== 'Success');
      const msg = `${fresh.length} new log${fresh.length > 1 ? 's' : ''}: ${newest.Operation}${failed ? ' — ⚠ ' + failed.Status : ''}`;
      (failed ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(msg, 'Analyze', 'Open raw').then((a) => a && openLog(newest, a === 'Analyze' ? 'analyze' : 'raw'));
    }
  }

  // ---------- log access ----------
  async function getLogFile(log) {
    const file = path.join(cacheDir(), `${log.Id}.log`);
    if (fs.existsSync(file)) return file;
    const body = await vscode.window.withProgress(
      { location: { viewId: 'orglens.logs' }, title: 'Downloading log…' },
      () => conn.getLogBody(log.Id)
    );
    fs.writeFileSync(file, body);
    return file;
  }

  async function openLog(log, mode) {
    try {
      provider.markSeen(log.Id);
      view.badge = provider.newIds.size ? { value: provider.newIds.size, tooltip: 'new logs' } : undefined;
      const file = await getLogFile(log);
      const uri = vscode.Uri.file(file);
      if (mode === 'raw') {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(doc, 'apexlog');
        await vscode.window.showTextDocument(doc, { preview: true });
        return;
      }
      const text = fs.readFileSync(file, 'utf8');
      showAnalyzer(ctx, {
        key: log.Id,
        title: `${log.Operation.length > 30 ? '…' + log.Operation.slice(-28) : log.Operation} · ${new Date(log.StartTime).toLocaleTimeString()}`,
        text,
        uri,
        getConn: () => conn,
        meta: {
          id: log.Id,
          operation: log.Operation,
          user: log.LogUser && log.LogUser.Name,
          status: log.Status,
          startTime: log.StartTime,
          request: log.Request,
        },
      });
    } catch (e) {
      vscode.window.showErrorMessage('Could not open log: ' + e.message);
    }
  }

  const itemsOf = (item, selected) => {
    const list = selected && selected.length ? selected : item ? [item] : view.selection;
    return list.filter((x) => x && x.log).map((x) => x.log);
  };
  const needConn = () => {
    if (!conn) vscode.window.showWarningMessage('Select an org first.', 'Select org').then((a) => a && vscode.commands.executeCommand('orglens.selectOrg'));
    return !!conn;
  };

  function analyzeText(text, uri, title) {
    showAnalyzer(ctx, { key: uri.toString(), title, text, uri, getConn: () => conn });
  }

  // ---------- commands ----------
  const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('orglens.selectOrg', async () => {
    const qp = vscode.window.createQuickPick();
    qp.title = 'Select Salesforce org';
    qp.placeholder = 'Loading authenticated orgs…';
    qp.busy = true;
    qp.show();
    const def = await defaultOrg(cwd());
    try {
      const orgs = await listOrgs(cwd());
      qp.items = orgs
        .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''))
        .map((o) => ({
          label: `${o.alias === def || o.username === def ? '$(star-full) ' : ''}${o.alias || o.username}`,
          description: o.username,
          detail: `${o.instanceUrl}${o.connectedStatus && o.connectedStatus !== 'Connected' ? '  ·  ⚠ ' + o.connectedStatus : ''}${o.isSandbox ? '  ·  sandbox' : o.isScratch ? '  ·  scratch' : ''}`,
          target: o.alias || o.username,
        }));
      qp.placeholder = 'Pick an org (★ = project default)';
    } catch (e) {
      qp.items = [{ label: '$(error) ' + e.message }];
    }
    qp.busy = false;
    qp.onDidAccept(() => {
      const s = qp.selectedItems[0];
      qp.hide();
      if (s && s.target) connect(s.target);
    });
  });

  reg('orglens.refresh', async () => {
    if (!needConn()) return;
    await provider.refresh();
    refreshTraceStatus();
  });
  reg('orglens.startTail', () => needConn() && startTail());
  reg('orglens.stopTail', () => stopTail());
  reg('orglens.markAllSeen', () => {
    provider.newIds.clear();
    view.badge = undefined;
    provider._emitter.fire();
  });

  reg('orglens.filter', async () => {
    const ops = [...new Set(provider.logs.map((l) => l.Operation))].sort();
    const users = [...new Set(provider.logs.map((l) => l.LogUser && l.LogUser.Name).filter(Boolean))].sort();
    const on = (b) => (b ? '$(check) ' : '$(blank) ');
    const pick = await vscode.window.showQuickPick(
      [
        { label: `${on(filter.mineOnly)}Only my logs`, k: 'mine' },
        { label: `${on(filter.errorsOnly)}Only failed logs`, k: 'err' },
        { label: '$(search) Text contains…', description: filter.text || '', k: 'text' },
        { label: '$(symbol-event) Operation…', description: filter.operation || '', k: 'op' },
        { label: '$(person) User…', description: filter.userName || '', k: 'user' },
        { label: '$(watch) Minimum duration…', description: filter.minDuration ? filter.minDuration + ' ms' : '', k: 'dur' },
        { label: '$(clear-all) Clear all filters', k: 'clear' },
      ],
      { title: 'Filter debug logs' }
    );
    if (!pick) return;
    let refetch = false;
    if (pick.k === 'mine') { filter.mineOnly = !filter.mineOnly; refetch = true; }
    if (pick.k === 'err') { filter.errorsOnly = !filter.errorsOnly; refetch = true; }
    if (pick.k === 'text') {
      const t = await vscode.window.showInputBox({ prompt: 'Matches operation, user, status, request', value: filter.text });
      if (t !== undefined) filter.text = t;
    }
    if (pick.k === 'op') {
      const o = await vscode.window.showQuickPick(['(any)', ...ops], { title: 'Operation' });
      if (o) filter.operation = o === '(any)' ? null : o;
    }
    if (pick.k === 'user') {
      const u = await vscode.window.showQuickPick(['(any)', ...users], { title: 'User' });
      if (u) filter.userName = u === '(any)' ? null : u;
    }
    if (pick.k === 'dur') {
      const d = await vscode.window.showInputBox({ prompt: 'Minimum duration in ms', value: String(filter.minDuration || '') });
      if (d !== undefined) filter.minDuration = Number(d) || 0;
    }
    if (pick.k === 'clear') { Object.assign(filter, { mineOnly: false, errorsOnly: false, text: '', operation: null, userName: null, minDuration: 0 }); refetch = true; }
    applyFilterUi();
    if (refetch) await provider.refresh();
    else provider._emitter.fire();
  });
  function applyFilterUi() {
    const parts = [];
    if (filter.mineOnly) parts.push('mine');
    if (filter.errorsOnly) parts.push('failed');
    if (filter.text) parts.push(`"${filter.text}"`);
    if (filter.operation) parts.push(filter.operation);
    if (filter.userName) parts.push(filter.userName);
    if (filter.minDuration) parts.push(`≥${filter.minDuration}ms`);
    setCtx('filtered', parts.length > 0);
    view.description = (conn ? conn.alias : '') + (parts.length ? ' · ⧩ ' + parts.join(', ') : '');
  }
  reg('orglens.clearFilter', async () => {
    Object.assign(filter, { mineOnly: false, errorsOnly: false, text: '', operation: null, userName: null, minDuration: 0 });
    applyFilterUi();
    await provider.refresh();
  });

  reg('orglens.analyze', (item, sel) => itemsOf(item, sel).slice(0, 5).forEach((l) => openLog(l, 'analyze')));
  reg('orglens.openRaw', (item, sel) => itemsOf(item, sel).slice(0, 5).forEach((l) => openLog(l, 'raw')));
  reg('orglens.copyId', (item, sel) => vscode.env.clipboard.writeText(itemsOf(item, sel).map((l) => l.Id).join('\n')));
  reg('orglens.saveAs', async (item) => {
    const [log] = itemsOf(item);
    if (!log) return;
    const file = await getLogFile(log);
    const dest = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(cwd(), `${log.Id}.log`)), filters: { 'Apex log': ['log'] } });
    if (dest) {
      fs.copyFileSync(file, dest.fsPath);
      vscode.window.showInformationMessage(`Saved ${path.basename(dest.fsPath)}`);
    }
  });
  reg('orglens.deleteLog', async (item, sel) => {
    const logs = itemsOf(item, sel);
    if (!logs.length || !needConn()) return;
    const ok = await vscode.window.showWarningMessage(`Delete ${logs.length} log(s) from ${conn.alias}?`, { modal: true }, 'Delete');
    if (ok !== 'Delete') return;
    const n = await conn.deleteLogs(logs.map((l) => l.Id));
    vscode.window.setStatusBarMessage(`$(trash) Deleted ${n} log(s)`, 4000);
    provider.knownIds = null;
    await provider.refresh();
  });
  reg('orglens.deleteAll', async () => {
    if (!needConn()) return;
    const pick = await vscode.window.showQuickPick(
      [
        { label: '$(person) Delete my logs', k: 'mine' },
        { label: '$(filter) Delete logs currently shown', k: 'shown' },
        { label: '$(warning) Delete ALL logs in the org', k: 'all' },
      ],
      { title: `Delete debug logs in ${conn.alias}` }
    );
    if (!pick) return;
    let ids;
    if (pick.k === 'shown') ids = provider.filtered().map((l) => l.Id);
    else ids = (await conn.query(`SELECT Id FROM ApexLog${pick.k === 'mine' ? ` WHERE LogUserId = '${conn.userId}'` : ''}`)).map((r) => r.Id);
    if (!ids.length) return vscode.window.showInformationMessage('Nothing to delete.');
    const ok = await vscode.window.showWarningMessage(`Permanently delete ${ids.length} log(s) from ${conn.alias}?`, { modal: true }, 'Delete');
    if (ok !== 'Delete') return;
    const n = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Deleting ${ids.length} logs…` }, () => conn.deleteLogs(ids));
    vscode.window.showInformationMessage(`Deleted ${n} log(s).`);
    provider.knownIds = null;
    await provider.refresh();
  });

  reg('orglens.startTrace', async (opts) => {
    if (!needConn()) return;
    try {
      const r = await trace.startTraceInteractive(conn, opts || {});
      if (!r) return;
      if (r.self) await refreshTraceStatus();
      updateStatus();
      vscode.window.showInformationMessage(`Tracing ${r.userName} until ${r.exp.toLocaleTimeString()}.`, 'Start live tail').then((a) => a && startTail());
    } catch (e) {
      vscode.window.showErrorMessage('Could not start trace: ' + e.message);
    }
  });
  reg('orglens.startTraceUser', () => vscode.commands.executeCommand('orglens.startTrace', { pickUser: true }));
  reg('orglens.stopTrace', async () => {
    if (!needConn()) return;
    try {
      await trace.stopTrace(conn, conn.userId);
      traceExp = null;
      updateStatus();
      vscode.window.setStatusBarMessage('$(debug-stop) Trace stopped', 3000);
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
    }
  });
  reg('orglens.traceMenu', async () => {
    if (!needConn()) return;
    const tracing = traceExp && traceExp > Date.now();
    const items = [
      { label: '$(home) Open OrgLens', c: 'orglens.openStudio' },
      { label: tracing ? '$(history) Extend / change my trace' : '$(record) Start tracing me', c: 'orglens.startTrace' },
      { label: '$(person-add) Manage trace flags & debug levels…', c: 'orglens.openTraceFlags' },
      { label: '$(database) SOQL explorer', c: 'orglens.openSoql' },
      tracing && { label: '$(debug-stop) Stop my trace', c: 'orglens.stopTrace' },
      tailTimer ? { label: '$(debug-pause) Stop live tail', c: 'orglens.stopTail' } : { label: '$(radio-tower) Start live tail', c: 'orglens.startTail' },
      { label: '$(play) Execute anonymous Apex…', c: 'orglens.executeAnonymous' },
      { label: '$(search) Search across logs…', c: 'orglens.searchLogs' },
      { label: '$(cloud) Switch org…', c: 'orglens.selectOrg' },
    ].filter(Boolean);
    const p = await vscode.window.showQuickPick(items, { title: `OrgLens · ${conn.alias}` });
    if (p) vscode.commands.executeCommand(p.c);
  });

  reg('orglens.analyzeFile', async (uri) => {
    let target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
    if (!target || (!uri && vscode.window.activeTextEditor && !/\.log$|^untitled/.test(target.path) && vscode.window.activeTextEditor.document.languageId !== 'apexlog')) {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Apex logs': ['log', 'txt'] }, title: 'Analyze Apex log' });
      if (!picked) return;
      target = picked[0];
    }
    const doc = await vscode.workspace.openTextDocument(target);
    analyzeText(doc.getText(), target, path.basename(target.fsPath || target.path));
  });

  reg('orglens.searchLogs', async () => {
    if (!needConn()) return;
    const term = await vscode.window.showInputBox({ title: 'Search across logs', prompt: 'Text or /regex/ — searches the logs currently listed', placeHolder: 'e.g. NullPointerException or /Account.*Id/' });
    if (!term) return;
    let re;
    const m = /^\/(.+)\/(\w*)$/.exec(term);
    try {
      re = m ? new RegExp(m[1], m[2] || 'i') : new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch (e) {
      return vscode.window.showErrorMessage('Bad regex: ' + e.message);
    }
    const logs = provider.filtered().slice(0, cfg().get('search.maxLogs'));
    const hits = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Searching logs', cancellable: true }, async (prog, tok) => {
      let done = 0;
      const queue = [...logs];
      const worker = async () => {
        while (queue.length && !tok.isCancellationRequested && hits.length < 1000) {
          const log = queue.shift();
          try {
            const file = path.join(cacheDir(), `${log.Id}.log`);
            if (!fs.existsSync(file)) fs.writeFileSync(file, await conn.getLogBody(log.Id));
            const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
            lines.forEach((t, i) => re.test(t) && hits.push({ log, i, t }));
          } catch { /* skip */ }
          prog.report({ increment: 100 / logs.length, message: `${++done}/${logs.length} · ${hits.length} hits` });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    });
    if (!hits.length) return vscode.window.showInformationMessage(`No matches for ${term} in ${logs.length} logs.`);
    const p = await vscode.window.showQuickPick(
      hits.slice(0, 1000).map((h) => ({
        label: h.t.replace(/^\d{2}:\d{2}:\d{2}\.\d+ \(\d+\)\|/, '').slice(0, 200),
        description: `${h.log.Operation} · ${new Date(h.log.StartTime).toLocaleTimeString()}`,
        detail: `line ${h.i + 1} · ${h.log.LogUser && h.log.LogUser.Name}`,
        h,
      })),
      { title: `${hits.length} matches in ${new Set(hits.map((h) => h.log.Id)).size} logs`, matchOnDescription: true, matchOnDetail: true }
    );
    if (!p) return;
    const doc = await vscode.workspace.openTextDocument(path.join(cacheDir(), `${p.h.log.Id}.log`));
    await vscode.languages.setTextDocumentLanguage(doc, 'apexlog');
    const ed = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(p.h.i, 0);
    ed.selection = new vscode.Selection(pos, doc.lineAt(p.h.i).range.end);
    ed.revealRange(ed.selection, vscode.TextEditorRevealType.InCenter);
  });

  reg('orglens.executeAnonymous', async () => {
    if (!needConn()) return;
    const ed = vscode.window.activeTextEditor;
    let code = ed && !ed.selection.isEmpty ? ed.document.getText(ed.selection) : ed && /\.apex$/.test(ed.document.fileName) ? ed.document.getText() : '';
    if (!code) {
      code = await vscode.window.showInputBox({ title: 'Execute anonymous Apex', prompt: 'Apex to run (tip: select code in an editor or open a .apex file)', placeHolder: "System.debug([SELECT Id FROM Account LIMIT 5]);" });
      if (!code) return;
    }
    const tmp = path.join(os.tmpdir(), `sfls-${Date.now()}.apex`);
    fs.writeFileSync(tmp, code);
    try {
      const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Executing anonymous Apex on ${conn.alias}…` }, () => runSf(['apex', 'run', '-f', tmp, '-o', conn.target], cwd()).catch((e) => ({ error: e.message })));
      if (r.error) throw new Error(r.error);
      const file = path.join(cacheDir(), `anon-${Date.now()}.log`);
      fs.writeFileSync(file, r.logs || '');
      if (!r.compiled) vscode.window.showErrorMessage(`Compile error (line ${r.line}, col ${r.column}): ${r.compileProblem}`);
      else if (!r.success) vscode.window.showErrorMessage(`Runtime error: ${r.exceptionMessage}`);
      else vscode.window.setStatusBarMessage('$(check) Anonymous Apex executed', 4000);
      if (r.logs) analyzeText(r.logs, vscode.Uri.file(file), 'Anonymous Apex · ' + new Date().toLocaleTimeString());
      provider.refresh();
    } catch (e) {
      vscode.window.showErrorMessage('Execute anonymous failed: ' + e.message);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  // ---------- Studio page (Home / Live Logs / Trace Flags / SOQL) ----------
  const ids = (list) => list.map((x) => `'${String(x).replace(/[^A-Za-z0-9]/g, '')}'`).join(',');
  const soqlStr = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const apiOps = {
    traceFlags: () => trace.listTraceFlags(conn),
    debugLevels: () => trace.listDebugLevels(conn),
    presets: () => ({ presets: Object.fromEntries(Object.entries(trace.PRESETS).map(([k, p]) => [k, { detail: p.detail, levels: p.levels }])), cats: trace.CATS }),
    searchUsers: ({ term, kind }) => {
      const w = [];
      if (kind === 'automated') w.push("UserType = 'AutomatedProcess'");
      else if (kind === 'guest') w.push("UserType = 'Guest'", 'IsActive = true');
      else if (kind === 'integration') w.push("(Profile.Name LIKE '%Integration%' OR Name LIKE '%Integration%' OR UserType = 'CloudIntegrationUser')");
      else w.push("(IsActive = true OR UserType = 'AutomatedProcess')");
      if (term) w.push(`(Name LIKE '%${soqlStr(term)}%' OR Username LIKE '%${soqlStr(term)}%')`);
      return conn.query(`SELECT Id, Name, Username, UserType, IsActive, Profile.Name FROM User WHERE ${w.join(' AND ')} ORDER BY LastLoginDate DESC NULLS LAST LIMIT 60`);
    },
    searchApex: async ({ term }) => {
      const like = term ? ` WHERE Name LIKE '%${soqlStr(term)}%'` : '';
      const [c, t] = await Promise.all([
        conn.query(`SELECT Id, Name, NamespacePrefix FROM ApexClass${like} ORDER BY Name LIMIT 40`, true),
        conn.query(`SELECT Id, Name, NamespacePrefix FROM ApexTrigger${like} ORDER BY Name LIMIT 20`, true),
      ]);
      return [...c.map((x) => ({ ...x, kind: 'Apex class' })), ...t.map((x) => ({ ...x, kind: 'Apex trigger' }))];
    },
    createTraces: async ({ entityIds, minutes, debugLevelId }) => {
      const done = [];
      const failed = [];
      for (const id of entityIds) {
        try {
          await trace.startTrace(conn, { userId: id, minutes, debugLevelId });
          done.push(id);
        } catch (e) {
          failed.push(`${id}: ${e.message}`);
        }
      }
      await refreshTraceStatus();
      if (failed.length) throw new Error(`${done.length} created, ${failed.length} failed — ${failed.join('; ')}`);
      return done.length;
    },
    extendTraces: async ({ ids: list, minutes }) => {
      const body = { StartDate: new Date(Date.now() - 60000).toISOString(), ExpirationDate: new Date(Date.now() + Math.min(minutes, 1438) * 60000).toISOString() };
      for (const id of list) await conn.request('PATCH', `/tooling/sobjects/TraceFlag/${id}`, body);
      await refreshTraceStatus();
      return list.length;
    },
    changeTraceLevel: async ({ ids: list, debugLevelId }) => {
      for (const id of list) await conn.request('PATCH', `/tooling/sobjects/TraceFlag/${id}`, { DebugLevelId: debugLevelId });
      await refreshTraceStatus();
      return list.length;
    },
    deleteTraces: async ({ ids: list }) => {
      for (const id of list) await conn.request('DELETE', `/tooling/sobjects/TraceFlag/${id}`);
      await refreshTraceStatus();
      return list.length;
    },
    ensurePreset: ({ preset }) => trace.ensureDebugLevel(conn, preset, trace.PRESETS[preset].levels),
    saveDebugLevel: (a) => trace.saveDebugLevel(conn, a),
    deleteDebugLevel: ({ id }) => conn.request('DELETE', `/tooling/sobjects/DebugLevel/${id}`),

    // Home "org pulse": limits, failed async jobs, recent code changes, scheduled jobs, coverage.
    // Every section is independent (allSettled) so one missing permission doesn't blank the panel.
    homePulse: async ({ force } = {}) => {
      const key = conn.orgId + '|pulse';
      const hit = pulseCache.get(key);
      if (!force && hit && Date.now() - hit.at < 5 * 60000) return hit.data;
      const ok = (p) => p.then((v) => ({ v }), (e) => ({ err: e.message || String(e) }));
      const [limits, jobs, classes, triggers, flows, crons, cov] = await Promise.all([
        ok(conn.request('GET', '/limits')),
        ok(conn.query("SELECT Id, ApexClass.Name, JobType, Status, ExtendedStatus, NumberOfErrors, TotalJobItems, CreatedDate, CompletedDate, CreatedBy.Name FROM AsyncApexJob WHERE CreatedDate = LAST_N_DAYS:1 AND JobType != 'BatchApexWorker' AND (Status = 'Failed' OR NumberOfErrors > 0) ORDER BY CreatedDate DESC LIMIT 10")),
        ok(conn.query('SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM ApexClass WHERE NamespacePrefix = null AND LastModifiedDate = LAST_N_DAYS:7 ORDER BY LastModifiedDate DESC LIMIT 10', true)),
        ok(conn.query('SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM ApexTrigger WHERE NamespacePrefix = null AND LastModifiedDate = LAST_N_DAYS:7 ORDER BY LastModifiedDate DESC LIMIT 10', true)),
        ok(conn.query('SELECT DurableId, ApiName, Label, ProcessType, LastModifiedDate, LastModifiedBy FROM FlowDefinitionView WHERE NamespacePrefix = null AND LastModifiedDate = LAST_N_DAYS:7 ORDER BY LastModifiedDate DESC LIMIT 10')),
        ok(conn.query("SELECT Id, CronJobDetail.Name, CronJobDetail.JobType, NextFireTime, PreviousFireTime, State FROM CronTrigger WHERE NextFireTime != null AND State != 'DELETED' ORDER BY NextFireTime LIMIT 8")),
        ok(conn.query('SELECT PercentCovered FROM ApexOrgWideCoverage', true)),
      ]);
      const LIM = [['DailyApiRequests', 'API requests (24h)'], ['DataStorageMB', 'Data storage'], ['FileStorageMB', 'File storage'], ['DailyAsyncApexExecutions', 'Async Apex (24h)'], ['SingleEmail', 'Single emails (24h)'], ['DailyWorkflowEmails', 'Workflow emails (24h)']];
      const JT = { 2: 'Future', 4: 'Batch', 5: 'Batch', 7: 'Scheduled', 9: 'Scheduled flow', 3: 'Data export', 8: 'API polling', A: 'Dashboard refresh' };
      const changed = [];
      if (classes.v) classes.v.forEach((r) => changed.push({ kind: 'Class', name: r.Name, at: r.LastModifiedDate, by: r.LastModifiedBy && r.LastModifiedBy.Name, id: r.Id }));
      if (triggers.v) triggers.v.forEach((r) => changed.push({ kind: 'Trigger', name: r.Name, at: r.LastModifiedDate, by: r.LastModifiedBy && r.LastModifiedBy.Name, id: r.Id }));
      if (flows.v) flows.v.forEach((r) => changed.push({ kind: r.ProcessType === 'AutoLaunchedFlow' ? 'Autolaunched flow' : r.ProcessType === 'Flow' ? 'Screen flow' : 'Flow', name: r.Label || r.ApiName, at: r.LastModifiedDate, by: r.LastModifiedBy, flowId: r.DurableId }));
      changed.sort((a, b) => new Date(b.at) - new Date(a.at));
      const data = {
        at: Date.now(),
        limits: limits.v ? LIM.filter(([k]) => limits.v[k] && limits.v[k].Max).map(([k, label]) => ({ key: k, label, max: limits.v[k].Max, used: limits.v[k].Max - limits.v[k].Remaining, mb: /MB$/.test(k) })) : null,
        limitsErr: limits.err,
        jobs: jobs.v ? jobs.v.map((j) => ({ id: j.Id, cls: (j.ApexClass && j.ApexClass.Name) || j.JobType, type: j.JobType, status: j.Status, msg: j.ExtendedStatus, errors: j.NumberOfErrors, items: j.TotalJobItems, at: j.CompletedDate || j.CreatedDate, by: j.CreatedBy && j.CreatedBy.Name })) : null,
        jobsErr: jobs.err,
        changed: changed.slice(0, 10),
        changedErr: classes.err && flows.err ? classes.err : null,
        crons: crons.v ? crons.v.map((c) => ({ id: c.Id, name: c.CronJobDetail && c.CronJobDetail.Name, type: JT[c.CronJobDetail && c.CronJobDetail.JobType] || 'Job', next: c.NextFireTime, prev: c.PreviousFireTime, state: c.State })) : null,
        cronsErr: crons.err,
        coverage: cov.v && cov.v[0] ? cov.v[0].PercentCovered : null,
      };
      pulseCache.set(key, { at: Date.now(), data });
      return data;
    },

    // Org setup
    orgInfo: async () => {
      const [org, limits, users] = await Promise.all([
        conn.query('SELECT FIELDS(STANDARD) FROM Organization LIMIT 1'),
        conn.request('GET', '/limits'),
        conn.query('SELECT COUNT(Id) n FROM User WHERE IsActive = true'),
      ]);
      return {
        org: org[0],
        apiVersion: conn.apiVersion,
        instanceUrl: conn.instanceUrl,
        activeUsers: users[0] && users[0].n,
        limits: Object.entries(limits).map(([k, v]) => ({ name: k, max: v.Max, remaining: v.Remaining, used: v.Max - v.Remaining })),
      };
    },
    listSettings: async () => {
      const key = conn.orgId + '|settings';
      if (!describeCache.has(key)) {
        const r = await conn.metadata(`<listMetadata xmlns="http://soap.sforce.com/2006/04/metadata"><queries><type>Settings</type></queries><asOfVersion>${conn.apiVersion}</asOfVersion></listMetadata>`);
        describeCache.set(key, xml.findAll(xml.parse(r), 'fullName').map((n) => n.text).sort());
      }
      return describeCache.get(key);
    },
    readSettings: async ({ names }) => {
      const out = {};
      const queue = [...names];
      const worker = async () => {
        while (queue.length) {
          const n = queue.shift();
          const key = `${conn.orgId}|setting|${n}`;
          try {
            if (!describeCache.has(key)) {
              const r = await conn.metadata(`<readMetadata xmlns="http://soap.sforce.com/2006/04/metadata"><type>${n}Settings</type><fullNames>${n}</fullNames></readMetadata>`);
              const rec = xml.find(xml.parse(r), 'records');
              describeCache.set(key, rec ? xml.flatten(rec).filter((i) => i.key !== 'fullName') : []);
            }
            out[n] = { items: describeCache.get(key) };
          } catch (e) {
            out[n] = { error: e.message };
          }
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      return out;
    },
    packages: () =>
      conn.query('SELECT Id, SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.Name, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber FROM InstalledSubscriberPackage ORDER BY SubscriberPackage.Name', true),
    licenses: async () => {
      const [u, p] = await Promise.all([
        conn.query('SELECT Name, Status, TotalLicenses, UsedLicenses FROM UserLicense ORDER BY Name'),
        conn.query('SELECT MasterLabel, DeveloperName, Status, TotalLicenses, UsedLicenses, ExpirationDate FROM PermissionSetLicense ORDER BY MasterLabel'),
      ]);
      return { user: u, psl: p };
    },
    myAccess: async () => {
      const [a, u] = await Promise.all([
        conn.query(`SELECT PermissionSet.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, PermissionSet.Type, PermissionSetGroup.MasterLabel, PermissionSetGroupId FROM PermissionSetAssignment WHERE AssigneeId = '${conn.userId}'`),
        conn.query(`SELECT Name, Username, Profile.Name, UserRole.Name, UserType, TimeZoneSidKey, LocaleSidKey, LanguageLocaleKey FROM User WHERE Id = '${conn.userId}'`),
      ]);
      return { assignments: a, user: u[0] };
    },
    auditTrail: () => conn.query('SELECT Id, CreatedDate, CreatedBy.Name, Action, Section, Display, DelegateUser FROM SetupAuditTrail ORDER BY CreatedDate DESC LIMIT 500'),

    // SOQL explorer
    describeGlobal: async ({ tooling }) => {
      const key = `${conn.orgId}|${tooling ? 'T' : 'D'}|*`;
      if (!describeCache.has(key)) {
        const r = await conn.request('GET', `${tooling ? '/tooling' : ''}/sobjects`);
        describeCache.set(key, r.sobjects.filter((s) => s.queryable).map((s) => ({ name: s.name, label: s.label, custom: s.custom, prefix: s.keyPrefix })));
      }
      return describeCache.get(key);
    },
    describe: async ({ name, tooling }) => {
      const key = `${conn.orgId}|${tooling ? 'T' : 'D'}|${name}`;
      if (!describeCache.has(key)) {
        const r = await conn.request('GET', `${tooling ? '/tooling' : ''}/sobjects/${encodeURIComponent(name)}/describe`);
        describeCache.set(key, {
          name: r.name,
          label: r.label,
          labelPlural: r.labelPlural,
          prefix: r.keyPrefix,
          createable: r.createable,
          updateable: r.updateable,
          deletable: r.deletable,
          fields: r.fields.map((f) => ({
            name: f.name, label: f.label, type: f.type, length: f.length, ref: f.referenceTo, rel: f.relationshipName, custom: f.custom,
            nillable: f.nillable, filterable: f.filterable, updateable: f.updateable, createable: f.createable, calculated: f.calculated,
            externalId: f.externalId, idLookup: f.idLookup, nameField: f.nameField, defaulted: f.defaultedOnCreate, unique: f.unique,
            precision: f.precision, scale: f.scale, help: f.inlineHelpText || '',
            picklist: (f.picklistValues || []).filter((p) => p.active).map((p) => p.value).slice(0, 500),
          })),
          children: (r.childRelationships || []).filter((c) => c.relationshipName).map((c) => ({ rel: c.relationshipName, object: c.childSObject, field: c.field })),
        });
      }
      return describeCache.get(key);
    },
    query: async ({ soql, tooling, all }) => {
      const t = Date.now();
      const r = await conn.request('GET', `${tooling ? '/tooling' : ''}/${all && !tooling ? 'queryAll' : 'query'}?q=${encodeURIComponent(soql)}`);
      const hist = ctx.globalState.get('soqlHistory', []).filter((h) => h.soql !== soql);
      hist.unshift({ soql, tooling: !!tooling, at: Date.now(), org: conn.alias });
      await ctx.globalState.update('soqlHistory', hist.slice(0, 60));
      return { records: r.records, totalSize: r.totalSize, done: r.done, next: r.nextRecordsUrl, ms: Date.now() - t };
    },
    queryMore: async ({ next }) => {
      const r = await conn.request('GET', next);
      return { records: r.records, done: r.done, next: r.nextRecordsUrl };
    },
    // ---- record data operations (SOQL explorer / record panel / import) ----
    getRecord: ({ object, id }) => conn.request('GET', `/sobjects/${encodeURIComponent(object)}/${encodeURIComponent(id)}`),
    explain: ({ soql }) => conn.request('GET', `/query?explain=${encodeURIComponent(soql)}`),
    related: async ({ object, field, id, limit = 50 }) => {
      const d = await apiOps.describe({ name: object, tooling: false });
      const nameF = (d.fields.find((f) => f.nameField) || {}).name;
      const sel = ['Id', nameF, d.fields.some((f) => f.name === 'LastModifiedDate') ? 'LastModifiedDate' : null].filter(Boolean);
      const r = await conn.request('GET', `/query?q=${encodeURIComponent(`SELECT ${[...new Set(sel)].join(', ')} FROM ${object} WHERE ${field} = '${String(id).replace(/[^A-Za-z0-9]/g, '')}' ORDER BY ${sel.includes('LastModifiedDate') ? 'LastModifiedDate DESC' : 'Id'} LIMIT ${limit}`)}`);
      const cnt = await conn.request('GET', `/query?q=${encodeURIComponent(`SELECT COUNT() FROM ${object} WHERE ${field} = '${String(id).replace(/[^A-Za-z0-9]/g, '')}'`)}`).catch(() => ({ totalSize: r.totalSize }));
      return { records: r.records, total: cnt.totalSize, nameField: nameF };
    },
    /** Batched DML via the sObject Collections API. op: insert | update | upsert | delete. Never all-or-none. */
    dml: async ({ op, object, records, ids, extField }) => {
      const out = [];
      if (op === 'delete') {
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const r = await conn.request('DELETE', `/composite/sobjects?allOrNone=false&ids=${chunk.map(encodeURIComponent).join(',')}`);
          out.push(...r);
        }
        log(`DML delete ${ids.length} → ${out.filter((x) => x.success).length} ok`);
        return out;
      }
      for (let i = 0; i < records.length; i += 200) {
        const chunk = records.slice(i, i + 200).map((r) => ({ attributes: { type: object }, ...r }));
        let r;
        if (op === 'insert') r = await conn.request('POST', '/composite/sobjects', { allOrNone: false, records: chunk });
        else if (op === 'update') r = await conn.request('PATCH', '/composite/sobjects', { allOrNone: false, records: chunk });
        else if (op === 'upsert') r = await conn.request('PATCH', `/composite/sobjects/${encodeURIComponent(object)}/${encodeURIComponent(extField)}`, { allOrNone: false, records: chunk });
        else throw new Error('Unknown operation ' + op);
        out.push(...r);
      }
      log(`DML ${op} ${object} ${records.length} → ${out.filter((x) => x.success).length} ok`);
      return out;
    },
    readTextFile: async () => {
      const pick = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'CSV / text': ['csv', 'tsv', 'txt'] }, title: 'Choose a CSV file to import' });
      if (!pick) return null;
      return fs.readFileSync(pick[0].fsPath, 'utf8').replace(/^﻿/, '');
    },
    history: () => ctx.globalState.get('soqlHistory', []),
    saved: () => ctx.globalState.get('soqlSaved', []),
    saveQuery: async ({ name, soql, tooling }) => {
      const list = ctx.globalState.get('soqlSaved', []).filter((s) => s.name !== name);
      list.unshift({ name, soql, tooling });
      await ctx.globalState.update('soqlSaved', list);
      return list;
    },
    deleteSaved: async ({ name }) => {
      const list = ctx.globalState.get('soqlSaved', []).filter((s) => s.name !== name);
      await ctx.globalState.update('soqlSaved', list);
      return list;
    },
    // REST explorer — raw call that never throws on HTTP errors; only ever talks to the connected org.
    restCall: async ({ method, path: p, headers, body }) => {
      let url = String(p || '').trim();
      if (!url) throw new Error('Enter a path, e.g. /limits');
      if (/^https?:/i.test(url)) {
        if (new URL(url).origin !== new URL(conn.instanceUrl).origin) throw new Error(`Only ${conn.instanceUrl} is allowed (the access token is never sent to other hosts).`);
      } else {
        if (!url.startsWith('/')) url = '/' + url;
        url = url.startsWith('/services') ? conn.instanceUrl + url : `${conn.instanceUrl}/services/data/v${conn.apiVersion}${url}`;
      }
      const m = String(method || 'GET').toUpperCase();
      const send = async () => {
        const h = { Accept: 'application/json', ...(headers || {}) };
        h.Authorization = `Bearer ${conn.accessToken}`;
        if (body && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 120000);
        const t = Date.now();
        try {
          const res = await fetch(url, { method: m, headers: h, body: ['GET', 'HEAD'].includes(m) || !body ? undefined : body, signal: ac.signal });
          const text = m === 'HEAD' ? '' : await res.text();
          return { status: res.status, statusText: res.statusText, ms: Date.now() - t, size: Buffer.byteLength(text), headers: Object.fromEntries(res.headers.entries()), body: text.length > 8e6 ? text.slice(0, 8e6) : text, truncated: text.length > 8e6, url };
        } finally {
          clearTimeout(timer);
        }
      };
      let r = await send();
      if (r.status === 401) {
        conn.accessToken = await conn.freshToken(null);
        r = await send();
      }
      const hist = ctx.globalState.get('restHistory', []).filter((x) => !(x.method === m && x.path === p && (x.body || '') === (body || '')));
      hist.unshift({ method: m, path: p, body: body || '', headers: headers || {}, at: Date.now(), status: r.status, org: conn.alias });
      await ctx.globalState.update('restHistory', hist.slice(0, 60));
      return r;
    },
    restHistory: () => ctx.globalState.get('restHistory', []),
    restSaved: () => ctx.globalState.get('restSaved', []),
    restSave: async ({ item }) => {
      const list = ctx.globalState.get('restSaved', []).filter((x) => x.name !== item.name);
      list.unshift(item);
      await ctx.globalState.update('restSaved', list);
      return list;
    },
    restDeleteSaved: async ({ name }) => {
      const list = ctx.globalState.get('restSaved', []).filter((x) => x.name !== name);
      await ctx.globalState.update('restSaved', list);
      return list;
    },
    restContext: () => ({ instanceUrl: conn.instanceUrl, apiVersion: conn.apiVersion }),
    openPath: async ({ path: p }) => {
      await runSf(['org', 'open', '-o', conn.target, '-p', p], cwd());
      return true;
    },
    openRecord: async ({ id }) => {
      await runSf(['org', 'open', '-o', conn.target, '-p', `/${id}`], cwd());
      return true;
    },
    saveFile: async ({ name, content }) => {
      const dest = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(cwd(), name)) });
      if (!dest) return false;
      fs.writeFileSync(dest.fsPath, content);
      vscode.window.showInformationMessage(`Saved ${path.basename(dest.fsPath)}`);
      return true;
    },
    copy: async ({ text }) => {
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage('$(check) Copied to clipboard', 2500);
      return true;
    },
    pickItems: async ({ title, items }) => {
      const p = await vscode.window.showQuickPick(items, { title });
      return p || null;
    },
    confirm: async ({ message, action }) => (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action,
  };
  const OFFLINE_OK = new Set(['history', 'saved', 'saveQuery', 'deleteSaved', 'saveFile', 'copy', 'pickItems', 'confirm', 'restHistory', 'restSaved', 'restSave', 'restDeleteSaved']);
  const studioApi = {
    state: () => ({
      connecting,
      org: conn ? { alias: conn.alias, username: conn.username, instanceUrl: conn.instanceUrl, userName: conn.userName, userId: conn.userId } : null,
      tracing: !!(traceExp && traceExp > Date.now()),
      traceExp: traceExp ? +traceExp : null,
      traceStart,
      traceLevel,
      tailing: !!tailTimer,
      error: provider.error,
      filter: { mineOnly: filter.mineOnly },
      newIds: [...provider.newIds],
      logs: provider.logs.map((l) => ({
        id: l.Id, op: l.Operation, user: l.LogUser && l.LogUser.Name, status: l.Status, start: l.StartTime,
        dur: l.DurationMilliseconds, size: l.LogLength, request: l.Request, app: l.Application, location: l.Location,
      })),
    }),
    call: (op, args) => {
      if (!apiOps[op]) throw new Error('Unknown operation ' + op);
      if (!conn && !OFFLINE_OK.has(op)) throw new Error('Select an org first.');
      return apiOps[op](args);
    },
    openLog: (id, mode) => {
      const log = provider.logs.find((l) => l.Id === id);
      if (log) return openLog(log, mode);
    },
    deleteIds: (list) => vscode.commands.executeCommand('orglens.deleteLog', null, list.map((id) => ({ log: provider.logs.find((l) => l.Id === id) })).filter((x) => x.log)),
    setServerFilter: async (f) => {
      Object.assign(filter, f);
      applyFilterUi();
      await provider.refresh();
      pushStudio(true);
    },
  };
  reg('orglens.openStudio', (tab) => openStudio(ctx, studioApi, typeof tab === 'string' ? tab : undefined));
  reg('orglens.openLiveLogs', () => openStudio(ctx, studioApi, 'logs'));
  reg('orglens.openTraceFlags', () => openStudio(ctx, studioApi, 'trace'));
  reg('orglens.openSoql', () => openStudio(ctx, studioApi, 'soql'));
  reg('orglens.openOrgSetup', () => openStudio(ctx, studioApi, 'org'));
  reg('orglens.openGuide', () => openStudio(ctx, studioApi, 'guide'));
  reg('orglens.openRest', () => openStudio(ctx, studioApi, 'rest'));

  // Clicking the activity-bar icon lands on the OrgLens Home page.
  const openHomeFromSidebar = () => {
    if (cfg().get('openHomeOnSidebarClick')) openStudio(ctx, studioApi, 'home');
  };
  ctx.subscriptions.push(view.onDidChangeVisibility((e) => e.visible && openHomeFromSidebar()));
  if (view.visible) openHomeFromSidebar();

  reg('orglens.clearCache', () => {
    fs.rmSync(path.join(ctx.globalStorageUri.fsPath, 'logs'), { recursive: true, force: true });
    vscode.window.showInformationMessage('Local log cache cleared.');
  });

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('orglens.tail.intervalSeconds') && tailTimer) { stopTail(); startTail(); }
      if (e.affectsConfiguration('orglens.defaultOpenAction') || e.affectsConfiguration('orglens.maxLogs')) provider.refresh();
    }),
    { dispose: () => { stopTail(); clearInterval(traceTick); } }
  );

  // ---------- initial connection ----------
  setCtx('connected', false);
  updateStatus();
  (async () => {
    const target = ctx.workspaceState.get('org') || (await defaultOrg(cwd()));
    if (target) connect(target, true);
  })();
}

function deactivate() {}

module.exports = { activate, deactivate };

'use strict';
const vscode = require('vscode');

/** "OrgLens" page: Home dashboard + Live Logs table. */
let panel = null;
let api = null;
let timer = null;

const ALLOWED = new Set([
  'orglens.selectOrg', 'orglens.startTail', 'orglens.stopTail', 'orglens.refresh',
  'orglens.startTrace', 'orglens.startTraceUser', 'orglens.stopTrace', 'orglens.searchLogs',
  'orglens.executeAnonymous', 'orglens.analyzeFile', 'orglens.deleteAll', 'orglens.markAllSeen',
  'orglens.clearCache',
]);

function openStudio(ctx, a, tab) {
  api = a;
  if (panel) {
    panel.reveal();
    if (tab) panel.webview.postMessage({ type: 'tab', tab });
    return;
  }
  const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
  panel = vscode.window.createWebviewPanel('orglens.studio', 'OrgLens', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [media],
  });
  panel.iconPath = vscode.Uri.joinPath(media, 'icon-tab.svg');
  panel.onDidDispose(() => (panel = null));
  const w = panel.webview;
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const u = (f) => w.asWebviewUri(vscode.Uri.joinPath(media, f));
  w.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="sfls-guide-images" content="${u('guide')}">
<link rel="stylesheet" href="${u('analyzer.css')}"><link rel="stylesheet" href="${u('studio.css')}"><link rel="stylesheet" href="${u('pages.css')}"><link rel="stylesheet" href="${u('rest.css')}"><title>OrgLens</title></head>
<body data-tab="${tab || 'home'}"><div id="app"><div class="loading"><div class="spinner"></div>Loading…</div></div>
<script nonce="${nonce}" src="${u('studio.js')}"></script>
<script nonce="${nonce}" src="${u('trace.js')}"></script>
<script nonce="${nonce}" src="${u('records.js')}"></script>
<script nonce="${nonce}" src="${u('soql.js')}"></script>
<script nonce="${nonce}" src="${u('org.js')}"></script>
<script nonce="${nonce}" src="${u('guide.js')}"></script>
<script nonce="${nonce}" src="${u('rest.js')}"></script></body></html>`;

  w.onDidReceiveMessage(async (m) => {
    if (m.cmd === 'api') {
      try {
        const result = await api.call(m.op, m.args || {});
        if (panel) panel.webview.postMessage({ type: 'api', reqId: m.reqId, result });
      } catch (e) {
        if (panel) panel.webview.postMessage({ type: 'api', reqId: m.reqId, error: e.message || String(e) });
      }
      return;
    }
    try {
      switch (m.cmd) {
        case 'ready':
          push(true);
          break;
        case 'run':
          if (ALLOWED.has(m.id)) await vscode.commands.executeCommand(m.id, ...(m.args || []));
          break;
        case 'open':
          await api.openLog(m.id, m.mode, { search: m.search, line: m.line });
          break;
        case 'delete':
          await api.deleteIds(m.ids);
          break;
        case 'serverFilter':
          await api.setServerFilter(m.filter);
          break;
      }
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
    }
  });
}

/** Push current state to the page (debounced). */
function push(now) {
  if (!panel || !api) return;
  clearTimeout(timer);
  const send = () => panel && panel.webview.postMessage({ type: 'state', state: api.state() });
  if (now) send();
  else timer = setTimeout(send, 120);
}

module.exports = { openStudio, pushStudio: push };
